'use strict';

/**
 * CIBA second factor for a parked password flow (routes/cibaLogin.js + services/cibaSecondFactorService.js).
 * cibaService and the parked-flow handlers are mocked: no PingOne, no sockets except one loopback server.
 */

jest.mock('../services/cibaService', () => ({
  initiateBackchannelAuth: jest.fn(),
  pollForTokens: jest.fn(),
  validateCibaIdToken: jest.fn(),
}));
jest.mock('../services/configStore', () => ({ getEffective: jest.fn(() => ''), getOAuthProvider: jest.fn(() => 'pingone') }));
jest.mock('../services/verticalManifest', () => ({
  verticalManifest: { resolver: { activeIdFor: jest.fn(() => 'banking') } },
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const cibaService = require('../services/cibaService');
const configStore = require('../services/configStore');
const svc = require('../services/cibaSecondFactorService');
const routes = require('../routes/cibaLogin');

jest.setTimeout(30000);

const USER = { id: 'p1-user-1', username: 'alice', email: 'alice@example.com', mobilePhone: '+15555550100', enabled: true };
let clock;
const complete = jest.fn();
const discard = jest.fn();

// Session-backed fake of the Task-1 handlers: a parked flow lives in req.session like the real one.
const fakeHandlers = {
  getParkedFlow: (req) => (req.session.parked && clock - (req.session.parked.parkedAt ?? clock) <= 150_000 ? { expectedSub: req.session.parked.expectedSub, username: req.session.parked.user.username, user: req.session.parked.user } : null),
  getParkedRemainingMs: (req) => (req.session.parked ? 150_000 - (clock - (req.session.parked.parkedAt ?? clock)) : null),
  discardParkedFlow: (req) => { discard(); delete req.session.parked; },
  completeParkedFlow: async (req) => { await complete(req); delete req.session.parked; return { redirectTo: 'http://localhost:3000/dashboard?oauth=success' }; },
};

let server;
beforeAll(async () => {
  const app = express();
  app.set('trust proxy', true);
  // No keep-alive: a reused idle socket racing the server's close was the source of intermittent
  // ECONNRESET under CPU load (superagent on Node >= 19 reuses sockets by default).
  app.use((req, res, next) => { res.set('Connection', 'close'); next(); });
  app.use(express.json());
  app.use(session({ secret: 's', resave: false, saveUninitialized: false }));
  // Test-only: park a flow the way the password step does (body is test setup, not the code under test).
  app.post('/park', (req, res) => { req.session.parked = req.body; res.json({ ok: true }); });
  app.get('/parked', (req, res) => res.json({ parked: !!req.session.parked }));
  app.use('/api/auth/ciba/login', routes);
  server = require('http').createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));   // settled before any request
});
afterAll(() => server.close());

const parkBody = (user = USER, sub = user.id) => ({ expectedSub: sub, user });
const parkedAtAgo = async (ms) => { const a = request.agent(server); await a.post('/park').set('X-Forwarded-For', '10.0.0.1').send({ ...parkBody(), parkedAt: clock - ms }); return a; };
async function parked(user, ip) {
  const agent = request.agent(server);
  await agent.post('/park').set('X-Forwarded-For', ip || '10.0.0.1').send(parkBody(user));
  return agent;
}
const start = (agent, channel = 'email', ip = '10.0.0.1') => agent.post('/api/auth/ciba/login/start').set('X-Forwarded-For', ip).set('Content-Type', 'application/json').send({ channel });
const poll = (agent, id) => agent.get(`/api/auth/ciba/login/poll/${id}`);
const pendingErr = () => Object.assign(new Error('x'), { response: { data: { error: 'authorization_pending' } } });
const pingErr = (error) => Object.assign(new Error(`secret detail ${error}`), { response: { data: { error, error_description: 'LEAKY-DETAIL' } } });

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getEffective.mockImplementation((k) => (k === 'ciba_login_enabled' ? 'true' : ''));
  clock = 1_000_000;
  svc._test.reset();
  svc._test.setNow(() => clock);
  svc._test.setHandlers(fakeHandlers);
  cibaService.initiateBackchannelAuth.mockResolvedValue({ auth_req_id: 'PING-AR-1', expires_in: 120, interval: 2, binding_message: 'BK1A2B3C' });
  cibaService.pollForTokens.mockResolvedValue({ id_token: 'idt', access_token: 'at' });
  cibaService.validateCibaIdToken.mockImplementation(async (_t, sub) => ({ sub }));
});

