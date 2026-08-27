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
const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

const TRUST_DOMAIN = 'demo.local';
const ISSUER = `spire-demo://${TRUST_DOMAIN}`;
const SPIFFE_ID = `spiffe://${TRUST_DOMAIN}/service/payments`;

// One keypair for the whole file: the "SPIRE CA".
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };

function mintSvid({ sub = SPIFFE_ID, iss = ISSUER, expiresIn = 300, key = privateKey } = {}) {
  return jwt.sign({ sub, iss, aud: [TRUST_DOMAIN] }, key, {
    algorithm: 'RS256', expiresIn, keyid: 'test-kid',
  });
}

describe('spiffeActorToken.verifySvid', () => {
  let bundle;

  beforeEach(() => {
    delete require.cache[require.resolve('./spiffeActorToken')];
    bundle = require('./spiffeActorToken');
    // Serve the trust bundle from an injectable fetcher rather than the network.
    bundle._setBundleFetcherForTest(async () => ({ keys: [jwk] }));
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
});
