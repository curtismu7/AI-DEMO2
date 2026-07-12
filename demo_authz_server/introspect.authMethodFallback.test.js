'use strict';

/**
 * RFC 7662 upstream introspection — client auth-method auto-fallback.
 *
 * A 401 from PingOne's /as/introspect always means the INTROSPECTING CLIENT's
 * own credentials/auth-method were rejected (invalid_client) — never that the
 * subject token is invalid (that's a 200 with active:false). So a 401 is
 * unambiguously our own misconfiguration, safe to retry with the other auth
 * method (client_secret_basic vs client_secret_post). A non-401 failure
 * (network/5xx) is NOT a method problem, so it must not trigger a wasted
 * second attempt.
 */

const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const ENV_KEYS = [
  'PINGONE_INTROSPECTION_ENDPOINT',
  'GW_INTROSPECTION_CLIENT_ID',
  'GW_INTROSPECTION_CLIENT_SECRET',
  'MCP_GW_CLIENT_ID',
  'MCP_GW_CLIENT_SECRET',
  'PINGONE_INTROSPECTION_AUTH_METHOD',
  'AUTHZ_JWT_SECRET',
];
let savedEnv;

function fresh() {
  delete require.cache[require.resolve('./routes/introspect')];
  delete require.cache[require.resolve('axios')];
  return require('./routes/introspect');
}

function mkRes() {
  return { body: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function unsupportedAuthMethodError() {
  return Object.assign(new Error('Request failed with status code 401'), {
    response: { status: 401, data: { error: 'invalid_client', error_description: 'Request denied: Unsupported authentication method' } },
  });
}

function networkError() {
  return Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/env-id/as/introspect';
  process.env.GW_INTROSPECTION_CLIENT_ID = 'client-abc';
  process.env.GW_INTROSPECTION_CLIENT_SECRET = 'secret-xyz';
  delete process.env.MCP_GW_CLIENT_ID;
  delete process.env.MCP_GW_CLIENT_SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('uses the configured method successfully with no fallback attempt', async () => {
  process.env.PINGONE_INTROSPECTION_AUTH_METHOD = 'basic';
  const introspectHandler = fresh();
  const axios = require('axios');
  const calls = [];
  mock.method(axios, 'post', async (url, body, opts) => {
    calls.push({ url, body, headers: opts.headers });
    return { data: { active: true, sub: 'user-1' } };
  });

  const res = mkRes();
  await introspectHandler({ body: { token: 'tok-1' } }, res);

  assert.strictEqual(res.body.active, true);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].headers.Authorization.startsWith('Basic '));
});

test('auto-falls back from post to basic on a 401 invalid_client, and caches the winning method', async () => {
  process.env.PINGONE_INTROSPECTION_AUTH_METHOD = 'post';
  const introspectHandler = fresh();
  const axios = require('axios');
  const calls = [];
  mock.method(axios, 'post', async (url, body, opts) => {
    calls.push({ headers: opts.headers, body });
    if (!opts.headers.Authorization) {
      // client_secret_post attempt (no Authorization header) — rejected
      throw unsupportedAuthMethodError();
    }
    return { data: { active: true, sub: 'user-1' } };
  });

  const res1 = mkRes();
  await introspectHandler({ body: { token: 'tok-1' } }, res1);
  assert.strictEqual(res1.body.active, true);
  assert.strictEqual(calls.length, 2, 'first request: post attempt, then basic fallback');
  assert.ok(!calls[0].headers.Authorization, 'first attempt used post (body creds, no Authorization header)');
  assert.ok(calls[1].headers.Authorization.startsWith('Basic '), 'fallback attempt used basic');

  // Second request should go straight to the cached working method (basic) —
  // no repeat of the failing post attempt.
  const res2 = mkRes();
  await introspectHandler({ body: { token: 'tok-2' } }, res2);
  assert.strictEqual(res2.body.active, true);
  assert.strictEqual(calls.length, 3, 'second request reuses the cached method — exactly one more call');
  assert.ok(calls[2].headers.Authorization.startsWith('Basic '));
});

test('both auth methods failing returns active:false with an error, not a crash', async () => {
  process.env.PINGONE_INTROSPECTION_AUTH_METHOD = 'post';
  const introspectHandler = fresh();
  const axios = require('axios');
  mock.method(axios, 'post', async () => { throw unsupportedAuthMethodError(); });

  const res = mkRes();
  await introspectHandler({ body: { token: 'tok-1' } }, res);
  assert.strictEqual(res.body.active, false);
  assert.ok(res.body.error);
});

test('a non-401 failure (network error) does not trigger a wasted fallback attempt', async () => {
  process.env.PINGONE_INTROSPECTION_AUTH_METHOD = 'basic';
  const introspectHandler = fresh();
  const axios = require('axios');
  const calls = [];
  mock.method(axios, 'post', async () => { calls.push(1); throw networkError(); });

  const res = mkRes();
  await introspectHandler({ body: { token: 'tok-1' } }, res);
  assert.strictEqual(res.body.active, false);
  assert.strictEqual(calls.length, 1, 'network errors are not a client-auth-method problem — no second attempt');
});

test('a genuinely inactive token (200, active:false) is NOT treated as an infra error', async () => {
  process.env.PINGONE_INTROSPECTION_AUTH_METHOD = 'basic';
  const introspectHandler = fresh();
  const axios = require('axios');
  mock.method(axios, 'post', async () => ({ data: { active: false } }));

  const res = mkRes();
  await introspectHandler({ body: { token: 'tok-1' } }, res);
  assert.strictEqual(res.body.active, false);
  assert.strictEqual(res.body.error, undefined, 'a confirmed-inactive token must not carry an infra-error marker');
});
