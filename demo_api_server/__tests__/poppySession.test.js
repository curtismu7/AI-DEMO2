'use strict';

const crypto = require('node:crypto');
const {
  verifyPoppySession,
  signDelegation,
  signSession,
  createReplayCache,
  requirePoppySession,
} = require('../services/poppySessionService');

const NOW = 1_800_000_000;
const CLIENT_ID = 'https://agent.example/client.json';
const ISSUER = 'https://pf.example';
const URL_ = 'https://company.example/api/orders?x=1';
const TOKEN = 'access-token-value';

function ecKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function fixture(overrides = {}) {
  const jwks = ecKey();
  const delegated = ecKey();
  const delegation = signDelegation({
    clientId: CLIENT_ID,
    jwksKid: 'k1',
    jwksPrivateKey: jwks.privateKey,
    delegatedPublicJwk: delegated.publicJwk,
    now: NOW,
    ...overrides.delegation,
  });
  const sessionJwt = signSession({
    delegation,
    delegatedPrivateKey: delegated.privateKey,
    delegatedPublicJwk: delegated.publicJwk,
    clientId: CLIENT_ID,
    issuer: ISSUER,
    sid: 'sid-1',
    sub: 'user-abc',
    method: 'GET',
    url: URL_,
    accessToken: TOKEN,
    now: NOW,
    ...overrides.session,
  });
  const resolveJwks = async () => ({ keys: [{ ...jwks.publicJwk, kid: 'k1' }] });
  return { sessionJwt, resolveJwks, jwks, delegated };
}

const verify = (f, extra = {}) =>
  verifyPoppySession({
    sessionJwt: f.sessionJwt,
    method: 'GET',
    url: URL_,
    issuer: ISSUER,
    accessToken: TOKEN,
    accessTokenClientId: CLIENT_ID,
    resolveJwks: f.resolveJwks,
    replayCache: createReplayCache(),
    now: NOW,
    ...extra,
  });