describe('start', () => {
  it('(a) 409 and no CIBA request without a parked flow', async () => {
    const res = await start(request.agent(server));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'no_parked_flow' });
    expect(cibaService.initiateBackchannelAuth).not.toHaveBeenCalled();
  });

  it('(b) uses the parked user + chosen channel, returns our own authReqId and never PingOne\'s', async () => {
    const res = await start(await parked(), 'sms');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authReqId: expect.stringMatching(/^[0-9a-f]{48}$/), matchCode: 'BK1A2B3C', expiresIn: 120, interval: 2 });
    expect(JSON.stringify(res.body)).not.toContain('PING-AR-1');
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledTimes(1);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith(USER.id, 'Approve sign-in', 'openid', '', 'sms', 'banking');
  });

  it('(c) a channel the user lacks -> 400 and nothing sent', async () => {
    const noPhone = await start(await parked({ ...USER, mobilePhone: '' }), 'sms');
    const noEmail = await start(await parked({ ...USER, email: '' }), 'email');
    expect([noPhone.status, noPhone.body.error]).toEqual([400, 'channel_unavailable']);
    expect([noEmail.status, noEmail.body.error]).toEqual([400, 'channel_unavailable']);
    expect(cibaService.initiateBackchannelAuth).not.toHaveBeenCalled();
  });

  it('(d) 6th start per IP -> 429 with no extra CIBA request', async () => {
    const agent = await parked();
    // distinct users per attempt would hide the IP cap, so vary only the user via new parked sessions
    for (let i = 0; i < 5; i += 1) {
      const a = await parked({ ...USER, id: `u${i}` });
      expect((await start(a)).status).toBe(200);
    }
    const res = await start(agent);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledTimes(5);
  });

  it('(d) 6th send per user (from varied IPs) -> 429 with no extra CIBA request', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await start(await parked(USER, `10.1.0.${i}`), 'email', `10.1.0.${i}`)).status).toBe(200);
    }
    const res = await start(await parked(USER, '10.1.0.99'), 'email', '10.1.0.99');
    expect(res.status).toBe(429);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledTimes(5);
  });

  it('(m) a CIBA failure -> 502 approval_unavailable, nothing simulated, parked flow kept', async () => {
    process.env.CIBA_LOCAL_SIMULATION = 'true';
    try {
      cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('PingOne down'));
      const agent = await parked();
      const res = await start(agent);
      expect([res.status, res.body]).toEqual([502, { error: 'approval_unavailable' }]);
      expect((await agent.get('/parked')).body.parked).toBe(true);
      expect(complete).not.toHaveBeenCalled();
    } finally { delete process.env.CIBA_LOCAL_SIMULATION; }
  });

  it('(n) body/query claiming another user changes nothing', async () => {
    const agent = await parked();
    await agent.post('/api/auth/ciba/login/start?userId=evil&expectedSub=evil').set('X-Forwarded-For', '10.0.0.1')
      .set('Content-Type', 'application/json').send({ channel: 'email', userId: 'evil', expectedSub: 'evil', identifier: 'evil' });
    expect(cibaService.initiateBackchannelAuth.mock.calls[0][0]).toBe(USER.id);
    const start2 = await start(agent);
    const polled = await poll(agent, start2.body.authReqId);
    expect(polled.status).toBe(200);
    expect(cibaService.validateCibaIdToken).toHaveBeenCalledWith('idt', USER.id, '', 'email');
  });
});

