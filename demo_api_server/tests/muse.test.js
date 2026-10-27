'use strict';
// Muse personal-agent flow: fake network only (injected fetch), no sockets to the outside.
const express = require('express');
const request = require('supertest');

const mockCfg = {};
jest.mock('../services/configStore', () => ({
  getEffective: (k) => mockCfg[k] ?? '',
  validateTwoExchangeConfig: jest.fn(),
  validateScopeAudience: jest.fn(),
  getErrorDetails: jest.fn(),
}));

const { createMuseRouter } = require('../routes/muse');
const { museConfig } = require('../services/museLive');

const ENV_ID = 'env-1';
const GW = 'https://api.ping.demo:3036/mcp';
const AS_BASE = `https://auth.pingone.com/${ENV_ID}/as`;
const SECRET = 'MUSE-CLIENT-SECRET-VALUE';
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const jwt = (c) => `h.${Buffer.from(JSON.stringify(c)).toString('base64url')}.s`;
const USER_TOKEN = jwt({ sub: 'demouser', aud: GW, scope: 'openid gateway:mcp:invoke' });
const ACTOR_TOKEN = jwt({ sub: 'muse-id' });
const EX1 = jwt({ sub: 'demouser', act: { sub: 'muse-id' } });
const EX2 = jwt({ sub: 'demouser', aud: GW, scope: 'gateway:mcp:invoke', act: { sub: 'muse-id' } });
const POINTS = { result: { content: [{ type: 'text', text: JSON.stringify({ data: { points: 12345, tier: 'Gold' } }) }] } };

function setConfig(over = {}) {
  for (const k of Object.keys(mockCfg)) delete mockCfg[k];
  Object.assign(mockCfg, { pingone_environment_id: ENV_ID, pingone_region: 'com', pingone_muse_client_id: 'muse-id', pingone_muse_client_secret: SECRET, ...over });
}

function net() {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    seen.push({ url: u, init, form: init.body && String(init.headers?.['content-type']).includes('form') ? Object.fromEntries(new URLSearchParams(init.body)) : null });
    if (u === GW) {
      if (!init.headers.authorization) return json(401, {}, { 'www-authenticate': 'Bearer resource_metadata="https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp"' });
      const m = JSON.parse(init.body).method;
      if (m === 'initialize') return json(200, { result: {} }, { 'mcp-session-id': 's1' });
      if (m === 'tools/list') return json(200, { result: { tools: [{ name: 'loyalty_balance' }] } });
      return json(200, POINTS);
    }
    if (u.endsWith('/oauth-protected-resource/mcp')) return json(200, { authorization_servers: [AS_BASE] });
    if (u.includes('/.well-known/oauth-authorization-server')) return json(200, { issuer: AS_BASE, authorization_endpoint: `${AS_BASE}/authorize`, token_endpoint: `${AS_BASE}/token`, code_challenge_methods_supported: ['S256'], scopes_supported: ['openid'] });
    if (u === `${AS_BASE}/token`) {
      const g = seen[seen.length - 1].form;
      if (g.grant_type === 'authorization_code') return json(200, { access_token: USER_TOKEN });
      if (g.grant_type === 'client_credentials') return json(200, { access_token: ACTOR_TOKEN });
      return json(200, { access_token: g.subject_token === USER_TOKEN ? EX1 : EX2 });
    }
    throw new Error(`unexpected ${u}`);
  };
  return { f, seen };
}

function boot(fetchImpl, { sid = 's-1', signedIn = true } = {}) {
  const app = express();
  app.use((req, _res, next) => { req.sessionID = sid; req.session = signedIn ? { user: { id: 'u' } } : {}; next(); });
  app.use('/api/muse', createMuseRouter({ fetchImpl }));
  return app;
}

async function toSignIn(app, extra = {}) {
  await request(app).post('/api/muse/ask').send({ prompt: 'Show my airline points', ...extra.ask });
  await request(app).post('/api/muse/register');
  const si = await request(app).post('/api/muse/signin').send(extra.signin ?? {});
  return new URL(si.body.url);
}

beforeEach(() => setConfig());