describe('verifyPoppySession', () => {
  it('accepts a valid session', async () => {
    const out = await verify(fixture());
    expect(out).toEqual({ sub: 'user-abc', sid: 'sid-1', agentId: undefined, clientId: CLIENT_ID });
  });

  it('rejects a delegation lifetime over 24 hours', async () => {
    const f = fixture({ delegation: { lifetimeSeconds: 24 * 3600 + 1 } });
    await expect(verify(f)).rejects.toMatchObject({ code: 'invalid_session', reason: expect.stringMatching(/24 hours/) });
  });

  it('rejects an expired delegation', async () => {
    const f = fixture({ delegation: { lifetimeSeconds: 10 } });
    await expect(verify(f, { now: NOW + 100 })).rejects.toMatchObject({ reason: expect.stringMatching(/expired/) });
  });

  it('rejects a delegation signed by a key not in the agent jwks', async () => {
    const f = fixture();
    const other = ecKey();
    f.resolveJwks = async () => ({ keys: [{ ...other.publicJwk, kid: 'k1' }] });
    await expect(verify(f)).rejects.toMatchObject({ reason: expect.stringMatching(/delegation signature/) });
  });

  it('rejects a wrong request URL (htu)', async () => {
    await expect(verify(fixture(), { url: 'https://company.example/api/other' })).rejects.toMatchObject({
      reason: expect.stringMatching(/htu/),
    });
  });

  it('rejects a wrong method (htm)', async () => {
    await expect(verify(fixture(), { method: 'POST' })).rejects.toMatchObject({ reason: expect.stringMatching(/htm/) });
  });

  it('rejects a wrong audience', async () => {
    await expect(verify(fixture(), { issuer: 'https://other.example' })).rejects.toMatchObject({
      reason: expect.stringMatching(/aud/),
    });
  });

  it('rejects an ath that does not match the access token', async () => {
    await expect(verify(fixture(), { accessToken: 'different-token' })).rejects.toMatchObject({
      reason: expect.stringMatching(/ath/),
    });
  });

  it('rejects an access token whose client_id is not the session iss', async () => {
    await expect(verify(fixture(), { accessTokenClientId: 'https://someone-else.example/c.json' })).rejects.toMatchObject({
      reason: expect.stringMatching(/client_id/),
    });
  });

  it('rejects an iat outside the window', async () => {
    await expect(verify(fixture(), { now: NOW + 600 })).rejects.toMatchObject({ reason: expect.stringMatching(/iat/) });
  });

  it('rejects a replayed jti', async () => {
    const f = fixture();
    const replayCache = createReplayCache();
    await verify(f, { replayCache });
    await expect(verify(f, { replayCache })).rejects.toMatchObject({ reason: expect.stringMatching(/jti/) });
  });

  it('rejects a session signed by a key other than the delegated one', async () => {
    const f = fixture();
    const [h, p] = f.sessionJwt.split('.');
    const forged = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: ecKey().privateKey, dsaEncoding: 'ieee-p1363' });
    f.sessionJwt = `${h}.${p}.${forged.toString('base64url')}`;
    await expect(verify(f)).rejects.toMatchObject({ reason: expect.stringMatching(/Poppy-Session signature/) });
  });

  it('accepts a delegation signed with PS384 (RSA jwks key)', async () => {
    const f = fixture();
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const delegated = ecKey();
    const hdr = { typ: 'pap-delegation+jwt', alg: 'PS384', kid: 'rsa1' };
    const body = {
      iss: CLIENT_ID, iat: NOW, exp: NOW + 3600, jti: 'd1', cnf: { jwk: delegated.publicJwk },
    };
    const input = `${Buffer.from(JSON.stringify(hdr)).toString('base64url')}.${Buffer.from(JSON.stringify(body)).toString('base64url')}`;
    const sig = crypto.sign('sha384', Buffer.from(input), {
      key: rsa.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 48,
    });
    const delegation = `${input}.${sig.toString('base64url')}`;
    const sessionJwt = signSession({
      delegation, delegatedPrivateKey: delegated.privateKey, delegatedPublicJwk: delegated.publicJwk,
      clientId: CLIENT_ID, issuer: ISSUER, sid: 's', sub: 'u', method: 'GET', url: URL_, accessToken: TOKEN, now: NOW,
    });
    f.resolveJwks = async () => ({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa1' }] });
    await expect(verify({ ...f, sessionJwt })).resolves.toMatchObject({ sub: 'u' });
  });

  it('rejects garbage', async () => {
    await expect(verify({ sessionJwt: 'nope', resolveJwks: async () => ({ keys: [] }) })).rejects.toMatchObject({
      code: 'invalid_session',
    });
  });
});

describe('requirePoppySession middleware', () => {
  const run = async (headers) => {
    const f = fixture();
    const mw = requirePoppySession({ getIssuer: () => ISSUER, resolveJwks: f.resolveJwks, now: () => NOW });
    const req = {
      method: 'GET',
      protocol: 'https',
      originalUrl: '/api/orders?x=1',
      get: (name) => ({ host: 'company.example', ...(typeof headers === 'function' ? headers(f) : headers) })[name.toLowerCase()],
    };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();
    await mw(req, res, next);
    return { res, next, req };
  };

  it('rejects an access token with no Poppy-Session header', async () => {
    const { res, next } = await run({ authorization: `Bearer ${TOKEN}` });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid_session');
    expect(next).not.toHaveBeenCalled();
  });

  it('lets anonymous requests (neither header) through', async () => {
    const { next } = await run({});
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts a valid session with a token and sets req.poppy', async () => {
    const { next, req } = await run((f) => ({ authorization: `Bearer ${TOKEN}`, 'poppy-session': f.sessionJwt }));
    expect(next).toHaveBeenCalledWith();
    expect(req.poppy.sub).toBe('user-abc');
  });
});
