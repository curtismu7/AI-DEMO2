/**
 * The acceptance test the 2026-08-10 final review called for: write via
 * the kill route with the SAME identity a real gate check would use to
 * read it back, and confirm they resolve to the identical key. Mocks
 * nothing except the session store's persistence layer and the
 * authenticateToken gate — deriveAgentKey and killSwitchService run for
 * real. authenticateToken is bypassed (same as its sibling route tests,
 * adminKillSwitchRoute.derivedKey.test.js / adminActiveRuns.test.js)
 * because with no Authorization header or session.oauthTokens it 401s
 * before the handler ever runs, which is orthogonal to what this test
 * proves (write-key === read-key) and would make the assertion below
 * fail for the wrong reason — confirmed by running this test unmodified.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../middleware/sessionConfig', () => {
  const store = new Map();
  return {
    store: {
      get(key, cb) { cb(null, store.get(key) || null); },
      set(key, value, cb) { store.set(key, value); cb(null); },
    },
  };
});

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  requireScopes: () => (req, res, next) => next(),
  authenticateToken: (req, res, next) => next(),
}));

const { deriveAgentKey } = require('../services/sessionKeyService');
const killSwitchService = require('../services/killSwitchService');
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.sessionID = 'sess-fixed';
    req.session = { user: { oauthId: 'pingone-user-999' }, destroy: (cb) => cb() };
    next();
  });
  app.use('/api/admin', adminRouter);
  return app;
}

describe('kill-switch write key === gate read key, for a real UI call', () => {
  test('POST kill-switch with the "default-agent" UI placeholder, then isAgentRevoked reads it back under the same key a real gate check would derive', async () => {
    await request(buildApp())
      .post('/api/admin/agent/default-agent/kill-switch')
      .send({ reason: 'test', scope: 'instance' });

    // What a real gate check would derive for the SAME user, on a later
    // request with no explicit id (mirrors mcpToolPipeline.js's new call).
    const readSideKey = deriveAgentKey({ sessionID: 'sess-2-after-relogin' }, null, 'pingone-user-999');

    const revoked = await killSwitchService.isAgentRevoked(readSideKey);
    expect(revoked).toBe(true);
  });
});
