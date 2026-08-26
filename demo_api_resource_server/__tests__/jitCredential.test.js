'use strict';

// The backend half of the JIT credential broker: it verifies a short-TTL,
// tool-bound credential signed with the service key it already holds, so the
// static key never has to travel. Verified with node crypto rather than a JWT
// library — this service is deliberately dependency-minimal, and adding one
// would break bootstrap-worktree until every checkout reinstalled.
const crypto = require('crypto');
const request = require('supertest');

const TEST_KEY = 'test-mortgage-key-9999';
process.env.API_RESOURCE_SERVER_API_KEY = TEST_KEY;

const app = require('../server');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/**
 * Mint the same shape services/jitCredentialBroker.js produces.
 *
 * `aud` is the backend route segment, and it is what this service gates on:
 * the backend always knows its own route from req.path, so it needs no
 * route->tool table — including for the routes it loads dynamically from
 * feature-records.generated.json. `tool` rides along for audit only.
 */
function mint({ aud = 'mortgage', tool = 'show_mortgage', exp, alg = 'HS256', key = TEST_KEY } = {}) {
  const header = b64({ alg, typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'bff-broker',
    sub: 'ping-gateway',
    aud,
    tool,
    jti: crypto.randomBytes(8).toString('hex'),
    iat: now,
    exp: exp === undefined ? now + 30 : exp,
  };
  // `aud: null` means "omit the claim entirely" — passing undefined would hit
  // the default parameter above and silently mint a valid credential.
  if (aud === null) delete claims.aud;
  const payload = b64(claims);
  const signature = crypto
    .createHmac('sha256', key)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function callMortgage(presented) {
  return request(app).get('/mortgage').set('X-API-Key', presented);
}

describe('JIT credential verification', () => {
  test('accepts a valid credential bound to this route', async () => {
    const res = await callMortgage(mint({ tool: 'show_mortgage' }));
    expect(res.status).toBe(200);
  });

  test('still accepts the legacy static key — flag-off path is untouched', async () => {
    const res = await callMortgage(TEST_KEY);
    expect(res.status).toBe(200);
  });

  test('rejects an expired credential', async () => {
    const res = await callMortgage(mint({ exp: Math.floor(Date.now() / 1000) - 5 }));
    expect(res.status).toBe(401);
  });

  test('rejects a credential minted for a different route', async () => {
    const res = await callMortgage(mint({ aud: 'permit', tool: 'show_permit' }));
    expect(res.status).toBe(401);
  });

  test('rejects a credential with no route binding at all', async () => {
    const res = await callMortgage(mint({ aud: null }));
    expect(res.status).toBe(401);
  });

  test('rejects a credential signed with the wrong key', async () => {
    const res = await callMortgage(mint({ key: 'some-other-backend-key' }));
    expect(res.status).toBe(401);
  });

  // This is the case the algorithm pin exists for. The token below is signed
  // CORRECTLY with HMAC-SHA256, so the signature check passes — only the
  // `alg !== 'HS256'` guard rejects it. Verified revert-to-RED: removing that
  // guard makes this test, and only this test, fail.
  test('rejects a correctly-signed token that declares a different alg', async () => {
    const res = await callMortgage(mint({ alg: 'none' }));
    expect(res.status).toBe(401);
  });

  // An unsigned alg:none token — caught by the signature check, not the pin.
  test('rejects alg:none with an empty signature', async () => {
    const header = b64({ alg: 'none', typ: 'JWT' });
    const payload = b64({
      iss: 'bff-broker', tool: 'show_mortgage', exp: Math.floor(Date.now() / 1000) + 30,
    });
    const res = await callMortgage(`${header}.${payload}.`);
    expect(res.status).toBe(401);
  });

  test('rejects a tampered payload that keeps the original signature', async () => {
    const good = mint({ tool: 'show_mortgage' });
    const [header, , signature] = good.split('.');
    const forged = b64({
      iss: 'bff-broker', tool: 'show_mortgage', exp: Math.floor(Date.now() / 1000) + 99999,
    });
    const res = await callMortgage(`${header}.${forged}.${signature}`);
    expect(res.status).toBe(401);
  });
});
