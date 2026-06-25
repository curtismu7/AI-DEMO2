'use strict';
/**
 * Regression tests for GET /internal/id-token
 *
 * Tests 1-7 per plan spec.
 * Mock everything: shared secret read via process.env, sessionStore via app.set().
 * No real configStore or .env calls.
 */

// Set secret BEFORE require() so the module captures it at load time
process.env.BFF_INTERNAL_SECRET = 'test-secret-123';

const express = require('express');
const request = require('supertest');

// ---- helper: build a test app -----------------------------------------------

function buildApp({ registerStore = true, store = null } = {}) {
  const app = express();
  app.use(express.json());
  if (registerStore && store) {
    app.set('sessionStore', store);
  }
  // Re-require each time so module-level INTERNAL_SECRET picks up the env var
  // (jest module cache is per test file by default, so this is safe here)
  const agentIdToken = require('../../routes/agentIdToken');
  app.use('/internal', agentIdToken);
  return app;
}

// ---- stub sessionStore -------------------------------------------------------

function makeStore(sessions = []) {
  return {
    all: jest.fn((cb) => cb(null, sessions)),
  };
}

// =============================================================================
// Test 1: Missing secret header → 403
// =============================================================================
test('Test 1: Missing x-internal-gateway-secret returns 403', async () => {
  const app = buildApp({ store: makeStore([]) });
  const res = await request(app).get('/internal/id-token').set('x-subject-sub', 'user-123');
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('forbidden');
});

// =============================================================================
// Test 2: Wrong secret → 403
// =============================================================================
test('Test 2: Wrong x-internal-gateway-secret returns 403', async () => {
  const app = buildApp({ store: makeStore([]) });
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'wrong-secret')
    .set('x-subject-sub', 'user-123');
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('forbidden');
});

// =============================================================================
// Test 3: Correct secret but no matching session → 404
// =============================================================================
test('Test 3: Correct secret + no matching session returns 404', async () => {
  const app = buildApp({ store: makeStore([]) });
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'test-secret-123')
    .set('x-subject-sub', 'nobody');
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('session_not_found');
});

// =============================================================================
// Test 4: Correct secret + session with idToken → 200 + { idToken }
// =============================================================================
test('Test 4: Correct secret + matching session with idToken returns 200', async () => {
  const sessions = [
    { oauthTokens: { subjectSub: 'user-abc', idToken: 'eyJhbGciOiJSUzI1NiJ9.fake.jwt' } },
  ];
  const app = buildApp({ store: makeStore(sessions) });
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'test-secret-123')
    .set('x-subject-sub', 'user-abc');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ idToken: 'eyJhbGciOiJSUzI1NiJ9.fake.jwt' });
});

// =============================================================================
// Test 5: Correct secret + session WITHOUT idToken → 412
// =============================================================================
test('Test 5: Correct secret + session without idToken returns 412', async () => {
  const sessions = [
    { oauthTokens: { subjectSub: 'user-abc', idToken: null } },
  ];
  const app = buildApp({ store: makeStore(sessions) });
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'test-secret-123')
    .set('x-subject-sub', 'user-abc');
  expect(res.status).toBe(412);
  expect(res.body.error).toBe('id_token_missing');
});

// =============================================================================
// Test 6: Endpoint is NOT under /api/* — verify that mounting under /internal works
// =============================================================================
test('Test 6: Endpoint is mounted under /internal, not /api/*', async () => {
  // Build app WITHOUT an /api/* mount for agentIdToken — it should only respond under /internal
  const app = buildApp({ store: makeStore([]) });

  // /api/id-token should NOT be handled by this router (404 from Express)
  const res = await request(app).get('/api/id-token');
  expect(res.status).toBe(404); // Express default 404 — route not registered

  // /internal/id-token should respond (403 for missing secret — proves it's mounted)
  const res2 = await request(app).get('/internal/id-token');
  expect(res2.status).toBe(403);
});

// =============================================================================
// Test 7: app.get('sessionStore') is undefined → 503 (not throw, not 500)
// =============================================================================
test('Test 7: Missing sessionStore registration returns 503 session_store_unavailable', async () => {
  // Build app WITHOUT registering a sessionStore
  const app = buildApp({ registerStore: false });

  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'test-secret-123')
    .set('x-subject-sub', 'user-abc');

  expect(res.status).toBe(503);
  expect(res.body.error).toBe('session_store_unavailable');
  // Should NOT throw — verify no unhandled rejection by the fact the test completes
});
