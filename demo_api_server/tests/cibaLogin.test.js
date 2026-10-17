'use strict';

/**
 * CIBA passwordless login: POST /start + GET /poll/:id (routes/cibaLogin.js, services/cibaLoginService.js).
 * Everything outside the service is mocked: no PingOne, no sockets except supertest's loopback.
 */

process.env.CIBA_LOGIN_START_FLOOR_MS = '0';
process.env.CIBA_LOGIN_POLL_FLOOR_MS = '0';

jest.mock('axios');
jest.mock('../config/oauthUser', () => ({
  clientId: 'user-client', clientSecret: 'user-secret',
  scopes: ['openid', 'profile', 'email', 'offline_access', 'read', 'accounts:read', 'write', 'transfer', 'ai:agent:read'],
  _base: 'https://auth.test/env/as', tokenEndpoint: 'https://auth.test/env/as/token',
  jwksEndpoint: 'https://auth.test/env/as/jwks', issuer: 'https://auth.test/env/as',
}));
jest.mock('../config/oauth', () => ({
  clientId: 'admin-client', clientSecret: 'admin-secret',
  scopes: ['openid', 'profile', 'email', 'offline_access', 'admin:all'],
  _base: 'https://auth.test/env/as', tokenEndpoint: 'https://auth.test/env/as/token',
  cibaEndpoint: 'https://auth.test/env/as/cibaAuthorization',
  jwksEndpoint: 'https://auth.test/env/as/jwks', issuer: 'https://auth.test/env/as',
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => ''), getOAuthProvider: jest.fn(() => 'pingone'),
}));
jest.mock('../services/pingOneUserLookupService', () => ({ resolvePingOneIdentifier: jest.fn() }));
jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
jest.mock('../services/oidcIdTokenValidationService', () => ({ assertUserInfoSubjectMatches: jest.fn() }));
jest.mock('../services/userSessionService', () => ({ establishUserSession: jest.fn() }));
jest.mock('../services/adminSessionService', () => ({ establishAdminSession: jest.fn() }));
jest.mock('../services/authStateCookie', () => ({ setAuthCookie: jest.fn(), clearAuthCookie: jest.fn() }));
jest.mock('../services/hostedAccessPolicy', () => ({
  clearHostedAccessApproval: jest.fn(),
  loadHostedAccessPolicy: jest.fn(() => ({ enabled: false })),
  evaluateHostedIdentity: jest.fn(() => ({ allowed: true, reason: 'gate_disabled' })),
  coherentHostedIdentityClaims: jest.fn((a) => a),
  stampHostedAccessApproval: jest.fn(),
}));
jest.mock('../services/verticalManifest', () => ({
  verticalManifest: { resolver: { activeIdFor: jest.fn(() => 'banking') } },
}));
jest.mock('../middleware/auth', () => ({ determineClientType: jest.fn(() => 'user') }));
jest.mock('../services/oauthRedirectUris', () => ({ getFrontendOrigin: jest.fn(() => 'http://localhost:3000') }));
jest.mock('../routes/oauthUser', () => ({ reseedIfVerticalMismatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../data/store', () => ({
  getUserByUsername: jest.fn(() => null),
  createUser: jest.fn(async (u) => ({ ...u, id: 'local-1' })),
  updateUser: jest.fn(async (id, u) => ({ id, ...u })),
}));
const mockOAuthUser = {
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn((i) => ({ id: i.sub, username: i.preferred_username, email: i.email, firstName: '', lastName: '', role: 'customer', oauthProvider: 'pingone', oauthIssuer: i.iss, oauthId: i.sub })),
};
jest.mock('../services/oauthUserService', () => mockOAuthUser);
jest.mock('../services/oauthService', () => ({
  getUserInfo: jest.fn(),
  createUserFromOAuth: jest.fn((i) => ({ id: i.sub, username: i.preferred_username, email: i.email, role: 'customer', oauthProvider: 'pingone', oauthId: i.sub })),
}));

const express = require('express');
const session = require('express-session');
const request = require('supertest');
const axios = require('axios');
const { resolvePingOneIdentifier } = require('../services/pingOneUserLookupService');
const { validateToken } = require('../services/tokenValidationService');
const { establishUserSession } = require('../services/userSessionService');
const { establishAdminSession } = require('../services/adminSessionService');
const { setAuthCookie, clearAuthCookie } = require('../services/authStateCookie');
const configStore = require('../services/configStore');
const hosted = require('../services/hostedAccessPolicy');
const adminOAuthService = require('../services/oauthService');
const cibaLoginService = require('../services/cibaLoginService');
const cibaLoginRoutes = require('../routes/cibaLogin');

