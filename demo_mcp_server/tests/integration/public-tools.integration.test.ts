/**
 * Integration tests: public (no-auth) tools vs auth-required tools.
 * Verifies the 5 new public tools (list_account_types, list_transaction_types,
 * show_supported_currencies, get_fee_schedule, list_verticals) are advertised
 * with requiredScopes: [] and are callable with no agentToken at all, and that
 * this did not loosen auth enforcement on an existing auth-required tool.
 */

import WebSocket from 'ws';
import { BankingMCPServer, ServerConfig } from '../../src/server/BankingMCPServer';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { MCPMessage, MCPResponse, HandshakeMessage, ListToolsMessage, ToolCallMessage } from '../../src/interfaces/mcp';
import { PingOneConfig } from '../../src/interfaces/auth';
import axios from 'axios';
import { promises as fs } from 'fs';
import { join } from 'path';
import { setupIntegrationAxiosMock } from '../helpers/integrationAxiosMock';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NEW_PUBLIC_TOOLS = [
  'list_account_types',
  'list_transaction_types',
  'show_supported_currencies',
  'get_fee_schedule',
  'list_verticals',
];

describe('Integration: public vs auth-required tools', () => {
  let server: BankingMCPServer;
  let authManager: BankingAuthenticationManager;
  let sessionManager: BankingSessionManager;
  let toolProvider: BankingToolProvider;
  let bankingClient: BankingAPIClient;
  let serverConfig: ServerConfig;
  let testStoragePath: string;
  let serverPort: number;
  let ws: WebSocket;

  beforeAll(async () => {
    testStoragePath = join(__dirname, '../storage/test-public-tools-integration');
    await fs.mkdir(testStoragePath, { recursive: true });
    setupIntegrationAxiosMock(mockedAxios);

    const testConfig: PingOneConfig = {
      baseUrl: 'https://test.pingone.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: '/as/introspect',
      authorizationEndpoint: '/as/authorization',
      tokenEndpoint: '/as/token',
    };

    serverPort = 8080 + Math.floor(Math.random() * 1000) + 2000; // distinct range from other integration suites
    serverConfig = { host: 'localhost', port: serverPort, maxConnections: 100, sessionTimeout: 3600, enableLogging: false };

    authManager = new BankingAuthenticationManager(testConfig);
    sessionManager = new BankingSessionManager(testStoragePath, 'test-encryption-key-32-chars-long!', 3600, 60, { enableDetailedLogging: false });
    bankingClient = new BankingAPIClient({ baseUrl: 'http://localhost:3001', timeout: 30000 });
    toolProvider = new BankingToolProvider(bankingClient, authManager, sessionManager);
    server = new BankingMCPServer(serverConfig, authManager, sessionManager, toolProvider);

    await server.startServer();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await server.stopServer();
    authManager.destroy();
    sessionManager.destroy();
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    setupIntegrationAxiosMock(mockedAxios);

    // Fully anonymous handshake — no agentToken at all.
    ws = new WebSocket(`ws://localhost:${serverPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    await sendMessageAndWaitForResponse(ws, {
      id: 'anon-init',
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'AnonTest', version: '1.0.0' } },
    } as MCPMessage);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  });

  afterEach(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  it('tools/list advertises all 5 new public tools with requiredScopes: []', async () => {
    const listToolsMessage: ListToolsMessage = { id: 'list-1', method: 'tools/list', params: {} };
    const response = await sendMessageAndWaitForResponse(ws, listToolsMessage);

    for (const name of NEW_PUBLIC_TOOLS) {
      const tool = response.result!.tools.find((t: any) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool.requiredScopes).toEqual([]);
      expect(tool.requiresUserAuth).toBe(false);
    }
  });

  it.each(NEW_PUBLIC_TOOLS)('tools/call for %s succeeds with no agentToken and no user session', async (name) => {
    const toolCallMessage: ToolCallMessage = { id: `call-${name}`, method: 'tools/call', params: { name, arguments: {} } };
    const response = await sendMessageAndWaitForResponse(ws, toolCallMessage);

    expect(response.result).toBeDefined();
    expect(response.result!.isError).toBe(false);
    expect(response.result!.content[0].authChallenge).toBeUndefined();
  });

  it('regression: an existing auth-required tool still requires auth (does not run to completion) for a fully anonymous caller', async () => {
    const toolCallMessage: ToolCallMessage = {
      id: 'call-auth-required',
      method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    };
    const response = await sendMessageAndWaitForResponse(ws, toolCallMessage);

    // Anonymous (no agentToken, no user session) call to an auth-required tool must
    // NOT return the same clean success shape the public tools return above. In
    // practice this comes back as a JSON-RPC error (not `result`), distinct from
    // the `result.isError`-shaped failures used for e.g. invalid params.
    expect(response.result).toBeUndefined();
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32001);
    expect(response.error!.message).toBe('Authentication required');
  });

  async function sendMessageAndWaitForResponse(socket: WebSocket, message: MCPMessage): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Message timeout')), 5000);
      socket.once('message', (data) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (error) {
          reject(error);
        }
      });
      socket.send(JSON.stringify(message));
    });
  }
});
