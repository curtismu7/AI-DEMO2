'use strict';

/**
 * SVID-as-actor_token: the RFC 8693 branch that accepts a JWT-SVID and lands
 * the spiffe:// URI in act.sub.
 *
 * This is a PARITY MOCK of PingFederate's JWT Token Processor 2.0, which does
 * exactly this against SPIRE's OIDC Discovery Provider. PingOne cloud has no
 * trusted-external-issuer object, so it cannot -- that gap is why this exists
 * here rather than being configuration. See docs/SPIFFE_PLAN.md.
 *
 * The trust bundle is fetched over HTTP rather than shared in-process, because
 * that is how a verifier actually gets a trust domain's keys, and because
 * requiring demo_api_server from this service would be the cross-package
 * coupling the vault-decoupling plan exists to remove.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const TRUST_DOMAIN = 'demo.local';
const ISSUER = `spire-demo://${TRUST_DOMAIN}`;
const SPIFFE_ID = `spiffe://${TRUST_DOMAIN}/service/payments`;

// One keypair for the whole file: the "SPIRE CA".
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const rotatedKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedJwk = {
  ...rotatedKeyPair.publicKey.export({ format: 'jwk' }),
  kid: 'rotated-kid',
  alg: 'RS256',
  use: 'sig',
};

function mintSvid({
  sub = SPIFFE_ID,
  iss = ISSUER,
  audience = [TRUST_DOMAIN],
  expiresIn = 300,
  key = privateKey,
  keyid = 'test-kid',
} = {}) {
  return jwt.sign({ sub, iss, aud: audience }, key, {
    algorithm: 'RS256', expiresIn, keyid,
  });
}

describe('spiffeActorToken.verifySvid', () => {
  let bundle;
  const previousTrustDomain = process.env.SPIFFE_TRUST_DOMAIN;

  beforeEach(() => {
    process.env.SPIFFE_TRUST_DOMAIN = TRUST_DOMAIN;
    delete require.cache[require.resolve('./spiffeActorToken')];
    bundle = require('./spiffeActorToken');
    // Serve the trust bundle from an injectable fetcher rather than the network.
    bundle._setBundleFetcherForTest(async () => ({ keys: [jwk] }));
  });

  afterEach(() => {
    mock.restoreAll();
    if (previousTrustDomain === undefined) delete process.env.SPIFFE_TRUST_DOMAIN;
    else process.env.SPIFFE_TRUST_DOMAIN = previousTrustDomain;
  });

  test('accepts a genuine SVID and returns the spiffe:// id', async () => {
    const out = await bundle.verifySvid(mintSvid());
    assert.equal(out.valid, true);
    assert.equal(out.spiffeId, SPIFFE_ID);
  });

  test('rejects a tampered payload that keeps the signature', async () => {
    const good = mintSvid();
    const [h, , s] = good.split('.');
    const forged = Buffer.from(JSON.stringify({
      sub: `spiffe://${TRUST_DOMAIN}/service/admin`, iss: ISSUER,
      exp: Math.floor(Date.now() / 1000) + 300,
    })).toString('base64url');
    const out = await bundle.verifySvid(`${h}.${forged}.${s}`);
    assert.equal(out.valid, false);
  });

  test('rejects an expired SVID', async () => {
    const out = await bundle.verifySvid(mintSvid({ expiresIn: -10 }));
    assert.equal(out.valid, false);
  });

  test('rejects an SVID signed by a different CA', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const out = await bundle.verifySvid(mintSvid({ key: other }));
    assert.equal(out.valid, false);
  });

  test('rejects a wrong issuer', async () => {
    const out = await bundle.verifySvid(mintSvid({ iss: 'spire-demo://evil.example' }));
    assert.equal(out.valid, false);
  });

  test('rejects a valid signature with the wrong audience', async () => {
    const out = await bundle.verifySvid(mintSvid({ audience: ['other.local'] }));
    assert.equal(out.valid, false);
    assert.match(out.reason, /audience/i);
  });

  test('rejects a signed SVID with no audience', async () => {
    const svid = jwt.sign({ sub: SPIFFE_ID, iss: ISSUER }, privateKey, {
      algorithm: 'RS256', expiresIn: 300,
    });
    const out = await bundle.verifySvid(svid);
    assert.equal(out.valid, false);
    assert.equal(out.spiffeId, null);
    assert.match(out.reason, /audience/i);
  });

  test('accepts a string audience and an audience array containing the trust domain', async () => {
    for (const audience of [TRUST_DOMAIN, ['other.local', TRUST_DOMAIN]]) {
      assert.equal((await bundle.verifySvid(mintSvid({ audience }))).valid, true);
    }
  });

  test('uses the configured trust domain as the audience', async () => {
    process.env.SPIFFE_TRUST_DOMAIN = 'configured.local';
    delete require.cache[require.resolve('./spiffeActorToken')];
    bundle = require('./spiffeActorToken');
    bundle._setBundleFetcherForTest(async () => ({ keys: [jwk] }));
    const identity = { sub: 'spiffe://configured.local/service/payments', iss: 'spire-demo://configured.local' };
    assert.equal((await bundle.verifySvid(mintSvid({ ...identity, audience: ['configured.local'] }))).valid, true);
    assert.equal((await bundle.verifySvid(mintSvid({ ...identity, audience: [TRUST_DOMAIN] }))).valid, false);
  });

  test('rejects a foreign subject even with the trusted issuer and audience', async () => {
    const out = await bundle.verifySvid(mintSvid({ sub: 'spiffe://evil.example/service/payments' }));
    assert.equal(out.valid, false);
    assert.equal(out.spiffeId, null);
  });

  test('rejects an SVID from a foreign trust domain', async () => {
    const out = await bundle.verifySvid(mintSvid({
      sub: 'spiffe://evil.example/service/payments',
      iss: 'spire-demo://evil.example',
      audience: ['evil.example'],
    }));
    assert.equal(out.valid, false);
    assert.equal(out.spiffeId, null);
  });

  test('rejects a sub that is not a SPIFFE ID', async () => {
    const out = await bundle.verifySvid(mintSvid({ sub: 'not-a-spiffe-id' }));
    assert.equal(out.valid, false);
  });

  // An HS256 token signed with the PUBLIC key as the HMAC secret. The bundle is
  // public by design, so this is the attack the algorithm pin exists for.
  test('rejects an HS256 token signed with the published public key', async () => {
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
    const forged = jwt.sign({ sub: SPIFFE_ID, iss: ISSUER }, pubPem, {
      algorithm: 'HS256', expiresIn: 300,
    });
    const out = await bundle.verifySvid(forged);
    assert.equal(out.valid, false);
  });

  test('fails closed when the trust bundle is unreachable', async () => {
    bundle._setBundleFetcherForTest(async () => { throw new Error('ECONNREFUSED'); });
    const out = await bundle.verifySvid(mintSvid());
    assert.equal(out.valid, false);
    assert.match(out.reason, /bundle/i);
  });

  test('fails closed when the trust bundle is empty', async () => {
    bundle._setBundleFetcherForTest(async () => ({ keys: [] }));
    const out = await bundle.verifySvid(mintSvid());
    assert.deepEqual(out, {
      valid: false,
      spiffeId: null,
      reason: 'trust bundle empty',
    });
  });

  test('keeps the cached bundle until expiry, then trusts only the rotated bundle', async () => {
    let now = 1_000_000;
    let activeJwk = jwk;
    let fetches = 0;
    mock.method(Date, 'now', () => now);
    bundle._setBundleFetcherForTest(async () => {
      fetches += 1;
      return { keys: [activeJwk] };
    });

    const oldSvid = mintSvid();
    const newSvid = mintSvid({
      key: rotatedKeyPair.privateKey,
      keyid: 'rotated-kid',
    });

    assert.equal((await bundle.verifySvid(oldSvid)).valid, true);
    activeJwk = rotatedJwk;
    assert.equal((await bundle.verifySvid(newSvid)).valid, false);
    assert.equal((await bundle.verifySvid(oldSvid)).valid, true);
    assert.equal(fetches, 1);

    now += 60_001;
    assert.equal((await bundle.verifySvid(newSvid)).valid, true);
    assert.equal((await bundle.verifySvid(oldSvid)).valid, false);
    assert.equal(fetches, 2);
  });
});