describe('poll', () => {
  async function started(channel = 'email') {
    const agent = await parked();
    const res = await start(agent, channel);
    return { agent, id: res.body.authReqId };
  }

  it('(e) pending then approved with a matching sub completes ONCE', async () => {
    const { agent, id } = await started();
    cibaService.pollForTokens.mockRejectedValueOnce(pendingErr());
    expect((await poll(agent, id)).body).toEqual({ status: 'pending' });
    const ok = await poll(agent, id);
    expect([ok.status, ok.body]).toEqual([200, { status: 'approved', redirectTo: 'http://localhost:3000/dashboard?oauth=success' }]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(cibaService.pollForTokens).toHaveBeenLastCalledWith('PING-AR-1', 'email');
    expect(cibaService.validateCibaIdToken).toHaveBeenCalledWith('idt', USER.id, '', 'email');
  });

  it('(f) approved with a DIFFERENT sub -> denied, parked discarded, not completed', async () => {
    cibaService.validateCibaIdToken.mockRejectedValue(new Error('CIBA subject does not match the initiating user'));
    const { agent, id } = await started();
    const res = await poll(agent, id);
    expect([res.status, res.body]).toEqual([403, { status: 'denied' }]);
    expect(discard).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect((await poll(agent, id)).status).toBe(410);
  });

  it('(g) access_denied -> denied, expired_token -> expired, unknown error -> expired without leaking text', async () => {
    let r;
    let s = await started();
    cibaService.pollForTokens.mockRejectedValueOnce(pingErr('access_denied'));
    r = await poll(s.agent, s.id);
    expect([r.status, r.body]).toEqual([403, { status: 'denied' }]);
    expect(discard).toHaveBeenCalledTimes(1);

    s = await started();
    cibaService.pollForTokens.mockRejectedValueOnce(pingErr('expired_token'));
    r = await poll(s.agent, s.id);
    expect([r.status, r.body]).toEqual([410, { status: 'expired' }]);
    expect(discard).toHaveBeenCalledTimes(2);

    s = await started();
    cibaService.pollForTokens.mockRejectedValueOnce(pingErr('server_error'));
    r = await poll(s.agent, s.id);
    expect([r.status, r.body]).toEqual([410, { status: 'expired' }]);
    expect(JSON.stringify(r.body) + r.text).not.toMatch(/LEAKY|secret detail|server_error/);
    expect(discard).toHaveBeenCalledTimes(3);
    expect(complete).not.toHaveBeenCalled();
  });

  it('(h) replay after success -> 410 and no second completion', async () => {
    const { agent, id } = await started();
    expect((await poll(agent, id)).status).toBe(200);
    expect((await poll(agent, id)).status).toBe(410);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('(h) tombstone is set BEFORE completing: a re-entrant poll during completion cannot complete twice', async () => {
    const { agent, id } = await started();
    let inner;
    complete.mockImplementationOnce((req) => { inner = svc.pollSecondFactor({ authReqId: id, req }); });
    const first = await poll(agent, id);
    expect(first.status).toBe(200);
    expect((await inner).status).toBe('expired');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('(i) a poll from a different browser session -> 404 and nothing completes', async () => {
    const { id } = await started();
    const other = await parked(USER, '10.0.0.7');
    const res = await poll(other, id);
    expect(res.status).toBe(404);
    expect(cibaService.pollForTokens).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('(j) an entry older than 150 s -> expired and the parked flow discarded', async () => {
    const { agent, id } = await started();
    clock += 150 * 1000;
    const res = await poll(agent, id);
    expect([res.status, res.body]).toEqual([410, { status: 'expired' }]);
    expect(discard).toHaveBeenCalled();
    expect(cibaService.pollForTokens).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('(l) a PingFederate sign-in behaves exactly like PingOne (no provider_unsupported)', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const agent = request.agent(server);
    await agent.post('/park').set('X-Forwarded-For', '10.0.0.1').send({ ...parkBody(), provider: 'pingfederate' });
    const res = await start(agent);
    expect(res.status).toBe(200);
    expect((await poll(agent, res.body.authReqId)).body.status).toBe('approved');
  });
});

describe('fix round 1', () => {
  const B = { ...USER, id: 'p1-user-2', username: 'bob' };
  const repark = (agent, user) => agent.post('/park').set('X-Forwarded-For', '10.0.0.1').send(parkBody(user));

  it('M1 an old entry after the session was restarted as someone else -> expired, B parked flow survives and B completes', async () => {
    const agent = await parked(USER);
    const a = await start(agent);
    await repark(agent, B);
    const old = await poll(agent, a.body.authReqId);
    expect([old.status, old.body]).toEqual([410, { status: 'expired' }]);
    expect(discard).not.toHaveBeenCalled();
    expect(cibaService.pollForTokens).not.toHaveBeenCalled();
    expect((await agent.get('/parked')).body.parked).toBe(true);
    const b = await start(agent);
    expect(cibaService.initiateBackchannelAuth.mock.calls[1][0]).toBe(B.id);
    expect((await poll(agent, b.body.authReqId)).body.status).toBe('approved');
    expect(cibaService.validateCibaIdToken).toHaveBeenLastCalledWith('idt', B.id, '', 'email');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('M1 validation uses the sub bound at start', async () => {
    const agent = await parked(USER);
    const a = await start(agent);
    await poll(agent, a.body.authReqId);
    expect(cibaService.validateCibaIdToken).toHaveBeenCalledWith('idt', USER.id, '', 'email');
  });

  it('M3 a vertical WITHOUT a vertical code gets a random 6-hex match code (coded verticals get 8 chars: 2-char code + 6 hex); never a literal word', async () => {
    require('../services/verticalManifest').verticalManifest.resolver.activeIdFor.mockReturnValueOnce('shared');
    cibaService.initiateBackchannelAuth.mockImplementationOnce(async (_h, msg) => ({
      auth_req_id: 'PING-AR-1', expires_in: 120, interval: 2,
      binding_message: msg.length > 8 ? require('crypto').randomBytes(3).toString('hex').toUpperCase() : msg,
    }));
    const res = await start(await parked());
    expect(res.body.matchCode).toMatch(/^[0-9A-F]{6}$/);
    expect(cibaService.initiateBackchannelAuth.mock.calls[0][1].length).toBeGreaterThan(8);
  });

  it('M4 expiresIn = min(PingOne expires_in, 120) and the pending TTL follows it', async () => {
    cibaService.initiateBackchannelAuth.mockResolvedValueOnce({ auth_req_id: 'P', expires_in: 60, interval: 2, binding_message: 'BK1A2B3C' });
    const agent = await parked();
    const res = await start(agent);
    expect(res.body.expiresIn).toBe(60);
    clock += 91 * 1000;
    expect((await poll(agent, res.body.authReqId)).status).toBe(410);
    cibaService.initiateBackchannelAuth.mockResolvedValueOnce({ auth_req_id: 'P', expires_in: 900, interval: 2, binding_message: 'BK1A2B3C' });
    expect((await start(await parked(USER, '10.5.0.1'), 'email', '10.5.0.1')).body.expiresIn).toBe(120);
  });

  it('M5 a capacity 429 consumes no rate-limit slot', async () => {
    svc._test.setMaxEntries(0);
    for (let i = 0; i < 6; i += 1) expect((await start(await parked(), 'email', '10.6.0.1')).status).toBe(429);
    svc._test.setMaxEntries(5000);
    expect((await start(await parked(), 'email', '10.6.0.1')).status).toBe(200);
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledTimes(1);
  });

  it('M6 two concurrent polls: exactly one completes, the other is pending (gated, timer-free)', async () => {
    const agent = await parked();
    const { authReqId } = (await start(agent)).body;
    let release;
    cibaService.pollForTokens.mockImplementation(() => new Promise((r) => { release = () => r({ id_token: 'idt' }); }));
    const first = poll(agent, authReqId).then((r) => r);   // sent now; held inside pollForTokens
    while (!release) await new Promise((r) => setImmediate(r));
    const second = await poll(agent, authReqId);            // returns while the first is still in flight
    expect(second.body).toEqual({ status: 'pending' });
    release();
    expect((await first).body.status).toBe('approved');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(cibaService.pollForTokens).toHaveBeenCalledTimes(1);
  });

  it('M4 expiresIn is an integer >= 1 capped at 120 (0.5 -> 1, NaN/negative/huge/absent -> 120)', async () => {
    const cases = [[0.5, 1], [59.2, 60], [NaN, 120], [-5, 120], [1e9, 120], [undefined, 120], ['abc', 120]];
    for (const [i, [given, want]] of cases.entries()) {
      cibaService.initiateBackchannelAuth.mockResolvedValueOnce({ auth_req_id: 'P', expires_in: given, interval: 2, binding_message: 'BK1A2B3C' });
      const ip = `10.7.0.${i}`;
      expect((await start(await parked({ ...USER, id: `x${i}` }, ip), 'email', ip)).body.expiresIn).toBe(want);
    }
  });
});

describe('final review', () => {
  it('M3 expiresIn is capped at the parked flow\'s remaining life (40 s used -> <= 110), fresh start unchanged', async () => {
    const res = await start(await parkedAtAgo(40_000));
    expect(res.body.expiresIn).toBeLessThanOrEqual(110);
    expect(res.body.expiresIn).toBeGreaterThanOrEqual(109);
    const fresh = await start(await parked(USER, '10.8.0.1'), 'email', '10.8.0.1');
    expect(fresh.body.expiresIn).toBe(120);
  });

  it('M3 near the end the cap is >= 1; past the window there is no parked flow (409)', async () => {
    expect((await start(await parkedAtAgo(149_500))).body.expiresIn).toBe(1);
    const gone = await start(await parkedAtAgo(151_000));
    expect(gone.status).toBe(409);
  });

  it('M3 the pending TTL follows the capped value', async () => {
    const agent = await parkedAtAgo(100_000);   // 50 s left
    const res = await start(agent);
    expect(res.body.expiresIn).toBe(50);
    clock += 81 * 1000;                          // 50 s + 30 s grace passed
    const poll1 = await poll(agent, res.body.authReqId);
    expect(poll1.status).toBe(410);
  });

  it.each(['TRUE', 'True'])('M1 flag %s keeps the routes live; false/0/empty stay off', async (v) => {
    configStore.getEffective.mockReturnValue(v);
    expect((await start(await parked())).status).toBe(200);
    for (const off of ['false', '0', '', undefined]) {
      configStore.getEffective.mockReturnValue(off);
      expect((await request.agent(server).get(`/api/auth/ciba/login/poll/${'a'.repeat(48)}`)).status).toBe(404);
      expect((await request.agent(server).get(`/api/auth/ciba/login/poll/${'a'.repeat(48)}`)).body).toEqual({ error: 'ciba_login_disabled' });
    }
  });
});

describe('(k) flag off', () => {
  it('every route 404 ciba_login_disabled before the 415/400 checks', async () => {
    configStore.getEffective.mockReturnValue('false');
    const agent = request.agent(server);
    const a = await agent.post('/api/auth/ciba/login/start').set('Content-Type', 'text/plain').send('x');
    const b = await agent.post('/api/auth/ciba/login/start').send({ channel: 'pager' });
    const c = await agent.get(`/api/auth/ciba/login/poll/${'a'.repeat(48)}`);
    const d = await agent.get('/api/auth/ciba/login/poll/not-hex');
    for (const r of [a, b, c, d]) expect([r.status, r.body]).toEqual([404, { error: 'ciba_login_disabled' }]);
    expect(cibaService.initiateBackchannelAuth).not.toHaveBeenCalled();
  });

  it('start requires JSON when enabled (415) and a valid channel (400)', async () => {
    const agent = await parked();
    expect((await agent.post('/api/auth/ciba/login/start').set('Content-Type', 'application/x-www-form-urlencoded').send('channel=email')).status).toBe(415);
    expect((await start(agent, 'pager')).status).toBe(400);
  });
});