const POLICY_EMAIL = '99972880d9170ab70d72e269cc944186';
const POLICY_SMS = '87929b3e4c6857e5ff854502dbde1742';
const FULL_SCOPE = 'openid profile email offline_access read accounts:read write transfer ai:agent:read';
const REAL = { id: 'p1-user-1', username: 'alice', email: 'alice@example.com', mobilePhone: '+15555550100', enabled: true };

let clock;
function makeApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(session({ secret: 's', resave: false, saveUninitialized: false }));
  app.use('/api/auth/ciba/login', cibaLoginRoutes);
  return app;
}
const body = (over = {}) => ({ identifier: 'alice', channel: 'email', role: 'customer', ...over });
const start = (agent, over) => agent.post('/api/auth/ciba/login/start').set('Content-Type', 'application/json').send(body(over));
const poll = (agent, id) => agent.get(`/api/auth/ciba/login/poll/${id}`);
const cibaPosts = () => axios.post.mock.calls.filter(([u]) => u.endsWith('/cibaAuthorization'));
const tokenPosts = () => axios.post.mock.calls.filter(([u]) => u.endsWith('/token'));

function mockPingOne({ tokenReplies = [] } = {}) {
  const replies = [...tokenReplies];
  axios.post.mockImplementation(async (url) => {
    if (url.endsWith('/cibaAuthorization')) return { data: { auth_req_id: 'PING-AR-1', expires_in: 120, interval: 2 } };
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return { data: next };
  });
}
const pendingErr = () => Object.assign(new Error('pending'), { response: { data: { error: 'authorization_pending' } } });
const TOKENS = { access_token: 'at', id_token: 'idt', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer', scope: FULL_SCOPE };

beforeEach(() => {
  jest.clearAllMocks();
  configStore.getEffective.mockImplementation((k) => (k === 'admin_username' ? 'alice' : ''));
  configStore.getOAuthProvider.mockReturnValue('pingone');
  clock = 1_000_000;
  cibaLoginService._test.reset();
  cibaLoginService._test.setNow(() => clock);
  resolvePingOneIdentifier.mockResolvedValue({ user: REAL, error: null });
  validateToken.mockResolvedValue({ sub: REAL.id, iss: 'https://auth.test/env/as', preferred_username: 'alice', email: 'alice@example.com' });
  mockOAuthUser.getUserInfo.mockResolvedValue({ sub: REAL.id });
  adminOAuthService.getUserInfo.mockResolvedValue({ sub: REAL.id });
  const fakeEstablish = async (req) => {
    await new Promise((r) => req.session.regenerate(r));
    req.session.user = { established: true };
    return { ok: true, oauthTokens: { expiresAt: clock + 3600000, idToken: 'idt' } };
  };
  establishUserSession.mockImplementation(fakeEstablish);
  establishAdminSession.mockImplementation(fakeEstablish);
  mockPingOne({ tokenReplies: [TOKENS] });
});

describe('start: known user (a)', () => {
  it('sends a real CIBA request as the login app with the channel policy, full scope and a vertical match code', async () => {
    const agent = request.agent(makeApp());
    const res = await start(agent);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authReqId: expect.any(String), matchCode: expect.stringMatching(/^BK[0-9A-F]{6}$/), expiresIn: 120, interval: 2 });
    expect(res.body.authReqId).not.toBe('PING-AR-1');
    expect(cibaPosts()).toHaveLength(1);
    const [url, form, opts] = cibaPosts()[0];
    expect(url).toBe('https://auth.test/env/as/cibaAuthorization');
    const p = new URLSearchParams(form);
    expect(p.get('client_id')).toBe('user-client');
    expect(p.get('client_secret')).toBe('user-secret');
    expect(p.get('scope')).toBe(FULL_SCOPE);
    expect(p.get('acr_values')).toBe(POLICY_EMAIL);
    expect(p.get('login_hint')).toBe('alice');
    expect(p.get('binding_message')).toBe(res.body.matchCode);
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it('uses the SMS policy for sms and the admin client + scopes for role admin', async () => {
    const agent = request.agent(makeApp());
    await start(agent, { channel: 'sms', role: 'admin' });
    const p = new URLSearchParams(cibaPosts()[0][1]);
    expect(p.get('acr_values')).toBe(POLICY_SMS);
    expect(p.get('client_id')).toBe('admin-client');
    expect(p.get('scope')).toBe('openid profile email offline_access admin:all');
  });

  it('rejects malformed bodies with 400 and contacts nothing', async () => {
    const agent = request.agent(makeApp());
    for (const bad of [{ identifier: '' }, { channel: 'pager' }, { role: 'root' }, { identifier: 5 }]) {
      expect((await start(agent, bad)).status).toBe(400);
    }
    expect(resolvePingOneIdentifier).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('start: no enumeration (b)', () => {
  let ipSeq = 0;
  async function shape(over, lookup) {
    resolvePingOneIdentifier.mockResolvedValue(lookup);
    axios.post.mockClear();
    const agent = request.agent(makeApp());
    const res = await start(agent, over).set('X-Forwarded-For', `10.9.0.${++ipSeq}`);
    return { agent, res, ciba: cibaPosts().length };
  }
  const cases = {
    unknown: [{ identifier: 'nobody' }, { user: null, error: 'not_found' }],
    'no phone for sms': [{ channel: 'sms' }, { user: { ...REAL, mobilePhone: '' }, error: null }],
    'no email for email': [{ channel: 'email' }, { user: { ...REAL, email: '' }, error: null }],
    'disabled account': [{}, { user: { ...REAL, enabled: false }, error: null }],
    'lookup error': [{}, { user: null, error: 'request_failed' }],
  };

  it('decoys answer exactly like a real user and never contact PingOne', async () => {
    const real = await shape({}, { user: REAL, error: null });
    expect(real.ciba).toBe(1);
    for (const [name, [over, lookup]] of Object.entries(cases)) {
      const d = await shape(over, lookup);
      expect({ name, status: d.res.status }).toEqual({ name, status: real.res.status });
      expect(Object.keys(d.res.body).sort()).toEqual(Object.keys(real.res.body).sort());
      expect(d.res.body.expiresIn).toBe(120);
      expect(d.res.body.interval).toBe(2);
      expect(d.res.body.matchCode).toMatch(/^BK[0-9A-F]{6}$/);
      expect(d.res.body.authReqId).toMatch(/^[0-9a-f]{48}$/);
      expect({ name, ciba: d.ciba }).toEqual({ name, ciba: 0 });
    }
  });

  it('a PingOne failure for a real user still answers 200 (indistinguishable from a decoy)', async () => {
    axios.post.mockRejectedValue(new Error('boom'));
    const res = await start(request.agent(makeApp()));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['authReqId', 'expiresIn', 'interval', 'matchCode']);
  });

  it('decoy polls stay pending, then 410 after expiry, never approved, never touching PingOne', async () => {
    resolvePingOneIdentifier.mockResolvedValue({ user: null, error: 'not_found' });
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent, { identifier: 'nobody' });
    for (let i = 0; i < 3; i++) {
      clock += 2000;
      const r = await poll(agent, b.authReqId);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ status: 'pending' });
    }
    clock += 121_000;
    const gone = await poll(agent, b.authReqId);
    expect(gone.status).toBe(410);
    expect(gone.body).toEqual({ status: 'expired' });
    expect(establishUserSession).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('applies the same minimum response time to decoys and real starts', async () => {
    process.env.CIBA_LOGIN_START_FLOOR_MS = '80';
    try {
      resolvePingOneIdentifier.mockResolvedValue({ user: null, error: 'not_found' });
      const t0 = Date.now();
      await start(request.agent(makeApp()), { identifier: 'nobody' });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    } finally {
      process.env.CIBA_LOGIN_START_FLOOR_MS = '0';
    }
  });
});

describe('poll: approval (a, e, f)', () => {
  async function started(over, tokenReplies = [TOKENS]) {
    mockPingOne({ tokenReplies });
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent, over);
    return { agent, id: b.authReqId };
  }

  it('is pending while PingOne says authorization_pending, polling with the login app and the ciba grant', async () => {
    const { agent, id } = await started({}, [pendingErr()]);
    const r = await poll(agent, id);
    expect(r.body).toEqual({ status: 'pending' });
    const p = new URLSearchParams(tokenPosts()[0][1]);
    expect(p.get('grant_type')).toBe('urn:openid:params:grant-type:ciba');
    expect(p.get('auth_req_id')).toBe('PING-AR-1');
    expect(p.get('client_id')).toBe('user-client');
    expect(p.get('client_secret')).toBe('user-secret');
    expect(establishUserSession).not.toHaveBeenCalled();
  });

  it('customer: establishes a user session, rotates the session id, sets the customer cookie, 2nd poll is 410', async () => {
    const { agent, id } = await started({});
    const r = await poll(agent, id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'approved', redirectTo: expect.stringContaining('http://localhost:3000/') });
    expect(establishUserSession).toHaveBeenCalledTimes(1);
    expect(establishAdminSession).not.toHaveBeenCalled();
    const opts = establishUserSession.mock.calls[0][2];
    expect(opts.tokenData).toEqual(TOKENS);
    expect(opts.provider).toBe('pingone');
    expect(opts.user.username).toBe('alice');
    expect(setAuthCookie).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ oauthType: 'user' }), expect.any(Boolean));
    const again = await poll(agent, id);
    expect(again.status).toBe(410);
    expect(establishUserSession).toHaveBeenCalledTimes(1);
  });

  it('establish* runs on a request whose session id changes (regenerate)', async () => {
    const ids = [];
    establishUserSession.mockImplementation(async (req) => {
      ids.push(req.sessionID);
      await new Promise((r) => req.session.regenerate(r));
      ids.push(req.sessionID);
      return { ok: true, oauthTokens: { expiresAt: clock + 1, idToken: 'x' } };
    });
    const { agent, id } = await started({});
    await poll(agent, id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('admin: establishes an admin session and sets the signed admin cookie', async () => {
    const { agent, id } = await started({ role: 'admin' });
    const r = await poll(agent, id);
    expect(r.body.status).toBe('approved');
    expect(establishAdminSession).toHaveBeenCalledTimes(1);
    expect(establishUserSession).not.toHaveBeenCalled();
    expect(establishAdminSession.mock.calls[0][2].user.role).toBe('admin');
    expect(setAuthCookie).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ oauthType: 'admin', role: 'admin' }), expect.any(Boolean));
    expect(r.body.redirectTo).toContain('/admin');
  });

  it('a different session cannot poll someone else\'s authReqId (404, PingOne untouched)', async () => {
    const { id } = await started({});
    axios.post.mockClear();
    const other = request.agent(makeApp());
    const r = await poll(other, id);
    expect(r.status).toBe(404);
    expect(axios.post).not.toHaveBeenCalled();
    expect(establishUserSession).not.toHaveBeenCalled();
  });

  it('an unknown authReqId is 404', async () => {
    expect((await poll(request.agent(makeApp()), 'f'.repeat(48))).status).toBe(404);
  });

  it('pending entries expire (410) and are cleaned up', async () => {
    const { agent, id } = await started({}, [pendingErr()]);
    clock += 121_000;
    expect((await poll(agent, id)).status).toBe(410);
    clock += 60_000;
    cibaLoginService._test.sweep();
    expect(cibaLoginService._test.size()).toBe(0);
  });
});

