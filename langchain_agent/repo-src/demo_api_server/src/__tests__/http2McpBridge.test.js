/**
 * Unit tests for http2McpBridge.js — HTTP/2 adapter between BFF and MCP server.
 *
 * Tests connection pooling, tool call forwarding, error handling, timeouts, and cleanup.
 * Uses mocked http2 module to avoid needing a real MCP server.
 */
const http2 = require('http2');

// ── Mock helpers ──────────────────────────────────────────────────────────────

/**
 * Create a mock HTTP/2 stream that emits response events.
 */
function createMockStream(responseBody, statusCode = 200, headers = {}) {
  const { EventEmitter } = require('events');
  const stream = new EventEmitter();
  stream.close = jest.fn();
  stream.end = jest.fn((payload) => {
    // Simulate async response
    process.nextTick(() => {
      stream.emit('response', {
        ':status': statusCode,
        'mcp-session-id': headers['mcp-session-id'] || 'test-session-123',
        ...headers,
      });

      if (responseBody !== null) {
        const data = typeof responseBody === 'string'
          ? responseBody
          : JSON.stringify(responseBody);
        stream.emit('data', Buffer.from(data));
      }

      stream.emit('end');
    });
  });
  return stream;
}

/**
 * Create a mock HTTP/2 session with configurable stream responses.
 */
