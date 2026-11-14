'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pf_issuer' ? 'https://pf.example:9031' : ''),
}));

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { signDelegation, signSession } = require('../services/poppySessionService');
const { createPoppyInspectionService, narrate, MAX_ENTRIES } = require('../services/poppyInspectionService');
const { createPoppyApiRouter } = require('../routes/poppyApi');
const createPoppyInspectorRouter = require('../routes/poppyInspector');

const NOW = 1_800_000_000;
const HOST = 'poppy.example';
const CLIENT_ID = 'https://agent.example/client.json';
const ISSUER = 'https://pf.example:9031';
const TOKEN = 'pf-access-token';

const ecKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
};

describe('poppyInspectionService', () => {
  it('narrates a verified signed-in call in check order', () => {
    const steps = narrate({
      method: 'GET', path: '/poppy/api/v1/me',
      outcome: { ok: true, sub: 'user-1', sid: 'sid-1', agentId: 'agent-x', clientId: CLIENT_ID },
      scopes: ['accounts:read'],
    });
    expect(steps[0]).toMatch(/delegation was signed/);
    expect(steps.join(' ')).toMatch(/method \(GET\)/);
    expect(steps.join(' ')).toMatch(/accounts:read/);
    expect(steps.join(' ')).toMatch(/user-1/);
  });

  it('narrates a signed-out Session as no user data', () => {
    const steps = narrate({ method: 'GET', path: '/p', outcome: { ok: true, signedOut: true, sid: 's', clientId: CLIENT_ID } });
    expect(steps.join(' ')).toMatch(/signed-out Session/);
  });

  it('narrates a refusal with the reason', () => {
    const steps = narrate({ method: 'GET', path: '/p', outcome: { ok: false, reason: 'jti was already used' } });
    expect(steps[0]).toMatch(/Refused: jti was already used/);
  });

  it('feed is newest-first and never stores a raw token', () => {
    const svc = createPoppyInspectionService();
    svc.record({ method: 'GET', path: '/a', outcome: { ok: false, reason: 'r1' }, sessionJwt: 'AAA.' + 'x'.repeat(40) + '.BBB' });
    svc.record({ method: 'GET', path: '/b', outcome: { ok: true, sub: 'u', sid: 's', clientId: CLIENT_ID }, accessToken: 'TOKENVALUE1234567890' });
    const feed = svc.feed();
    expect(feed[0].path).toBe('/b');
    expect(feed[1].path).toBe('/a');
    expect(JSON.stringify(feed)).not.toContain('TOKENVALUE1234567890');
    expect(JSON.stringify(feed)).not.toContain('x'.repeat(40)); // only a fingerprint of the session JWT
    expect(feed[1].received.poppy_session).toMatch(/^AAA\.xx…/);
    expect(feed[0].sent.status).toBe(200);
  });

  it('is bounded to MAX_ENTRIES', () => {
    const svc = createPoppyInspectionService();
    for (let i = 0; i < MAX_ENTRIES + 20; i += 1) svc.record({ method: 'GET', path: `/${i}`, outcome: { ok: false, reason: 'r' } });
    expect(svc.size()).toBe(MAX_ENTRIES);
    expect(svc.feed()[0].path).toBe(`/${MAX_ENTRIES + 19}`);
  });

  it('filters by agent and clears', () => {
    const svc = createPoppyInspectionService();
    svc.record({ method: 'GET', path: '/a', outcome: { ok: true, sub: 'u', sid: 's', clientId: CLIENT_ID } });
    svc.record({ method: 'GET', path: '/b', outcome: { ok: true, sub: 'u', sid: 's2', clientId: 'https://other.example/c.json' } });
    expect(svc.feed({ agent: CLIENT_ID })).toHaveLength(1);
    expect(svc.agents()).toHaveLength(2);
    svc.clear();
    expect(svc.size()).toBe(0);
  });

  it('record never throws on junk input; it records a refused unknown', () => {
    const svc = createPoppyInspectionService();
    expect(() => svc.record({ method: 42, path: null, outcome: null })).not.toThrow();
    expect(svc.size()).toBe(1);
    expect(svc.feed()[0].reasoning[0]).toMatch(/Refused: unknown/);
  });
});

