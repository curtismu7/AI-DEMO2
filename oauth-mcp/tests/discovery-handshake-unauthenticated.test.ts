/**
 * discovery-handshake-unauthenticated.test.ts — the MCP initialization handshake
 * is mandatory and ORDERED: initialize → notifications/initialized → tools/list.
 * The first and last were already unauthenticated (discovery), but the required
 * notification between them hit the bearer gate — so a spec-compliant client
 * with no token (the PingOne Privilege gateway during Discover) got:
 *
 *   Error discovering MCP server: sending "notifications/initialized": Unauthorized
 *
 * These tests pin the fix: notifications/initialized joins the discovery
 * allowlist, and NOTHING ELSE does — other notifications and every id-bearing
 * method except initialize/tools/list still require a bearer.
 */

import { EventEmitter } from 'events';
import { IncomingMessage, ServerResponse } from 'http';
import { HttpMCPTransport, HttpMCPTransportConfig } from '../src/server/HttpMCPTransport';
import { MCPMessageHandler } from '../src/server/MCPMessageHandler';
import { BankingSessionManager } from '../src/storage/BankingSessionManager';
import { BankingAuthenticationManager } from '../src/auth/BankingAuthenticationManager';
import { BankingToolProvider } from '../src/tools/BankingToolProvider';
import { PingOneConfig } from '../src/interfaces/auth';

jest.mock('../src/server/MCPMessageHandler');
jest.mock('../src/storage/BankingSessionManager');
jest.mock('../src/auth/BankingAuthenticationManager');
jest.mock('../src/tools/BankingToolProvider');

function makeRequest(options: { body?: string; headers?: Record<string, string> }): IncomingMessage {
  const ee = new EventEmitter();
  const req = Object.assign(ee, {
    method: 'POST',
    url: '/mcp',
    headers: options.headers ?? {},
  }) as unknown as IncomingMessage;
  setImmediate(() => {
    if (options.body !== undefined) req.emit('data', Buffer.from(options.body));
    req.emit('end');
  });
  return req;
}

interface MockResponse {
  res: ServerResponse;
  statusCode: number | undefined;
  headers: Record<string, string>;
  body: string;
}

function makeResponse(): MockResponse {
  const mock: MockResponse = { statusCode: undefined, headers: {}, body: '', res: null as unknown as ServerResponse };
  mock.res = {
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      mock.statusCode = code;
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) mock.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    },
    end(data?: string | Buffer) {
      if (data) mock.body = typeof data === 'string' ? data : data.toString();
    },
    setHeader(name: string, value: string) {
      mock.headers[name.toLowerCase()] = value;
    },
  } as unknown as ServerResponse;
  return mock;
}

describe('HttpMCPTransport — handshake discovery is unauthenticated, narrowly', () => {
  let transport: HttpMCPTransport;
  let mockHandler: jest.Mocked<MCPMessageHandler>;

  const config: HttpMCPTransportConfig = {
    resourceUrl: 'https://mcp.example.com',
    authServerUrl: 'https://auth.example.com/as',
    allowedOrigins: [],
  };

  beforeEach(() => {
    const pingOneConfig: PingOneConfig = {
      baseUrl: 'https://auth.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      tokenIntrospectionEndpoint: 'https://auth.example.com/introspect',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
    };
    const mockAuthManager = new BankingAuthenticationManager(pingOneConfig) as jest.Mocked<BankingAuthenticationManager>;
    const mockSessionManager = new BankingSessionManager('path', 'key') as jest.Mocked<BankingSessionManager>;
    const mockToolProvider = {} as jest.Mocked<BankingToolProvider>;
    mockHandler = new MCPMessageHandler(mockAuthManager, mockSessionManager, mockToolProvider) as jest.Mocked<MCPMessageHandler>;

    // A tokenless request must never reach validation; if it does, fail loudly.
    mockAuthManager.validateAgentToken = jest.fn(async (_token: string) => {
      throw new Error('no token to validate');
    });
    mockHandler.handleMessage = jest.fn().mockResolvedValue(null);

    transport = new HttpMCPTransport(config, mockHandler, mockSessionManager, mockAuthManager);
  });

  async function post(body: object): Promise<MockResponse> {
    const mock = makeResponse();
    await transport.handleRequest(makeRequest({ body: JSON.stringify(body) }), mock.res, '/mcp');
    return mock;
  }

  it('accepts notifications/initialized without a bearer (202, routed to the handler)', async () => {
    const mock = await post({ method: 'notifications/initialized' }); // no id — notification
    expect(mock.statusCode).toBe(202);
    expect(mockHandler.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'notifications/initialized' }),
      expect.anything(),
    );
  });

  it('still rejects other notifications without a bearer', async () => {
    const mock = await post({ method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(mock.statusCode).toBe(401);
    expect(mockHandler.handleMessage).not.toHaveBeenCalled();
  });

  it('still rejects tools/call without a bearer', async () => {
    const mock = await post({ id: 7, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } });
    expect(mock.statusCode).toBe(401);
    expect(mockHandler.handleMessage).not.toHaveBeenCalled();
  });
});
