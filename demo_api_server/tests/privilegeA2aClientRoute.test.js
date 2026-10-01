const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => {
    if (req.header('x-test-unauthenticated') === 'true') {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    req.session = { id: 'browser-session-secret', user: { sub: 'browser-user-secret' } };
    return next();
  },
}));

const privilegeA2aClientRoute = require('../routes/privilegeA2aClient');

const originalFetch = global.fetch;
const originalMainUrl = process.env.PRIVILEGE_A2A_MAIN_URL;
const originalSharedSecret = process.env.PRIVILEGE_A2A_BFF_SECRET;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/privilege-a2a', privilegeA2aClientRoute);
  return app;
}

beforeEach(() => {
  process.env.PRIVILEGE_A2A_MAIN_URL = 'http://a2a-main.test:3300';
  process.env.PRIVILEGE_A2A_BFF_SECRET = 'server-only-shared-secret';
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalMainUrl === undefined) delete process.env.PRIVILEGE_A2A_MAIN_URL;
  else process.env.PRIVILEGE_A2A_MAIN_URL = originalMainUrl;
  if (originalSharedSecret === undefined) delete process.env.PRIVILEGE_A2A_BFF_SECRET;
  else process.env.PRIVILEGE_A2A_BFF_SECRET = originalSharedSecret;
  jest.restoreAllMocks();
});

describe('POST /api/privilege-a2a/chat', () => {
  test('rejects a missing app session before contacting the main agent', async () => {
    global.fetch = jest.fn();

    const response = await request(createApp())
      .post('/api/privilege-a2a/chat')
      .set('x-test-unauthenticated', 'true')
      .send({ message: 'Review access' });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('relays SSE while forwarding only the allowed body fields and server secret', async () => {
    const frames = 'event: trace\ndata: {"kind":"delegate","text":"main → analyst"}\n\n'
      + 'event: token\ndata: {"text":"Review complete."}\n\n'
      + 'event: done\ndata: {"sessionId":"opaque-session-7"}\n\n';
    global.fetch = jest.fn().mockResolvedValue(new Response(frames, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const response = await request(createApp())
      .post('/api/privilege-a2a/chat')
      .set('Accept', 'text/event-stream')
      .set('Authorization', 'Bearer browser-oauth-token')
      .set('Cookie', 'sid=browser-cookie')
      .send({
        message: 'Review Carol Nguyen',
        sessionId: 'opaque-session-7',
        sub: 'browser-user-secret',
        act: { sub: 'browser-actor-secret' },
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    expect(response.text).toContain('event: trace');
    expect(response.text).toContain('event: token');
    expect(response.text).toContain('event: done');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://a2a-main.test:3300/chat');
    expect(JSON.parse(init.body)).toEqual({
      message: 'Review Carol Nguyen',
      sessionId: 'opaque-session-7',
    });
    const headers = new Headers(init.headers);
    expect(headers.get('x-a2a-bff-secret')).toBe('server-only-shared-secret');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('rejects an empty or overlong message before contacting the main agent', async () => {
    global.fetch = jest.fn();

    const empty = await request(createApp()).post('/api/privilege-a2a/chat').send({ message: '  ' });
    const long = await request(createApp()).post('/api/privilege-a2a/chat').send({ message: 'x'.repeat(4001) });

    expect(empty.status).toBe(400);
    expect(long.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns a normalized 502 if the main agent is unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('socket failed with secret details'));

    const response = await request(createApp())
      .post('/api/privilege-a2a/chat')
      .send({ message: 'Review access' });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'A2A service unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('secret details');
  });

  test('aborts the main-agent stream when the browser disconnects', async () => {
    const nativeFetch = originalFetch;
    let upstreamSignal;
    let notifyUpstreamStarted;
    const upstreamStarted = new Promise(resolve => { notifyUpstreamStarted = resolve; });
    global.fetch = jest.fn((input, init) => {
      if (String(input).startsWith('http://a2a-main.test:3300/')) {
        upstreamSignal = init.signal;
        notifyUpstreamStarted();
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => controller.error(new Error('upstream aborted')));
          },
        }), { headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return nativeFetch(input, init);
    });

    const server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    const browserAbort = new AbortController();
    try {
      const responsePromise = nativeFetch(`http://127.0.0.1:${address.port}/api/privilege-a2a/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Review access' }),
        signal: browserAbort.signal,
      });
      const response = await responsePromise;
      await upstreamStarted;
      expect(response.status).toBe(200);
      browserAbort.abort();
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(upstreamSignal.aborted).toBe(true);
      await response.body.cancel().catch(() => undefined);
    } finally {
      browserAbort.abort();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
