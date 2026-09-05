/**
 * legacy-sse-transport.test.ts — the 2024-11-05 HTTP+SSE transport, added for
 * one caller: the PingOne Privilege AI Gateway's discovery client, which opens
 * a bare GET and waits for the SSE `endpoint` event instead of POSTing
 * `initialize`. Without it, registering this server as an Agentic App fails
 * with "Gateway Unreachable — Error discovering MCP server: calling
 * initialize: Unauthorized", which reads as an auth fault and is not one.
 *
 * The load-bearing test here is the LAST one. /messages delegates to
 * handlePost precisely so the bearer gate cannot diverge between transports;
 * if someone ever gives /messages its own dispatch, an unauthenticated
 * tools/call is what that mistake looks like, and that test is what catches it.
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

function makeRequest(options: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const ee = new EventEmitter();
  const req = Object.assign(ee, {
    method: options.method,
    url: options.url,
    headers: options.headers ?? {},
  }) as unknown as IncomingMessage;
  if (options.body !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(options.body as string));
      req.emit('end');
    });
  }
  return req;
}

interface MockResponse {
  res: ServerResponse;
  statusCode: number | undefined;
  headers: Record<string, string>;
  body: string;
  /** Everything written via write() — the SSE frames, for a stream response. */
  written: string;
}

function makeResponse(): MockResponse {
  const mock: MockResponse = {
    statusCode: undefined, headers: {}, body: '', written: '',
    res: null as unknown as ServerResponse,
  };
  mock.res = {
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      mock.statusCode = code;
      if (hdrs) for (const [k, v] of Object.entries(hdrs)) mock.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
      return mock.res;
    },
    write(chunk: string) {
      mock.written += chunk;
      return true;
    },
    end(data?: string | Buffer) {
      if (data) mock.body = typeof data === 'string' ? data : data.toString();
      return mock.res;
    },
    setHeader(name: string, value: string) {
      mock.headers[name.toLowerCase()] = value;
    },
  } as unknown as ServerResponse;
  return mock;
}

describe('HttpMCPTransport — legacy HTTP+SSE transport', () => {
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
    // `initialize` creates a banking session and reads its id back.
    mockSessionManager.createSession = jest.fn().mockResolvedValue({ sessionId: 'banking-session-1' });

    transport = new HttpMCPTransport(config, mockHandler, mockSessionManager, mockAuthManager);
  });

  /** Open a stream and return both the response and the session id it issued. */
  async function openStream(): Promise<{ stream: MockResponse; sessionId: string }> {
    const stream = makeResponse();
    await transport.handleRequest(makeRequest({ method: 'GET', url: '/sse' }), stream.res, '/sse');
    const match = /data: \/messages\?sessionId=([0-9a-f-]+)/.exec(stream.written);
    return { stream, sessionId: match ? match[1] : '' };
  }

  async function postMessage(
    sessionId: string,
    body: object,
    headers: Record<string, string> = {},
  ): Promise<MockResponse> {
    const mock = makeResponse();
    const url = `/messages?sessionId=${sessionId}`;
    await transport.handleRequest(
      makeRequest({ method: 'POST', url, body: JSON.stringify(body), headers }),
      mock.res,
      '/messages',
    );
    return mock;
  }

  it('GET /sse emits the endpoint event the gateway waits for', async () => {
    const { stream, sessionId } = await openStream();

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.written).toContain('event: endpoint');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('POST /messages with an unknown session id says so, rather than failing opaquely', async () => {
    const mock = await postMessage('not-a-session', { method: 'notifications/initialized' });

    expect(mock.statusCode).toBe(404);
    expect(JSON.parse(mock.body).error).toMatch(/unknown or closed/i);
  });

  /**
   * The handshake a real client performs, in the order the spec mandates. It
   * carries no MCP-Session-Id and no MCP-Protocol-Version header at any point
   * — that is the whole point of this transport, and both are what handlePost
   * would otherwise reject it for.
   */
  async function handshake(sessionId: string): Promise<void> {
    mockHandler.handleMessage = jest.fn().mockResolvedValue({ id: 0, result: {} });
    await postMessage(sessionId, { id: 0, method: 'initialize', params: {} });
    await postMessage(sessionId, { method: 'notifications/initialized' });
  }

  it('carries a tokenless tools/list discovery reply on the stream, not in the POST body', async () => {
    const { stream, sessionId } = await openStream();
    await handshake(sessionId);
    mockHandler.handleMessage = jest.fn().mockResolvedValue({
      id: 1,
      result: { tools: [{ name: 'get_my_accounts' }] },
    });

    const mock = await postMessage(sessionId, { id: 1, method: 'tools/list' });

    // The POST is only an ACK in this transport.
    expect(mock.statusCode).toBe(202);
    expect(mock.body).toBe('');
    // The reply travels on the stream.
    expect(stream.written).toContain('event: message');
    expect(stream.written).toContain('get_my_accounts');
  });

  it('remembers the session initialize created, so later messages are not "unknown session"', async () => {
    const { stream, sessionId } = await openStream();
    await handshake(sessionId);
    mockHandler.handleMessage = jest.fn().mockResolvedValue({ id: 1, result: { tools: [] } });

    await postMessage(sessionId, { id: 1, method: 'tools/list' });

    expect(stream.written).not.toContain('Unknown or expired MCP-Session-Id');
    expect(mockHandler.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'tools/list' }),
      expect.anything(),
    );
  });

  it('supplies the protocol version legacy clients predate, without overriding one they send', async () => {
    const { stream, sessionId } = await openStream();
    await handshake(sessionId);
    mockHandler.handleMessage = jest.fn().mockResolvedValue({ id: 1, result: { tools: [] } });

    // No MCP-Protocol-Version header at all — handlePost requires one on every
    // non-initialize request, so without the injection this 400s and discovery
    // dies one step after the handshake.
    await postMessage(sessionId, { id: 1, method: 'tools/list' });
    expect(stream.written).not.toContain('header is required');

    // A client that DOES send one keeps it — including an unsupported value,
    // which must still be rejected rather than silently replaced with a
    // supported one.
    await postMessage(
      sessionId,
      { id: 2, method: 'tools/list' },
      { 'mcp-protocol-version': '1999-01-01' },
    );
    expect(stream.written).toContain('Unsupported');
  });

  it('does NOT let /messages bypass the bearer gate for tools/call', async () => {
    const { sessionId } = await openStream();
    await handshake(sessionId);
    mockHandler.handleMessage = jest.fn().mockResolvedValue(null);

    const mock = await postMessage(sessionId, {
      id: 7,
      method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    });

    // 202 is only the ACK for the POST itself; what matters is that the tool
    // never ran and the captured reply was a 401.
    expect(mock.statusCode).toBe(202);
    expect(mockHandler.handleMessage).not.toHaveBeenCalled();
  });
});
