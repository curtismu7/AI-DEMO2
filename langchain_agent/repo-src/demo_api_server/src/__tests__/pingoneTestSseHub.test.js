'use strict';
/**
 * @file pingoneTestSseHub.test.js
 * Unit tests for the session-keyed SSE hub used by the PingOne Test Page.
 *
 * Covers: attach(), publish(), publishToken(), publishExchange(), publishApiCall()
 * and the cleanup lifecycle when a client disconnects.
 */

const {
  attach,
  publish,
  publishToken,
  publishExchange,
  publishApiCall,
} = require('../../services/pingoneTestSseHub');

function makeReq(sessionID = 'test-session') {
  return { sessionID, on: jest.fn() };
}

function makeRes() {
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  };
}

/** Extract the close-event handler registered on req */
function getCloseHandler(req) {
  const call = req.on.mock.calls.find((c) => c[0] === 'close');
  return call?.[1];
}

describe('pingoneTestSseHub — attach()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sets required SSE headers', () => {
    const req = makeReq();
    const res = makeRes();
    attach(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });

  it('calls flushHeaders to start the stream immediately', () => {
    const req = makeReq();
    const res = makeRes();
    attach(req, res);
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('writes the initial sse-connected comment', () => {
    const req = makeReq();
    const res = makeRes();
    attach(req, res);
    expect(res.write).toHaveBeenCalledWith(': sse connected\n\n');
  });

  it('sends a keepalive comment after 20 s', () => {
    const req = makeReq('keepalive-session');
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();
    jest.advanceTimersByTime(20_000);
    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('registers a close listener on req', () => {
    const req = makeReq();
    const res = makeRes();
    attach(req, res);
    const closeCall = req.on.mock.calls.find((c) => c[0] === 'close');
    expect(closeCall).toBeDefined();
  });

  it('removes subscriber and stops keepalive on req close', () => {
    const sessionId = 'cleanup-session-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    getCloseHandler(req)?.();

    // After cleanup, publish to that session must write nothing
    res.write.mockClear();
    publish(sessionId, { type: 'ping' });
    expect(res.write).not.toHaveBeenCalled();

    // keepalive timer must be stopped — no further writes after time advances
    jest.advanceTimersByTime(40_000);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('falls back to "pingone-test" when req.sessionID is absent', () => {
    const req = { on: jest.fn() }; // no sessionID
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();
    publish('pingone-test', { type: 'token', id: 'fallback' });
    expect(res.write).toHaveBeenCalledTimes(1);
  });
});

describe('pingoneTestSseHub — publish()', () => {
  it('writes a data: line with JSON payload plus t timestamp', () => {
    const sessionId = 'publish-basic-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publish(sessionId, { type: 'token', id: 'authz-token', status: 'success' });

    expect(res.write).toHaveBeenCalledTimes(1);
    const raw = res.write.mock.calls[0][0];
    expect(raw).toMatch(/^data: /);
    expect(raw).toMatch(/\n\n$/);
    const evt = JSON.parse(raw.replace(/^data: /, '').trim());
    expect(evt.type).toBe('token');
    expect(evt.id).toBe('authz-token');
    expect(typeof evt.t).toBe('number');
  });

  it('broadcasts to all subscribers for the same session', () => {
    const sessionId = 'multi-subscriber-' + Date.now();
    const req1 = makeReq(sessionId);
    const res1 = makeRes();
    const req2 = makeReq(sessionId);
    const res2 = makeRes();
    attach(req1, res1);
    attach(req2, res2);
    res1.write.mockClear();
    res2.write.mockClear();

    publish(sessionId, { type: 'ping' });

    expect(res1.write).toHaveBeenCalledTimes(1);
    expect(res2.write).toHaveBeenCalledTimes(1);
  });

  it('does not write to subscribers of a different session', () => {
    const sessionA = 'session-a-' + Date.now();
    const sessionB = 'session-b-' + Date.now();
    const req = makeReq(sessionA);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publish(sessionB, { type: 'ping' });

    expect(res.write).not.toHaveBeenCalled();
  });

  it('no-ops when sessionId is empty string', () => {
    const req = makeReq('any-session');
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();
    publish('', { type: 'ping' });
    expect(res.write).not.toHaveBeenCalled();
  });

  it('no-ops when no subscribers exist for the session', () => {
    expect(() => publish('never-attached-' + Date.now(), { type: 'ping' })).not.toThrow();
  });

  it('does not throw when a subscriber write() throws', () => {
    const sessionId = 'bad-write-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockImplementation(() => { throw new Error('stream closed'); });

    expect(() => publish(sessionId, { type: 'token', id: 'x' })).not.toThrow();
  });
});

describe('pingoneTestSseHub — publishToken()', () => {
  it('publishes type="token" with all expected fields', () => {
    const sessionId = 'pub-token-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publishToken(sessionId, {
      id: 'authz-token',
      label: 'User Access Token',
      status: 'success',
      decoded: { sub: 'u1', aud: 'api' },
      expiresAt: '2099-01-01T00:00:00Z',
    });

    const evt = JSON.parse(res.write.mock.calls[0][0].replace(/^data: /, '').trim());
    expect(evt.type).toBe('token');
    expect(evt.id).toBe('authz-token');
    expect(evt.label).toBe('User Access Token');
    expect(evt.status).toBe('success');
    expect(evt.decoded).toEqual({ sub: 'u1', aud: 'api' });
    expect(evt.expiresAt).toBe('2099-01-01T00:00:00Z');
  });

  it('includes error field on failure', () => {
    const sessionId = 'pub-token-err-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publishToken(sessionId, {
      id: 'agent-token',
      label: 'Agent CC Token',
      status: 'error',
      error: 'invalid_client',
    });

    const evt = JSON.parse(res.write.mock.calls[0][0].replace(/^data: /, '').trim());
    expect(evt.type).toBe('token');
    expect(evt.status).toBe('error');
    expect(evt.error).toBe('invalid_client');
  });
});

describe('pingoneTestSseHub — publishExchange()', () => {
  it('publishes type="exchange" with decoded, subjectDecoded, actorDecoded', () => {
    const sessionId = 'pub-exchange-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publishExchange(sessionId, {
      id: 'exchange-user-agent-to-mcp',
      label: 'User + Agent → MCP Gateway',
      status: 'success',
      decoded: { aud: 'mcp' },
      subjectDecoded: { sub: 'u1' },
      actorDecoded: { sub: 'agent' },
    });

    const evt = JSON.parse(res.write.mock.calls[0][0].replace(/^data: /, '').trim());
    expect(evt.type).toBe('exchange');
    expect(evt.id).toBe('exchange-user-agent-to-mcp');
    expect(evt.decoded).toEqual({ aud: 'mcp' });
    expect(evt.subjectDecoded).toEqual({ sub: 'u1' });
    expect(evt.actorDecoded).toEqual({ sub: 'agent' });
  });

  it('includes error field on exchange failure', () => {
    const sessionId = 'pub-exchange-err-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publishExchange(sessionId, {
      id: 'exchange-user-to-mcp',
      label: 'User → MCP Token',
      status: 'error',
      error: 'invalid_grant',
    });

    const evt = JSON.parse(res.write.mock.calls[0][0].replace(/^data: /, '').trim());
    expect(evt.type).toBe('exchange');
    expect(evt.status).toBe('error');
    expect(evt.error).toBe('invalid_grant');
  });
});

describe('pingoneTestSseHub — publishApiCall()', () => {
  it('publishes type="api_call" with method, url, status, duration, category', () => {
    const sessionId = 'pub-api-call-' + Date.now();
    const req = makeReq(sessionId);
    const res = makeRes();
    attach(req, res);
    res.write.mockClear();

    publishApiCall(sessionId, {
      method: 'POST',
      url: '/api/pingone-test/worker-token',
      status: 200,
      duration: 123,
      category: 'pingone-test',
      description: 'Worker token fetch',
    });

    const evt = JSON.parse(res.write.mock.calls[0][0].replace(/^data: /, '').trim());
    expect(evt.type).toBe('api_call');
    expect(evt.method).toBe('POST');
    expect(evt.url).toBe('/api/pingone-test/worker-token');
    expect(evt.status).toBe(200);
    expect(evt.duration).toBe(123);
    expect(evt.category).toBe('pingone-test');
  });
});
