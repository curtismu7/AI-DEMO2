'use strict';
/**
 * Integration tests for GET /internal/id-token
 *
 * Tests 8-9 per plan spec.
 * Per CLAUDE.md "Test patterns: Regression vs. Integration":
 *   - configStore is NOT mocked (no configStore calls in this route — kept for symmetry)
 *   - process.env.BFF_INTERNAL_SECRET is set BEFORE require() so the route's module-level
 *     constant captures it at load time
 *   - Only the data dependency (sessionStore) is stubbed
 */

// Set the real env var BEFORE requiring the route — this is what the integration
// test proves: that the module reads from process.env (not a mock) at module load.
process.env.BFF_INTERNAL_SECRET = 'integration-secret';

const express = require('express');
const request = require('supertest');

// Require the route AFTER setting the env var so the module-level INTERNAL_SECRET
// captures the integration value. In the regression test a different value was set;
// Jest isolates modules per test file so there is no cross-contamination.
const agentIdToken = require('../../routes/agentIdToken');

function buildIntegrationApp(stubStore) {
  const app = express();
  app.use(express.json());
  app.set('sessionStore', stubStore);
  app.use('/internal', agentIdToken);
  return app;
}

const stubStore = {
  all: jest.fn((cb) => cb(null, [])), // always returns empty sessions
};

// =============================================================================
// Test 8: No secret header → 403 (real env-var read, no mock)
// =============================================================================
test('Test 8 (integration): Missing secret returns 403 — proves real env-var read', async () => {
  const app = buildIntegrationApp(stubStore);
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-subject-sub', 'any-sub');
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('forbidden');
});

// =============================================================================
// Test 9: Correct secret (integration-secret) + no matching session → 404
// =============================================================================
test('Test 9 (integration): Correct secret + no session returns 404 — proves env var was read at module load', async () => {
  const app = buildIntegrationApp(stubStore);
  const res = await request(app)
    .get('/internal/id-token')
    .set('x-internal-gateway-secret', 'integration-secret')
    .set('x-subject-sub', 'nobody');
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('session_not_found');
});