describe('Muse: ask', () => {
  test('401 first, then the two metadata reads; no authenticated call; auth_required', async () => {
    const n = net();
    const app = boot(n.f);
    const res = await request(app).post('/api/muse/ask').send({ prompt: 'Show my airline points' });
    expect(res.body.state).toBe('auth_required');
    expect(n.seen[0].url).toBe(GW);
    expect(n.seen[1].url).toBe('https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp');
    expect(n.seen[2].url).toContain('/.well-known/oauth-authorization-server');
    expect(n.seen).toHaveLength(3);
    expect(n.seen.some((s) => s.init.headers?.authorization)).toBe(false);
    const st = (await request(app).get('/api/muse/state')).body;
    expect(st.liveAuth.steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(st.liveAuth.steps[0].response.status).toBe(401);
  });

  test('anything but points gets a polite refusal and no network', async () => {
    const n = net();
    const res = await request(boot(n.f)).post('/api/muse/ask').send({ prompt: 'Book me a flight' });
    expect(res.status).toBe(400);
    expect(n.seen).toHaveLength(0);
  });

  test('not configured: 503 "Muse is not configured", state says so, nothing contacted', async () => {
    setConfig({ pingone_muse_client_secret: '' });
    const n = net();
    const app = boot(n.f);
    const res = await request(app).post('/api/muse/ask').send({ prompt: 'my points' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Muse is not configured');
    expect((await request(app).get('/api/muse/state')).body.configured).toBe(false);
    expect(n.seen).toHaveLength(0);
  });

  test('signed-out callers are refused', async () => {
    const res = await request(boot(net().f, { signedIn: false })).post('/api/muse/ask').send({ prompt: 'my points' });
    expect(res.status).toBe(401);
  });

  test('privilege lane with no URL configured is refused clearly', async () => {
    const res = await request(boot(net().f)).post('/api/muse/ask').send({ prompt: 'my points', lane: 'privilege' });
    expect(res.status).toBe(409);
  });
});

describe('Muse: sign-in URL', () => {
  test('PKCE S256, prompt=login, login_hint, gateway resource and scope', async () => {
    const u = await toSignIn(boot(net().f));
    expect(u.origin + u.pathname).toBe(`${AS_BASE}/authorize`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('prompt')).toBe('login');
    expect(u.searchParams.get('login_hint')).toBe('demouser');
    expect(u.searchParams.get('scope')).toBe('openid gateway:mcp:invoke');
    expect(u.searchParams.get('resource')).toBe(GW);
    expect(u.searchParams.get('client_id')).toBe('muse-id');
    expect(u.searchParams.get('redirect_uri')).toBe('https://local.ping-devops.com:4000/api/muse/callback');
    expect(u.searchParams.get('client_secret')).toBeNull();
  });

  test('MFA off appends .nomfa to the login hint', async () => {
    const u = await toSignIn(boot(net().f), { signin: { mfa: 'off' } });
    expect(u.searchParams.get('login_hint')).toBe('demouser.nomfa');
  });

  test('privilege lane: openid only, no resource, exchange 2 scope mcp:invoke', async () => {
    const PRIV = 'https://priv.example/mcp';
    const prevEnv = process.env.MUSE_PRIVILEGE_URL;
    process.env.MUSE_PRIVILEGE_URL = PRIV;
    try {
      const n = net();
      const base = n.f;
      const f = async (url, init) => (String(url) === PRIV ? base(GW, init) : base(url, init));
      const app = boot(f);
      const u = await toSignIn(app, { ask: { lane: 'privilege' } });
      expect(u.searchParams.get('scope')).toBe('openid');
      expect(u.searchParams.get('resource')).toBeNull();
      await request(app).get(`/api/muse/callback?code=abc&state=${u.searchParams.get('state')}`);
      const ex2 = n.seen.filter((s) => s.form?.grant_type?.includes('token-exchange')).pop();
      expect(ex2.form.scope).toBe('mcp:invoke');
    } finally {
      if (prevEnv === undefined) delete process.env.MUSE_PRIVILEGE_URL; else process.env.MUSE_PRIVILEGE_URL = prevEnv;
    }
  });
});

describe('Muse: callback', () => {
  test('no cookie, one-time state: code swap, actor token, two exchanges in order, gateway retried with jwks header', async () => {
    const n = net();
    const app = boot(n.f);
    const u = await toSignIn(app);
    n.seen.length = 0;
    // The callback route has no requireSession: the one-time state alone ties the return to the session.
    const cb = await request(app).get(`/api/muse/callback?code=abc&state=${u.searchParams.get('state')}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/personal-agent/muse');

    const posts = n.seen.filter((s) => s.url === `${AS_BASE}/token`).map((s) => s.form);
    expect(posts.map((p) => p.grant_type)).toEqual([
      'authorization_code', 'client_credentials',
      'urn:ietf:params:oauth:grant-type:token-exchange', 'urn:ietf:params:oauth:grant-type:token-exchange',
    ]);
    expect(posts.every((p) => p.client_secret === SECRET && p.client_id === 'muse-id')).toBe(true);
    expect(posts[0].code_verifier).toBeTruthy();
    expect(posts[1].scope).toBe('agent:invoke');
    expect(posts[2]).toMatchObject({ subject_token: USER_TOKEN, actor_token: ACTOR_TOKEN, scope: 'agent:invoke' });
    expect(posts[3]).toMatchObject({ subject_token: EX1, scope: 'gateway:mcp:invoke' });
    expect(posts[3].actor_token).toBeUndefined();

    const gwCalls = n.seen.filter((s) => s.url === GW);
    expect(gwCalls.length).toBe(3);
    for (const c of gwCalls) {
      expect(c.init.headers.authorization).toBe(`Bearer ${EX2}`);
      expect(c.init.headers['x-token-validation']).toBe('jwks');
      expect(c.init.headers['mcp-protocol-version']).toBe('2025-06-18');
    }

    const st = await request(app).get('/api/muse/state');
    expect(st.body.liveAuth.signedIn).toBe(true);
    expect(st.body.liveAuth.answer).toEqual({ points: 12345, tier: 'Gold' });
    expect(st.body.liveAuth.claims.act).toEqual({ sub: 'muse-id' });
  });

  test('the token and the client secret are never in any response the page can read', async () => {
    const n = net();
    const app = boot(n.f);
    const u = await toSignIn(app);
    const cb = await request(app).get(`/api/muse/callback?code=abc&state=${u.searchParams.get('state')}`);
    const st = await request(app).get('/api/muse/state');
    const all = JSON.stringify({ body: st.body, text: cb.text, headers: cb.headers });
    for (const secret of [USER_TOKEN, ACTOR_TOKEN, EX1, EX2, SECRET]) expect(all).not.toContain(secret);
  });

  test('a reused state is refused', async () => {
    const app = boot(net().f);
    const u = await toSignIn(app);
    const state = u.searchParams.get('state');
    expect((await request(app).get(`/api/muse/callback?code=abc&state=${state}`)).status).toBe(302);
    expect((await request(app).get(`/api/muse/callback?code=abc&state=${state}`)).status).toBe(400);
  });

  test('an unknown state is refused and nothing is exchanged', async () => {
    const n = net();
    const res = await request(boot(n.f)).get('/api/muse/callback?code=abc&state=nope');
    expect(res.status).toBe(400);
    expect(n.seen).toHaveLength(0);
  });

  test('a state older than 10 minutes is refused', async () => {
    let t = 1_000_000;
    const n = net();
    const app = express();
    app.use((req, _res, next) => { req.sessionID = 's'; req.session = { user: {} }; next(); });
    app.use('/api/muse', createMuseRouter({ fetchImpl: n.f, now: () => t }));
    const u = await toSignIn(app);
    t += 10 * 60 * 1000 + 1;
    expect((await request(app).get(`/api/muse/callback?code=abc&state=${u.searchParams.get('state')}`)).status).toBe(400);
  });

  test('PingOne error on return is shown, no exchange', async () => {
    const n = net();
    const app = boot(n.f);
    const u = await toSignIn(app);
    n.seen.length = 0;
    await request(app).get(`/api/muse/callback?error=access_denied&state=${u.searchParams.get('state')}`);
    expect(n.seen).toHaveLength(0);
    expect((await request(app).get('/api/muse/state')).body.liveAuth.error).toMatch(/refused/);
  });

  test('reset clears the session workspace', async () => {
    const app = boot(net().f);
    await toSignIn(app);
    await request(app).post('/api/muse/reset');
    const st = (await request(app).get('/api/muse/state')).body;
    expect(st.liveAuth.ask).toBeNull();
    expect(st.liveAuth.steps).toEqual([]);
  });
});

describe('museConfig', () => {
  test('defaults: gateway lane URL, redirect uri, id; configured only with a secret', () => {
    const c = museConfig('gateway', {});
    expect(c.url).toBe(GW);
    expect(c.configured).toBe(true);
    expect(c.idp.gatewayScope).toBe('gateway:mcp:invoke');
    setConfig({ pingone_muse_client_secret: '' });
    expect(museConfig('gateway', {}).configured).toBe(false);
  });
  test('privilege lane scope and availability', () => {
    expect(museConfig('privilege', {}).laneAvailable).toBe(false);
    const c = museConfig('privilege', { MUSE_PRIVILEGE_URL: 'https://priv.example/mcp' });
    expect(c.laneAvailable).toBe(true);
    expect(c.idp.gatewayScope).toBe('mcp:invoke');
  });
});
