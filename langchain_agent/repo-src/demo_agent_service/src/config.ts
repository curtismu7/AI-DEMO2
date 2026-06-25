'use strict';

import dotenv from 'dotenv';
dotenv.config();

export interface AgentConfig {
  port: number;
  host: string;
  // agent1's own OAuth client credentials (actor token source)
  clientId: string;
  clientSecret: string;
  // PingOne endpoints
  tokenEndpoint: string;
  // BFF tool execution URL (pinned from env to prevent SSRF)
  bffToolUrl: string;
  // MCP Gateway
  mcpGatewayWsUrl: string;
  mcpGatewayResourceUri: string;
  // LLM provider
  llmProvider: 'openai' | 'anthropic' | 'helix' | 'ollama' | 'none';
  llmApiKey: string;
  llmModel: string;
  // Feature flags
  usePkiCreds: boolean;
  agentCertPath: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Compute the PingOne token endpoint from envId + region when an explicit
// PINGONE_TOKEN_ENDPOINT isn't set. Same logic as banking_mcp_gateway and
// the BFF's oauthEndpointResolver — every setup:fresh writes
// PINGONE_ENVIRONMENT_ID + PINGONE_REGION, so users shouldn't have to set
// PINGONE_TOKEN_ENDPOINT manually.
function resolveTokenEndpoint(): string {
  const explicit = process.env.PINGONE_TOKEN_ENDPOINT;
  if (explicit) return explicit;
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  if (envId) return `https://auth.pingone.${region}/${envId}/as/token`;
  return required('PINGONE_TOKEN_ENDPOINT');
}

const VALID_LLM_PROVIDERS: ReadonlyArray<AgentConfig['llmProvider']> = [
  'openai',
  'anthropic',
  'helix',
  'ollama',
  'none',
];

export function loadConfig(): AgentConfig {
  // IN-01: fail fast at startup on a typo'd LLM_PROVIDER (e.g. "Anthropic")
  // rather than silently mis-routing and only throwing "Unknown LLM
  // provider" deep in runAgentTask at request time.
  const llmProviderRaw = optional('LLM_PROVIDER', 'none');
  if (!VALID_LLM_PROVIDERS.includes(llmProviderRaw as AgentConfig['llmProvider'])) {
    throw new Error(
      `Invalid LLM_PROVIDER: "${llmProviderRaw}" — must be one of ${VALID_LLM_PROVIDERS.join(' | ')}`,
    );
  }
  return {
    port: parseInt(process.env.PORT || '3006', 10),
    // :3006 is loopback-only per REGRESSION_PLAN §3. Default to 127.0.0.1 so a
    // misconfigured deploy can't expose the token-exchange endpoint on all
    // interfaces; staging/prod can still bind 0.0.0.0 via an explicit HOST env.
    host: process.env.HOST || '127.0.0.1',
    // :3006 is reasoning-only (Phase 2 agent consolidation). The BFF keeps
    // token custody, so the agent no longer performs its own RFC 8693
    // exchange. AGENT_CLIENT_ID / MCP_GW_RESOURCE_URI are only consumed by the
    // now-unwired token/MCP-gateway path — relaxed to optional so the service
    // starts without them.
    clientId: optional('AGENT_CLIENT_ID', ''),
    clientSecret: optional('AGENT_CLIENT_SECRET', ''),
    tokenEndpoint: resolveTokenEndpoint(),
    bffToolUrl: optional('BFF_TOOL_URL', ''),
    mcpGatewayWsUrl: optional('MCP_GATEWAY_WS_URL', 'ws://localhost:3005'),
    mcpGatewayResourceUri: optional('MCP_GW_RESOURCE_URI', ''),
    llmProvider: llmProviderRaw as AgentConfig['llmProvider'],
    llmApiKey: optional('LLM_API_KEY', ''),
    llmModel: optional('LLM_MODEL', 'claude-sonnet-4.6'),
    usePkiCreds: optional('USE_PKI_AGENT_CREDS', 'false') === 'true',
    agentCertPath: optional('AGENT_CERT_PATH', ''),
  };
}
