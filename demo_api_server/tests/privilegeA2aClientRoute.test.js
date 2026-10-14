const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => {
    if (req.header('x-test-unauthenticated') === 'true') {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    req.session = { id: 'browser-session-secret', user: { sub: 'browser-user-secret', ...(req.header('x-test-username') ? { username: req.header('x-test-username') } : {}) }, active_vertical: req.header('x-test-vertical') || undefined };
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

describe('what the browser is told when the agent cannot be used', () => {
  const RESTARTING = /unreachable.*may be restarting.*try again/i;

  test('a refused or restarting agent says it is unreachable and may be restarting', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3300'));

    const response = await request(createApp()).post('/api/privilege-a2a/chat').send({ message: 'hi' });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(RESTARTING);
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });

  test('an agent that answers with an error status (not a stream) is also unreachable', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } }));

    const response = await request(createApp()).post('/api/privilege-a2a/chain').send({ message: 'hi', specialist: 'refunds' });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(RESTARTING);
  });

  test('a missing shared secret is a configuration problem, not a restart', async () => {
    delete process.env.PRIVILEGE_A2A_BFF_SECRET;
    global.fetch = jest.fn();

    const response = await request(createApp()).post('/api/privilege-a2a/chat').send({ message: 'hi' });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
    expect(response.body.error).not.toMatch(/restarting/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a stream that dies mid-run ends with an error event that says it may be restarting', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode('event: trace\ndata: {"kind":"session"}\n\n'));
        controller.error(new Error('socket hang up'));
      },
    });
    global.fetch = jest.fn().mockResolvedValue(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    const response = await request(createApp()).post('/api/privilege-a2a/chat').send({ message: 'hi' });

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: error');
    expect(response.text).toMatch(/stopped responding mid-run.*may be restarting/i);
    expect(response.text).not.toContain('socket hang up');
  });
});