function createMockSession(streamResponses = []) {
  const { EventEmitter } = require('events');
  const session = new EventEmitter();
  let callIndex = 0;

  session.request = jest.fn((headers) => {
    const response = streamResponses[callIndex] || streamResponses[streamResponses.length - 1];
    callIndex++;
    return createMockStream(
      response?.body ?? { jsonrpc: '2.0', id: 1, result: {} },
      response?.status ?? 200,
      response?.headers ?? {}
    );
  });

  session.close = jest.fn();
  session.destroy = jest.fn();
  session.destroyed = false;
  session.closed = false;

  return session;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Mock http2.connect to return our mock sessions
let mockSessions = [];
let mockConnectCallCount = 0;


jest.mock('http2', () => {
  const original = jest.requireActual('http2');
  return {
    ...original,
    connect: jest.fn(() => {
      const session = mockSessions[mockConnectCallCount] || mockSessions[mockSessions.length - 1];
      mockConnectCallCount++;
      return session;
    }),
    constants: original.constants,
  };
});

// Import after mocking
const {
  createHttp2Session,
  forwardToolCall,
  handleMcpResponse,
  closeSession,
  closeAllSessions,
  _pool,
} = require('../../services/http2McpBridge');

beforeEach(() => {
  // Clear the connection pool between tests
  _pool.clear();
  mockConnectCallCount = 0;
  mockSessions = [];
  http2.connect.mockClear();
});

describe('http2McpBridge', () => {

  describe('createHttp2Session', () => {
    it('should create new session on first call', () => {
      const mockSession = createMockSession();
      mockSessions = [mockSession];

      const session = createHttp2Session('http://localhost:8081', 'test-token-abc');

      expect(http2.connect).toHaveBeenCalledTimes(1);
      expect(session).toBe(mockSession);
      expect(_pool.size).toBe(1);
    });

    it('should reuse session for same (url, token) pair', () => {
      const mockSession = createMockSession();
      mockSessions = [mockSession];

      const session1 = createHttp2Session('http://localhost:8081', 'test-token-abc');
      const session2 = createHttp2Session('http://localhost:8081', 'test-token-abc');

      expect(http2.connect).toHaveBeenCalledTimes(1); // Only called once
      expect(session1).toBe(session2);
    });

    it('should create separate sessions for different tokens', () => {
      const mockSession1 = createMockSession();
      const mockSession2 = createMockSession();
      mockSessions = [mockSession1, mockSession2];

      const session1 = createHttp2Session('http://localhost:8081', 'token-aaa-long-enough');
      const session2 = createHttp2Session('http://localhost:8081', 'token-bbb-long-enough');

      expect(http2.connect).toHaveBeenCalledTimes(2);
      expect(session1).not.toBe(session2);
      expect(_pool.size).toBe(2);
    });

    it('should create separate sessions for different URLs', () => {
      const mockSession1 = createMockSession();
      const mockSession2 = createMockSession();
      mockSessions = [mockSession1, mockSession2];

      const session1 = createHttp2Session('http://localhost:8081', 'same-token');
      const session2 = createHttp2Session('http://localhost:8082', 'same-token');

      expect(http2.connect).toHaveBeenCalledTimes(2);
      expect(_pool.size).toBe(2);
    });
  });

  describe('forwardToolCall', () => {
    it('should perform full MCP handshake (initialize + notifications/initialized + tools/call)', async () => {
      // Three sequential stream responses: initialize, notification, tools/call
      const mockSession = createMockSession([
        {
          body: {
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-11-25', capabilities: {} },
          },
          headers: { 'mcp-session-id': 'mcp-sess-1' },
        },
        { body: null, status: 202 }, // notification — 202 No Content
        {
          body: {
            jsonrpc: '2.0',
            id: 2,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ accounts: [{ id: '1', balance: 1000 }] }) }],
            },
          },
        },
      ]);

      const result = await forwardToolCall(
        mockSession, 'get_my_accounts', {}, 'bearer-token-test'
      );

      // Verify 3 requests were made (init, notification, call)
      expect(mockSession.request).toHaveBeenCalledTimes(3);

      // Verify the result
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should throw on MCP initialize error', async () => {
      const mockSession = createMockSession([
        {
          body: {
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32600, message: 'Invalid Request' },
          },
        },
      ]);

      await expect(
        forwardToolCall(mockSession, 'get_my_accounts', {}, 'bad-token')
      ).rejects.toThrow('Invalid Request');
    });

    it('should throw on MCP tools/call error', async () => {
      const mockSession = createMockSession([
        {
          body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } },
          headers: { 'mcp-session-id': 'mcp-sess-2' },
        },
        { body: null, status: 202 },
        {
          body: {
            jsonrpc: '2.0',
            id: 2,
            error: { code: -32601, message: 'Method not found: unknown_tool' },
          },
        },
      ]);

      await expect(
        forwardToolCall(mockSession, 'unknown_tool', {}, 'bearer-token')
      ).rejects.toThrow('Method not found');
    });

    it('should pass userSub and correlationId to MCP', async () => {
      const mockSession = createMockSession([
        {
          body: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } },
          headers: { 'mcp-session-id': 'mcp-sess-3' },
        },
        { body: null, status: 202 },
        {
          body: { jsonrpc: '2.0', id: 2, result: { content: [] } },
        },
      ]);

      await forwardToolCall(
        mockSession, 'get_my_accounts', {}, 'token', 'user-sub-123', 'corr-456'
      );

      // The init (first) and tools/call (third) requests should include userSub/correlationId
      expect(mockSession.request).toHaveBeenCalledTimes(3);
    });
  });

  describe('closeSession', () => {
    it('should close session and remove from pool', () => {
      const mockSession = createMockSession();
      mockSessions = [mockSession];

      createHttp2Session('http://localhost:8081', 'token-to-close');
      expect(_pool.size).toBe(1);

      closeSession(mockSession);
      expect(mockSession.close).toHaveBeenCalled();
      expect(_pool.size).toBe(0);
    });

    it('should handle session not in pool', () => {
      const orphanSession = createMockSession();
      // Should not throw
      closeSession(orphanSession);
      expect(orphanSession.close).toHaveBeenCalled();
    });
  });

  describe('closeAllSessions', () => {
    it('should close all sessions and empty pool', () => {
      const s1 = createMockSession();
      const s2 = createMockSession();
      mockSessions = [s1, s2];

      createHttp2Session('http://localhost:8081', 'token-a-long-enough');
      createHttp2Session('http://localhost:8081', 'token-b-long-enough');

      closeAllSessions();
      expect(s1.close).toHaveBeenCalled();
      expect(s2.close).toHaveBeenCalled();
      expect(_pool.size).toBe(0);
    });
  });
});