describe('Poppy API records into the inspector', () => {
  beforeEach(() => { process.env.POPPY_DOMAIN = HOST; });
  afterEach(() => { delete process.env.POPPY_DOMAIN; });

  function setup({ tokenPayload = { client_id: CLIENT_ID, scope: 'accounts:read' }, tokenFails = false } = {}) {
    const jwks = ecKey();
    const delegated = ecKey();
    const inspection = createPoppyInspectionService();
    const delegation = signDelegation({
      clientId: CLIENT_ID, jwksKid: 'k1', jwksPrivateKey: jwks.privateKey, delegatedPublicJwk: delegated.publicJwk, now: NOW,
    });
    const app = express();
    app.use('/poppy/api', createPoppyApiRouter({
      validateToken: async () => { if (tokenFails) throw new Error('bad token'); return tokenPayload; },
      resolveJwks: async () => ({ keys: [{ ...jwks.publicJwk, kid: 'k1' }] }),
      now: () => NOW,
      inspection,
    }));
    const session = (over = {}) => signSession({
      delegation, delegatedPrivateKey: delegated.privateKey, delegatedPublicJwk: delegated.publicJwk,
      clientId: CLIENT_ID, issuer: ISSUER, sid: 'sid-1', sub: 'user-abc', method: 'GET',
      url: `https://${HOST}/poppy/api/v1/me`, accessToken: TOKEN, now: NOW, ...over,
    });
    return { app, session, inspection };
  }

  it('records a verified signed-in call', async () => {
    const { app, session, inspection } = setup();
    const res = await request(app).get('/poppy/api/v1/me').set('Host', HOST).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(res.status).toBe(200);
    expect(inspection.size()).toBe(1);
    const feed = inspection.feed();
    expect(feed[0]).toMatchObject({ method: 'GET', status: 200, userId: 'user-abc', clientId: CLIENT_ID });
    expect(feed[0].reasoning.join(' ')).toMatch(/delegation was signed/);
  });

  it('records a signed-out Session with no user id', async () => {
    const { app, session, inspection } = setup();
    const res = await request(app).get('/poppy/api/v1/me').set('Host', HOST).set('Poppy-Session', session({ accessToken: undefined }));
    expect(res.status).toBe(200);
    expect(inspection.size()).toBe(1);
    expect(inspection.feed()[0].signedOut).toBe(true);
    expect(inspection.feed()[0].userId).toBeNull();
  });

  it('records refusals: missing header, bad token, wrong scope', async () => {
    const { app, session, inspection } = setup();
    await request(app).get('/poppy/api/v1/me').set('Host', HOST).set('Authorization', `Bearer ${TOKEN}`);
    await request(app).get('/poppy/api/v1/me').set('Host', HOST).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', session());
    expect(inspection.size()).toBe(2); // refusal + the valid second call
    const reasons = inspection.feed().map((e) => e.reasoning[0]);
    expect(reasons.some((r) => /required/.test(r))).toBe(true);
    const failing = setup({ tokenFails: true });
    await request(failing.app).get('/poppy/api/v1/me').set('Host', HOST).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', failing.session());
    expect(failing.inspection.feed()[0].sent.status).toBe(401);
    const scoped = setup({ tokenPayload: { client_id: CLIENT_ID, scope: 'openid' } });
    await request(scoped.app).get('/poppy/api/v1/me').set('Host', HOST).set('Authorization', `Bearer ${TOKEN}`).set('Poppy-Session', scoped.session());
    expect(scoped.inspection.feed()[0].sent.status).toBe(403);
    expect(scoped.inspection.feed()[0].reasoning[0]).toMatch(/insufficient_scope|missing the accounts:read scope/);
  });
});

describe('Poppy inspector admin routes', () => {
  it('serves the newest-first feed and one entry', async () => {
    const svc = createPoppyInspectionService();
    svc.record({ method: 'GET', path: '/x', outcome: { ok: false, reason: 'nope' } });
    const app = express();
    app.use('/api/admin/poppy', createPoppyInspectorRouter({ shared: svc }));
    const feed = await request(app).get('/api/admin/poppy/inspect');
    expect(feed.status).toBe(200);
    expect(feed.body.count).toBe(1);
    const one = await request(app).get(`/api/admin/poppy/inspect/${feed.body.entries[0].id}`);
    expect(one.status).toBe(200);
    expect(one.body.reasoning).toHaveLength(2);
    expect((await request(app).get('/api/admin/poppy/inspect/ins_missing')).status).toBe(404);
    expect((await request(app).get('/api/admin/poppy/inspect/agents')).body.agents).toEqual([]);
    expect((await request(app).delete('/api/admin/poppy/inspect')).body.ok).toBe(true);
    expect((await request(app).get('/api/admin/poppy/inspect')).body.count).toBe(0);
  });
});
