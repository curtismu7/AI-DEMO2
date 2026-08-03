/**
 * Main entry point for the Banking MCP Server
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { loadConfiguration, validateConfiguration, ConfigurationError } from './config';
import { loadVaultIntoEnv } from './vault';
import { DemoMCPServerConfig } from './interfaces';
import { DemoMCPServer } from './server/DemoMCPServer';
import { BankingAuthenticationManager } from './auth/BankingAuthenticationManager';
import { BankingSessionManager } from './storage/BankingSessionManager';
import { BankingToolProvider } from './tools/BankingToolProvider';
import { BankingAPIClient } from './banking/BankingAPIClient';
import { TokenExchangeService } from './auth/TokenExchangeService';
import { Logger, createDefaultLoggerConfig } from './utils/Logger';

// Export all types and interfaces for library usage
export * from './types';
export * from './config';

// Export specific interfaces to avoid conflicts
export type { 
  DemoMCPServerConfig,
  EnvironmentVariables,
  DEFAULT_CONFIG
} from './interfaces';

export { 
  AuthenticationError,
  BankingAPIError
} from './interfaces';

export {
  loadConfiguration,
  validateConfiguration,
  ConfigurationError
} from './config';

// Export the main server class
export { DemoMCPServer } from './server/DemoMCPServer';

let server: DemoMCPServer | null = null;

async function main(): Promise<void> {
  try {
    console.log('Banking MCP Server starting...');

    // Load allowlisted secrets from the encrypted vault into process.env
    // BEFORE loadConfiguration() reads it. No-op (logs + continues) when
    // secrets.vault is absent — dev machines without a vault are unchanged.
    // The vault supplies MCP_GW_CLIENT_ID/SECRET, which environments.ts
    // resolves as the RFC 7662 introspection client (must equal the
    // gateway's RFC 8693 exchange client — REGRESSION_PLAN.md §4 2026-05-18).
    try {
      const vaultResult = await loadVaultIntoEnv();
      if (vaultResult.loaded) {
        console.log(`[MCP vault] loaded ${vaultResult.entries} entries into process.env`);
      }
    } catch (err) {
      // Fail closed. This used to warn
      // and continue, so a wrong VAULT_PASSWORD booted the server anyway;
      // loadConfiguration() then walked its secret fallback chain and
      // introspected as a DIFFERENT PingOne client, making PingOne return
      // active:false for every token (REGRESSION_PLAN.md §4 2026-05-18).
      // docker-compose builds the `mcp-server` service from this directory, so
      // the Docker path was the one running the fail-open copy.
      console.error(
        '[MCP vault] startup load failed; refusing to start.',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }

    // Load and validate configuration
    const config: DemoMCPServerConfig = loadConfiguration();
    validateConfiguration(config);
    
    console.log(`Server configured to run on ${config.server.host}:${config.server.port}`);
    console.log(`Banking API endpoint: ${config.bankingApi.baseUrl}`);
    console.log(`PingOne endpoint: ${config.pingone.baseUrl}`);
    
    // Initialize server components
    console.log('Initializing server components...');
    
    // Initialize authentication manager
    const authManager = new BankingAuthenticationManager(config.pingone);
    
    // Initialize session manager
    const sessionManager = new BankingSessionManager(
      config.security.tokenStoragePath,
      config.security.encryptionKey,
      3600, // Cache TTL
      config.security.sessionCleanupInterval
    );
    
    // Initialize banking API client
    const bankingClient = new BankingAPIClient({
      baseUrl: config.bankingApi.baseUrl,
      timeout: config.bankingApi.timeout,
      maxRetries: config.bankingApi.maxRetries,
      circuitBreakerThreshold: config.bankingApi.circuitBreakerThreshold
    });
    
    // Initialize tool provider (also initialises the Logger singleton — must happen before TokenExchangeService)
    const toolProvider = new BankingToolProvider(bankingClient, authManager, sessionManager);

    // Step 9 token exchange: when BANKING_API_RESOURCE_URI is set, the MCP server
    // must exchange the gateway-scoped token (aud=mcpgateway.ping.demo) for a
    // resource-scoped token (aud=enduser.ping.demo) before calling the Banking API.
    // The exchanger client is the same MCP exchanger app used by the BFF (d3f8fead).
    // Gated: if neither env var is set, tokenExchangeService is undefined and
    // TokenResolver falls back to agent-passthrough (backward compat / direct WS mode).
    // PINGONE_TOKEN_EXCHANGER_CLIENT_ID is the name the environment actually
    // supplies (demo_api_server/.env). The secret arrives as
    // PINGONE_MCP_EXCHANGER_CLIENT_SECRET, so the pair was split across two
    // naming conventions and this gate never resolved — tokenExchangeService
    // stayed undefined and TokenResolver silently fell back to
    // agent-passthrough, so Step 9 had never run once.
    const tokenExchangerClientId = process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID
      || process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID
      || process.env.AGENT_OAUTH_CLIENT_ID;
    const tokenExchangerClientSecret = process.env.PINGONE_MCP_EXCHANGER_CLIENT_SECRET || process.env.AGENT_OAUTH_CLIENT_SECRET;
    const bankingApiResourceUri = process.env.BANKING_API_RESOURCE_URI;
    if (tokenExchangerClientId && tokenExchangerClientSecret && bankingApiResourceUri) {
      // Logger singleton is now initialised (by BankingToolProvider above) — safe to use here
      const logger = Logger.getInstance(createDefaultLoggerConfig());
      // PINGONE_TOKEN_ENDPOINT points at the auth server (auth.pingone.com/.../as/token).
      // PINGONE_BASE_URL points at the Management API — not usable for token operations.
      // Pass tokenEndpoint explicitly so TokenExchangeService uses the correct host.
      const tokenExchangeService = new TokenExchangeService({
        pingoneBaseUrl: config.pingone.baseUrl,
        environmentId: config.pingone.environmentId || '',
        tokenEndpoint: process.env.PINGONE_TOKEN_ENDPOINT,
        clientId: tokenExchangerClientId,
        clientSecret: tokenExchangerClientSecret,
        requireMayAct: false,  // Step 9: act claim already established in Exchange #1/#2
        resourceUri: bankingApiResourceUri,
      }, logger);
      toolProvider.setTokenExchangeService(tokenExchangeService);
      console.log(`[MCP] Step 9 token exchange enabled — audience: ${bankingApiResourceUri}`);
    }
    
    // Initialize and start MCP server
    const serverConfig = {
      host: config.server.host,
      port: config.server.port,
      maxConnections: config.server.maxConnections,
      sessionTimeout: config.server.sessionTimeout,
      enableLogging: config.logging.level === 'DEBUG'
    };
    
    server = new DemoMCPServer(serverConfig, authManager, sessionManager, toolProvider);
    
    console.log('Starting MCP server...');
    await server.startServer();
    
    console.log(`✅ Banking MCP Server is running on ${config.server.host}:${config.server.port}`);
    console.log('Server is ready to accept MCP connections.');
    
    // Keep the process running
    process.stdin.resume();
    
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error('Configuration error:', error.message);
      process.exit(1);
    } else {
      console.error('Unexpected error:', error);
      console.error(error);
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  
  if (server) {
    try {
      console.log('Stopping MCP server...');
      await server.stopServer();
      console.log('Server stopped successfully.');
    } catch (error) {
      console.error('Error stopping server:', error);
    }
  }
  
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown('uncaughtException').catch((err) => {
    console.error('Shutdown failed after uncaughtException:', err);
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection').catch((err) => {
    console.error('Shutdown failed after unhandledRejection:', err);
    process.exit(1);
  });
});

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}