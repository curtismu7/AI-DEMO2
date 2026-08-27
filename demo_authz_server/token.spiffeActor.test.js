'use strict';

/**
 * RFC 8693 with a JWT-SVID as actor_token.
 *
 * Mirrors PingFederate's JWT Token Processor 2.0: accept an SVID from a trusted
 * SPIFFE trust domain as the ACTOR, and land the full spiffe:// URI in act.sub
 * so the delegation chain records WHICH WORKLOAD acted, not just that something did.
 *
 * Flag-gated OFF by default. Unlike the /verify forgery fix, this is new
 * capability rather than a hole to close, so the default must not change
 * behaviour for anyone.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const SECRET = 'test-authz-secret-not-a-real-one';
const TRUST_DOMAIN = 'demo.local';
const SPIFFE_ID = `spiffe://${TRUST_DOMAIN}/service/payments`;
const SVID_TYPE = 'urn:ietf:params:oauth:token-type:jwt';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const mintSvid = () => jwt.sign(
  { sub: SPIFFE_ID, iss: `spire-demo://${TRUST_DOMAIN}`, aud: [TRUST_DOMAIN] },
  privateKey, { algorithm: 'RS256', expiresIn: 300, keyid: 'k1' },
);
const mintSubject = () => jwt.sign({ sub: 'user-123' }, SECRET, { algorithm: 'HS256', expiresIn: 300 });

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function load() {
  for (const m of ['./routes/token', './spiffeActorToken', './routes/decision']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* not loaded */ }
  }
  const bundle = require('./spiffeActorToken');
  bundle._setBundleFetcherForTest(async () => ({ keys: [jwk] }));
  return { handler: require('./routes/token'), bundle };
}

describe('token exchange with a JWT-SVID actor_token', () => {
  const prev = { secret: process.env.AUTHZ_JWT_SECRET, flag: process.env.FF_SPIFFE_ACTOR_TOKEN };

  beforeEach(() => { process.env.AUTHZ_JWT_SECRET = SECRET; });
  afterEach(() => {
    if (prev.secret === undefined) delete process.env.AUTHZ_JWT_SECRET;
    else process.env.AUTHZ_JWT_SECRET = prev.secret;
    if (prev.flag === undefined) delete process.env.FF_SPIFFE_ACTOR_TOKEN;
    else process.env.FF_SPIFFE_ACTOR_TOKEN = prev.flag;
  });

  test('flag OFF: an SVID actor_token is rejected, not silently HS256-verified', async () => {
    process.env.FF_SPIFFE_ACTOR_TOKEN = 'false';
    const { handler } = load();
    const res = fakeRes();
    await handler({ body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: mintSubject(),
      actor_token: mintSvid(),
      actor_token_type: SVID_TYPE,
      audience: 'mcpserver.ping.demo', scope: 'read',
    } }, res);

    // The SVID is RS256 and the legacy path verifies HS256 with AUTHZ_JWT_SECRET,
    // so it must fail rather than be mistaken for an ordinary actor token.
    assert.notEqual(res.statusCode, 200);
  });

  test('flag ON: a genuine SVID lands the spiffe:// id in act.sub', async () => {
    process.env.FF_SPIFFE_ACTOR_TOKEN = 'true';
    const { handler } = load();
    const res = fakeRes();
    await handler({ body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: mintSubject(),
      actor_token: mintSvid(),
      actor_token_type: SVID_TYPE,
      audience: 'mcpserver.ping.demo', scope: 'read',
    } }, res);

    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    const claims = jwt.decode(res.body.access_token);
    assert.equal(claims.act?.sub, SPIFFE_ID);
  });

  test('flag ON: a forged SVID is refused', async () => {
    process.env.FF_SPIFFE_ACTOR_TOKEN = 'true';
    const { handler } = load();
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign(
      { sub: `spiffe://${TRUST_DOMAIN}/service/admin`, iss: `spire-demo://${TRUST_DOMAIN}` },
      other, { algorithm: 'RS256', expiresIn: 300 },
    );
    const res = fakeRes();
    await handler({ body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: mintSubject(),
      actor_token: forged,
      actor_token_type: SVID_TYPE,
      audience: 'mcpserver.ping.demo', scope: 'read',
    } }, res);

    assert.notEqual(res.statusCode, 200);
  });

  test('flag ON: an ordinary HS256 actor_token still works — no regression', async () => {
    process.env.FF_SPIFFE_ACTOR_TOKEN = 'true';
    const { handler } = load();
    const res = fakeRes();
    await handler({ body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: mintSubject(),
      actor_token: jwt.sign({ sub: 'agent-1' }, SECRET, { algorithm: 'HS256', expiresIn: 300 }),
      actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: 'mcpserver.ping.demo', scope: 'read',
    } }, res);

    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(jwt.decode(res.body.access_token).act?.sub, 'agent-1');
  });
});
