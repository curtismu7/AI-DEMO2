'use strict';

/**
 * token.decision.test.js — routes/token.js now gates minting on a PingOne
 * Authorize decision (DecisionContext='TokenExchange' in routes/decision.js)
 * instead of minting unconditionally on a valid subject-token signature.
 *
 * routes/token.js calls the decision endpoint over real HTTP (self-call, same
 * as every other consumer of this mock's decision endpoint), so this test
 * spins up a minimal Express server exposing only the decision route and
 * points AUTHZ_PORT at it before exercising the token handler directly.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_PORT = 9911;
const SECRET = 'test-secret';
const KNOWN_AUDIENCE = 'mcpserver.ping.demo'; // scope-topology.json: Super Banking MCP Server
const KNOWN_SCOPE = 'read';

let server;
let tokenHandler;

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
  };
}

function subjectToken(sub = 'user-1') {
  return jwt.sign({ sub }, SECRET, { algorithm: 'HS256' });
}

before(async () => {
  process.env.AUTHZ_JWT_SECRET = SECRET;
  process.env.AUTHZ_PORT = String(TEST_PORT);

  const app = express();
  app.use(express.json());
  app.post('/governance/pap/alpha/policy/:workerId/decision', (req, res) => require('./routes/decision')(req, res));
  await new Promise((resolve) => { server = app.listen(TEST_PORT, resolve); });

  delete require.cache[require.resolve('./routes/token')];
  tokenHandler = require('./routes/token');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('permits and mints a token for a known audience/scope', async () => {
  const req = { body: {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken(),
    audience: KNOWN_AUDIENCE,
    scope: KNOWN_SCOPE,
  } };
  const res = makeRes();
  await tokenHandler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.access_token, 'expected a minted access_token');
  const decoded = jwt.verify(res.body.access_token, SECRET, { algorithms: ['HS256'] });
  assert.strictEqual(decoded.sub, 'user-1');
  assert.strictEqual(decoded.aud, KNOWN_AUDIENCE);
});

test('denies (and does not mint) an exchange requesting an unknown audience', async () => {
  const req = { body: {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken(),
    audience: 'https://evil.example.com',
    scope: KNOWN_SCOPE,
  } };
  const res = makeRes();
  await tokenHandler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'access_denied');
  assert.strictEqual(res.body.access_token, undefined);
});

test('denies (and does not mint) an exchange requesting an unknown scope', async () => {
  const req = { body: {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken(),
    audience: KNOWN_AUDIENCE,
    scope: 'not-a-real-scope',
  } };
  const res = makeRes();
  await tokenHandler(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'access_denied');
  assert.strictEqual(res.body.access_token, undefined);
});
