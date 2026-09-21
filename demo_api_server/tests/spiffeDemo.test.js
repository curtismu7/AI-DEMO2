'use strict';

/**
 * SPIFFE demo: /verify must actually verify.
 *
 * Before this, it called decodeDemoJwt -- a base64 decode with no signature,
 * exp, aud or iss check -- against tokens minted with `alg: none` and the
 * literal signature 'demo-signature-not-cryptographically-valid'. Every case
 * below passed. Any SVID could be forged by hand.
 *
 * That is a correctness hole, not a fidelity gap: the endpoint's whole job is
 * to answer "should this peer be trusted?", and it answered yes to anything.
 *
 * What stays mocked is the ISSUER (no SPIRE server, no workload attestation).
 * The cryptography is real, which is the half that can be wrong silently.
 */
const request = require('supertest');
const express = require('express');

const spiffeDemo = require('../routes/spiffeDemo');
const mockSpiffeWorkloadApi = require('../services/mockSpiffeWorkloadApi');
const spiffeTrustDomain = require('../services/spiffeTrustDomain');

const TRUST_DOMAIN = 'demo.local';
const SPIFFE_ID = `spiffe://${TRUST_DOMAIN}/service/api`;
const WORKLOAD_ID = 'api';
const SELECTOR_CONTEXT = { namespace: 'demo', serviceAccount: 'api' };

beforeEach(() => {
  mockSpiffeWorkloadApi.registerWorkload({
    workloadId: WORKLOAD_ID,
    spiffeId: SPIFFE_ID,
    selectors: SELECTOR_CONTEXT,
  });
});

function buildApp() {
  const app = express();
  app.use('/api/demo/spiffe', spiffeDemo);
  return app;
}

const issue = (body = {}) =>
  request(buildApp()).post('/api/demo/spiffe/svid').send({
    workload_id: WORKLOAD_ID,
    selector_context: SELECTOR_CONTEXT,
    ...body,
  });

const verify = (svid, expected_trust_domain = TRUST_DOMAIN) =>
  request(buildApp()).post('/api/demo/spiffe/verify').send({ svid, expected_trust_domain });

const issueTrusted = () => ({ body: { svid: spiffeTrustDomain.issueSvid(SPIFFE_ID) } });

/** Swap a JWT's payload while keeping its original header and signature. */
function tamper(svid, mutate) {
  const [h, p, s] = svid.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  mutate(claims);
  const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${forged}.${s}`;
}

describe('POST /api/demo/spiffe/svid', () => {
  test('issues an SVID for a registered workload with matching selectors', async () => {
    const res = await issue({ audience: 'demo.local' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      svid: expect.any(String),
      svid_type: 'jwt-svid',
      trust_domain: TRUST_DOMAIN,
    });
  });

  test('rejects an unknown workload with a stable authorization error', async () => {
    const res = await issue({ workload_id: 'unknown' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workload_not_authorized' });
  });

  test('rejects selector mismatches with the same authorization error', async () => {
    const res = await issue({
      selector_context: { namespace: 'other', serviceAccount: 'api' },
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workload_not_authorized' });
  });

  test('does not let an arbitrary spiffe_id control the minted identity', async () => {
    const res = await issue({ spiffe_id: `spiffe://${TRUST_DOMAIN}/service/admin` });
    const verified = await verify(res.body.svid);

    expect(res.status).toBe(200);
    expect(verified.body.valid).toBe(true);
    expect(verified.body.peer_spiffe_id).toBe(SPIFFE_ID);
  });

  test('keeps malformed workload requests at 400', async () => {
    const res = await request(buildApp()).post('/api/demo/spiffe/svid').send({
      spiffe_id: SPIFFE_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});

describe('POST /api/demo/spiffe/verify', () => {
  test('accepts a genuine SVID from the expected trust domain', async () => {
    const { body } = issueTrusted();
    const res = await verify(body.svid);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.peer_spiffe_id).toBe(SPIFFE_ID);
  });

  test('rejects a tampered payload that keeps the original signature', async () => {
    const { body } = issueTrusted();
    const forged = tamper(body.svid, (c) => { c.sub = 'spiffe://demo.local/service/admin'; });

    const res = await verify(forged);
    expect(res.body.valid).toBe(false);
  });

  test('rejects an expired SVID', async () => {
    const { body } = issueTrusted();
    const expired = tamper(body.svid, (c) => { c.exp = 1; });

    const res = await verify(expired);
    expect(res.body.valid).toBe(false);
  });

  test('rejects an SVID from a foreign trust domain', async () => {
    const { body } = issueTrusted();
    const res = await verify(body.svid, 'evil.example');

    expect(res.body.valid).toBe(false);
  });

  test('rejects a wrong issuer', async () => {
    const { body } = issueTrusted();
    const forged = tamper(body.svid, (c) => { c.iss = 'spire-demo://evil.example'; });

    const res = await verify(forged);
    expect(res.body.valid).toBe(false);
  });

  // The classic hand-rolled-JWT hole: a caller supplies an unsigned token and
  // claims whatever identity it likes.
  test('rejects a hand-made alg:none token', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const header = b64({ alg: 'none', typ: 'JWT' });
    const claims = b64({
      sub: SPIFFE_ID,
      iss: `spire-demo://${TRUST_DOMAIN}`,
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const res = await verify(`${header}.${claims}.`);
    expect(res.body.valid).toBe(false);
  });

  /**
   * Algorithm confusion, and the reason the verifier pins RS256.
   *
   * The trust domain's PUBLIC key is published at /jwks — that is the point of
   * a trust bundle. An attacker takes it and signs their own token with HS256,
   * using the public key as the HMAC secret. A verifier that reads the token's
   * own `alg` to decide how to check it will happily verify that with the key
   * it already has, and the attacker gets to name any SPIFFE ID they like.
   *
   * Measured: jsonwebtoken v9 rejects this on its own (it checks key type
   * against algorithm), so this test passes with or without our RS256 pin. It
   * asserts the BEHAVIOUR, which is what should hold whichever layer enforces
   * it — do not read it as proof that the pin is load-bearing.
   */
  test('rejects an HS256 token signed with the published public key', async () => {
    const jwt = require('jsonwebtoken');
    const { publicJwk } = require('../services/spiffeTrustDomain');
    const crypto = require('crypto');

    const pubPem = crypto
      .createPublicKey({ key: publicJwk(), format: 'jwk' })
      .export({ type: 'spki', format: 'pem' });

    const forged = jwt.sign(
      { sub: 'spiffe://demo.local/service/admin', iss: `spire-demo://${TRUST_DOMAIN}` },
      pubPem,
      { algorithm: 'HS256', expiresIn: 300 },
    );

    const res = await verify(forged);
    expect(res.body.valid).toBe(false);
  });

  test('rejects a garbage string', async () => {
    const res = await verify('not-a-jwt');
    expect(res.body.valid).toBe(false);
  });
});

describe('the trust bundle is published', () => {
  // A verifier needs the trust domain's PUBLIC key. Publishing it is what makes
  // this a trust bundle rather than a shared secret.
  test('GET /api/demo/spiffe/jwks exposes a public key, never the private one', async () => {
    const res = await request(buildApp()).get('/api/demo/spiffe/jwks');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys.length).toBeGreaterThan(0);
    const jwk = res.body.keys[0];
    expect(jwk.kty).toBe('RSA');
    // `d` is the RSA private exponent — its presence would publish the CA key.
    expect(jwk.d).toBeUndefined();
  });
});