describe('vertical profile', () => {
  const frames = 'event: done\ndata: {}\n\n';
  const sse = () => new Response(frames, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  test('GET /profile returns the active vertical\'s agent, specialist and questions', async () => {
    const response = await request(createApp()).get('/api/privilege-a2a/profile').set('x-test-vertical', 'banking');

    expect(response.status).toBe(200);
    expect(response.body.profile).toMatchObject({
      vertical: 'banking',
      agentName: 'Super Banking agent',
      specialistName: 'Investment Advisor',
      tool: 'get_portfolio_summary',
    });
    expect(response.body.profile.questions).toHaveLength(3);
  });

  test('GET /profile is null for a vertical with no specialist, and needs a session', async () => {
    const none = await request(createApp()).get('/api/privilege-a2a/profile').set('x-test-vertical', 'oauth-teaching');
    expect(none.body).toEqual({ profile: null });

    const denied = await request(createApp()).get('/api/privilege-a2a/profile').set('x-test-unauthenticated', 'true');
    expect(denied.status).toBe(401);
  });

  test('chat and chain forward the session\'s profile and ignore a vertical sent by the browser', async () => {
    global.fetch = jest.fn(() => Promise.resolve(sse()));

    await request(createApp()).post('/api/privilege-a2a/chat').set('x-test-vertical', 'healthcare')
      .send({ message: 'hi', vertical: 'banking', specialistName: 'Investment Advisor' });
    await request(createApp()).post('/api/privilege-a2a/chain').set('x-test-vertical', 'healthcare')
      .send({ message: 'hi', specialist: 'refunds', vertical: 'banking' });

    const chat = JSON.parse(global.fetch.mock.calls[0][1].body);
    const chain = JSON.parse(global.fetch.mock.calls[1][1].body);
    for (const body of [chat, chain]) {
      expect(body).toMatchObject({ vertical: 'healthcare', specialistName: 'Records Specialist', agentName: 'CareConnect agent' });
    }
    expect(chain.specialist).toBe('refunds');
  });

  test('a vertical with no specialist forwards no profile fields', async () => {
    global.fetch = jest.fn(() => Promise.resolve(sse()));

    await request(createApp()).post('/api/privilege-a2a/chat').set('x-test-vertical', 'oauth-teaching').send({ message: 'hi' });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ message: 'hi' });
  });
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
      .set('x-test-vertical', 'sporting-goods')
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
    // The vertical's profile is added from the server-side session; nothing else is forwarded.
    expect(JSON.parse(init.body)).toEqual({
      message: 'Review Carol Nguyen',
      vertical: 'sporting-goods',
      agentName: 'Super Sports agent',
      specialistName: 'Membership Specialist',
      tool: 'sensitive_membership_details',
      tools: ['sensitive_membership_details'],
      subtaskHint: 'review the sensitive membership details',
      sessionId: 'opaque-session-7',
    });
    const headers = new Headers(init.headers);
    expect(headers.get('x-a2a-bff-secret')).toBe('server-only-shared-secret');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('forwards only the session username as userName, never the sub or a browser-supplied one', async () => {
    global.fetch = jest.fn(async () => new Response('event: done\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    await request(createApp())
      .post('/api/privilege-a2a/chat')
      .set('x-test-username', 'demouser')
      .send({ message: 'hi', userName: 'attacker' })
      .expect(200);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).userName).toBe('demouser');
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
    expect(response.body).toEqual({ error: 'The A2A agent is unreachable. It may be restarting; try again in a few seconds.' });
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

describe('POST /api/privilege-a2a/chain', () => {
  test('relays the chain stream and forwards only the message, specialist and the session\'s vertical profile', async () => {
    const frames = 'event: trace\ndata: {"kind":"delegate","from":"main","to":"langchainagent"}\n\n'
      + 'event: done\ndata: {}\n\n';
    global.fetch = jest.fn().mockResolvedValue(new Response(frames, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const response = await request(createApp())
      .post('/api/privilege-a2a/chain')
      .set('x-test-vertical', 'banking')
      .send({ message: ' Refund order 7 ', specialist: 'refunds', sessionId: 'ignored', token: 'ignored' });

    expect(response.status).toBe(200);
    expect(response.text).toBe(frames);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://a2a-main.test:3300/chain');
    expect(JSON.parse(init.body)).toEqual({
      message: 'Refund order 7',
      specialist: 'refunds',
      vertical: 'banking',
      agentName: 'Super Banking agent',
      specialistName: 'Investment Advisor',
      tool: 'get_portfolio_summary',
      tools: ['get_portfolio_summary', 'get_investment_accounts', 'get_investment_balance', 'get_investment_transactions'],
      subtaskHint: 'review the customer’s investment positions',
    });
    expect(init.headers['X-A2A-BFF-Secret']).toBe('server-only-shared-secret');
    expect(JSON.stringify(init)).not.toContain('browser-session-secret');
  });

  test('forwards the poisoned-card request only as a literal true', async () => {
    const sse = () => new Response('event: done\ndata: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    global.fetch = jest.fn(() => Promise.resolve(sse()));

    await request(createApp()).post('/api/privilege-a2a/chain').send({ message: 'hi', specialist: 'refunds', relayCardText: true });
    await request(createApp()).post('/api/privilege-a2a/chain').send({ message: 'hi', specialist: 'refunds', relayCardText: 'true' });
    await request(createApp()).post('/api/privilege-a2a/chain').send({ message: 'hi', specialist: 'refunds' });

    const forwarded = global.fetch.mock.calls.map(call => JSON.parse(call[1].body).relayCardText);
    expect(forwarded).toEqual([true, undefined, undefined]);
  });

  test('rejects a missing session, an empty message, and a malformed specialist name', async () => {
    global.fetch = jest.fn();
    const app = createApp();

    const unauthenticated = await request(app).post('/api/privilege-a2a/chain')
      .set('x-test-unauthenticated', 'true').send({ message: 'hi', specialist: 'refunds' });
    const noMessage = await request(app).post('/api/privilege-a2a/chain').send({ message: ' ', specialist: 'refunds' });
    const badName = await request(app).post('/api/privilege-a2a/chain')
      .send({ message: 'hi', specialist: '../admin' });

    expect(unauthenticated.status).toBe(401);
    expect(noMessage.status).toBe(400);
    expect(badName.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