describe('poll: wrong person approves (c)', () => {
  it('ID token sub that is not the identified user is never approved and creates no session', async () => {
    validateToken.mockResolvedValue({ sub: 'someone-else', iss: 'https://auth.test/env/as' });
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent);
    const r = await poll(agent, b.authReqId);
    expect(r.body.status).not.toBe('approved');
    expect(r.status).toBe(410);
    expect(establishUserSession).not.toHaveBeenCalled();
    expect(setAuthCookie).not.toHaveBeenCalled();
    expect((await poll(agent, b.authReqId)).status).toBe(410);
  });

  it('an ID token that fails validation is never approved', async () => {
    validateToken.mockRejectedValue(new Error('bad signature'));
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent);
    expect((await poll(agent, b.authReqId)).status).toBe(410);
    expect(establishUserSession).not.toHaveBeenCalled();
  });
});

describe('rate limit (d)', () => {
  it('429s the 6th start for one identifier and sends no further CIBA request', async () => {
    const agent = request.agent(makeApp());
    for (let i = 0; i < 5; i++) expect((await start(agent, {}).set('X-Forwarded-For', `10.0.0.${i}`)).status).toBe(200);
    expect(cibaPosts()).toHaveLength(5);
    const sixth = await start(agent, {}).set('X-Forwarded-For', '10.0.0.99');
    expect(sixth.status).toBe(429);
    expect(cibaPosts()).toHaveLength(5);
  });

  it('429s the 6th start from one IP across different identifiers', async () => {
    const agent = request.agent(makeApp());
    for (let i = 0; i < 5; i++) expect((await start(agent, { identifier: `user${i}` })).status).toBe(200);
    const before = cibaPosts().length;
    expect((await start(agent, { identifier: 'user-new' })).status).toBe(429);
    expect(cibaPosts()).toHaveLength(before);
  });

  it('forgets after the window', async () => {
    const agent = request.agent(makeApp());
    for (let i = 0; i < 5; i++) await start(agent, {});
    expect((await start(agent, {})).status).toBe(429);
    clock += 11 * 60 * 1000;
    expect((await start(agent, {})).status).toBe(200);
  });
});

