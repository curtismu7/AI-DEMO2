'use strict';

/**
 * RFC 7662 upstream introspection must authenticate as the client that OWNS
 * the token. The chained A2A exchange mints its final token under the
 * SPECIALIST's client (a2aDelegationService exchange #2), so introspecting it
 * with the default exchanger credentials made PingOne return active:false and
 * the Node gateway rejected every A2A specialist call ("Token is revoked or
 * no longer active"). The handler now selects credentials by the token's
 * client_id claim, falling back to the configured default.
 */

const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

const DEFAULT_ID = 'default-client-id';
const DEFAULT_SECRET = 'default-client-secret';
const SPECIALIST_ID = 'specialist-client-id';
const SPECIALIST_SECRET = 'specialist-client-secret';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (clientId) =>
  `${b64u({ alg: 'none' })}.${b64u({ client_id: clientId, sub: 'user1' })}.sig`;

let axios;
let handler;
let calls;

function fresh() {
  process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://pingone.example/as/introspect';
  process.env.GW_INTROSPECTION_CLIENT_ID = DEFAULT_ID;
  process.env.GW_INTROSPECTION_CLIENT_SECRET = DEFAULT_SECRET;
  process.env.PINGONE_A2A_TESTSPEC_AGENT_CLIENT_ID = SPECIALIST_ID;
  process.env.PINGONE_A2A_TESTSPEC_AGENT_CLIENT_SECRET = SPECIALIST_SECRET;
  delete require.cache[require.resolve('./routes/introspect')];
  axios = require('axios');
  calls = [];
  mock.method(axios, 'post', async (url, body, opts) => {
    calls.push({ url, body, opts });
    return { data: { active: true, client_id: 'whoever' } };
  });
  handler = require('./routes/introspect');
}

function basicAuthOf(call) {
  return call.opts?.headers?.Authorization || '';
}

function makeRes() {
  return { body: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => {
  mock.restoreAll();
  fresh();
});

test('a specialist-minted token introspects with the specialist credentials', async () => {
  const res = makeRes();
  await handler({ body: { token: tokenFor(SPECIALIST_ID) } }, res);
  assert.equal(calls.length, 1);
  const expected = `Basic ${Buffer.from(`${SPECIALIST_ID}:${SPECIALIST_SECRET}`).toString('base64')}`;
  assert.equal(basicAuthOf(calls[0]), expected);
  assert.equal(res.body.active, true);
});

test('a default-client token keeps the configured credentials', async () => {
  const res = makeRes();
  await handler({ body: { token: tokenFor(DEFAULT_ID) } }, res);
  const expected = `Basic ${Buffer.from(`${DEFAULT_ID}:${DEFAULT_SECRET}`).toString('base64')}`;
  assert.equal(basicAuthOf(calls[0]), expected);
});

test('an unknown client_id falls back to the configured credentials', async () => {
  const res = makeRes();
  await handler({ body: { token: tokenFor('nobody-knows-me') } }, res);
  const expected = `Basic ${Buffer.from(`${DEFAULT_ID}:${DEFAULT_SECRET}`).toString('base64')}`;
  assert.equal(basicAuthOf(calls[0]), expected);
});
