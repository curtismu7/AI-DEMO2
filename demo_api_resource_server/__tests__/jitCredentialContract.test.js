'use strict';

/**
 * Verify side of the JIT credential contract.
 *
 * Pairs with demo_api_server/tests/jitCredentialContract.test.js. Both assert
 * against schemas/jit-credential.contract.json rather than against each other,
 * so neither service requires the other — the file is read by tests only.
 *
 * The mint side proves the broker PRODUCES the contract's claims. This side
 * proves the verifier actually ENFORCES the ones the contract says it must.
 * Without it, a verifier could quietly stop checking `aud` and every suite in
 * both services would stay green.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');

const TEST_KEY = 'test-mortgage-key-9999';
process.env.API_RESOURCE_SERVER_API_KEY = TEST_KEY;

const app = require('../server');

const CONTRACT = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'schemas', 'jit-credential.contract.json'), 'utf8',
));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Mint straight from the contract, so this side never hard-codes the shape. */
function mintFromContract(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: CONTRACT.issuer,
    sub: 'mcp-gateway',
    aud: 'mortgage',
    tool: 'show_mortgage',
    jti: crypto.randomBytes(8).toString('hex'),
    iat: now,
    exp: now + CONTRACT.ttlSeconds,
    ...overrides,
  };
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined) delete claims[k];
  }
  const header = b64({ alg: CONTRACT.algorithm, typ: 'JWT' });
  const payload = b64(claims);
  const sig = crypto.createHmac('sha256', TEST_KEY)
    .update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const callMortgage = (cred) => request(app).get('/mortgage').set('X-API-Key', cred);

describe('the backend enforces the shared credential contract', () => {
  test('accepts a credential built straight from the contract', async () => {
    // If this fails, the two sides have drifted and everything below is moot.
    const res = await callMortgage(mintFromContract());
    expect(res.status).toBe(200);
  });

  test('rejects a wrong issuer, as the contract requires', async () => {
    expect(CONTRACT.verifierMustReject.iss).toBeTruthy();
    const res = await callMortgage(mintFromContract({ iss: 'someone-else' }));
    expect(res.status).toBe(401);
  });

  test('rejects a credential minted for a different route, as the contract requires', async () => {
    expect(CONTRACT.verifierMustReject.aud).toBeTruthy();
    const res = await callMortgage(mintFromContract({ aud: 'permit' }));
    expect(res.status).toBe(401);
  });

  test('rejects a credential with no route binding at all', async () => {
    const res = await callMortgage(mintFromContract({ aud: undefined }));
    expect(res.status).toBe(401);
  });

  test('rejects an expired credential, as the contract requires', async () => {
    expect(CONTRACT.verifierMustReject.exp).toBeTruthy();
    const res = await callMortgage(mintFromContract({ exp: Math.floor(Date.now() / 1000) - 5 }));
    expect(res.status).toBe(401);
  });
});