describe('fix round 1', () => {
  async function approved(over) {
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent, over);
    return { agent, id: b.authReqId };
  }

  it('poll has a minimum latency for decoys too', async () => {
    process.env.CIBA_LOGIN_POLL_FLOOR_MS = '80';
    try {
      resolvePingOneIdentifier.mockResolvedValue({ user: null, error: 'not_found' });
      const agent = request.agent(makeApp());
      const { body: b } = await start(agent, { identifier: 'nobody' });
      const t0 = Date.now();
      await poll(agent, b.authReqId);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    } finally {
      process.env.CIBA_LOGIN_POLL_FLOOR_MS = '0';
    }
  });

  describe.each([['customer', establishUserSession], ['admin', establishAdminSession]])('failed session setup (%s)', (role, establish) => {
    it.each(['session_persist_failed', 'session_regenerate_failed'])('%s: nothing authenticated survives', async (reason) => {
      let destroyed = false;
      establish.mockImplementation(async (req) => {
        const orig = req.session.destroy.bind(req.session);
        req.session.destroy = (cb) => { destroyed = true; orig(cb); };
        return { ok: false, reason };
      });
      const { agent, id } = await approved({ role });
      const r = await poll(agent, id);
      expect(r.status).toBe(410);
      expect(r.body.redirectTo).toBeUndefined();
      expect(setAuthCookie).not.toHaveBeenCalled();
      expect(clearAuthCookie).toHaveBeenCalled();
      expect(destroyed).toBe(reason === 'session_persist_failed');
    });
  });

  describe('admin escalation guard', () => {
    it('a customer-like account approving role:admin gets 403, no session, no cookie', async () => {
      configStore.getEffective.mockImplementation(() => '');
      const { agent, id } = await approved({ role: 'admin' });
      const r = await poll(agent, id);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ status: 'denied' });
      expect(establishAdminSession).not.toHaveBeenCalled();
      expect(setAuthCookie).not.toHaveBeenCalled();
    });
    it('an allowlisted admin succeeds; customer role is unaffected', async () => {
      expect((await poll(...Object.values(await approved({ role: 'admin' })))).body.status).toBe('approved');
      configStore.getEffective.mockImplementation(() => '');
      const c = await approved({ role: 'customer', identifier: 'bob' });
      expect((await poll(c.agent, c.id)).body.status).toBe('approved');
    });
  });

  it('hosted-wall denial clears approval, tokens and cookie and creates no session', async () => {
    hosted.loadHostedAccessPolicy.mockReturnValue({ enabled: true });
    hosted.evaluateHostedIdentity.mockReturnValue({ allowed: false, reason: 'domain_not_allowed' });
    const { agent, id } = await approved({});
    const r = await poll(agent, id);
    expect(r.status).toBe(403);
    expect(hosted.clearHostedAccessApproval).toHaveBeenCalled();
    expect(clearAuthCookie).toHaveBeenCalled();
    expect(establishUserSession).not.toHaveBeenCalled();
    hosted.loadHostedAccessPolicy.mockReturnValue({ enabled: false });
  });

  it('refuses start and poll with 503 when the provider is pingfederate', async () => {
    const agent = request.agent(makeApp());
    const { body: b } = await start(agent);
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    const s = await start(agent, { identifier: 'zed' });
    expect(s.status).toBe(503);
    expect(s.body).toEqual({ error: 'provider_unsupported' });
    expect((await poll(agent, b.authReqId)).status).toBe(503);
  });

  it('rejects non-JSON POST /start with 415', async () => {
    const r = await request(makeApp()).post('/api/auth/ciba/login/start').type('form').send(body());
    expect(r.status).toBe(415);
    expect(resolvePingOneIdentifier).not.toHaveBeenCalled();
  });

  it('admin user record does not get the mobile phone copied on', async () => {
    const { agent, id } = await approved({ role: 'admin' });
    await poll(agent, id);
    expect(establishAdminSession.mock.calls[0][2].user.phone).toBeUndefined();
  });
});
