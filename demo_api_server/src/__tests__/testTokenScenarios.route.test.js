// Route tests for routes/testTokenScenarios.js — the HTTP layer (router), mounted
// at /api/test/token-validation, that the UI TokenSecurityTester panel calls.
//
// The sibling testTokenScenarios.test.js covers the underlying testTokenGenerator
// helpers directly; it never mounts the router. This file mounts the real router
// in a minimal app and exercises the endpoints: the prod-guard middleware, the
// POST /scenario/:id dispatcher + all five scenario handlers, the unknown-scenario
// 400, and GET /scenarios. The route has no external service deps (pure JWT gen).

const express = require('express');
const request = require('supertest');

function buildApp() {
  const app = express();
  app.use('/api/test/token-validation', require('../../routes/testTokenScenarios'));
  return app;
}

describe('routes/testTokenScenarios', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  const ORIGINAL_FF = process.env.FF_TEST_TOKEN_SCENARIOS;

  beforeEach(() => {
    // The route's prod guard is `NODE_ENV === 'production'`. Keep VERCEL unset
    // so a stray ambient value can't interfere (the route no longer reads it).
    delete process.env.VERCEL;
  });

  afterEach(() => {
    // Restore env so the prod-guard tests don't leak into the rest of the suite.
    process.env.NODE_ENV = ORIGINAL_ENV;
    if (ORIGINAL_FF === undefined) delete process.env.FF_TEST_TOKEN_SCENARIOS;
    else process.env.FF_TEST_TOKEN_SCENARIOS = ORIGINAL_FF;
  });

  describe('production guard middleware', () => {
    it('returns 403 test_routes_disabled in production without the feature flag', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FF_TEST_TOKEN_SCENARIOS;
      const res = await request(buildApp()).get('/api/test/token-validation/scenarios');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('test_routes_disabled');
    });

    it('passes through in production when FF_TEST_TOKEN_SCENARIOS=true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.FF_TEST_TOKEN_SCENARIOS = 'true';
      const res = await request(buildApp()).get('/api/test/token-validation/scenarios');
      expect(res.status).toBe(200);
    });

    it('passes through in non-production regardless of the flag', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.FF_TEST_TOKEN_SCENARIOS;
      const res = await request(buildApp()).get('/api/test/token-validation/scenarios');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /scenario/:scenarioId', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test'; // ensure the guard lets requests through
    });

    const cases = [
      { id: 'wrong-scope', scenario: 'wrong_scope', error_code: 'SCOPE_MISMATCH' },
      { id: 'wrong-aud', scenario: 'wrong_aud', error_code: 'AUD_MISMATCH' },
      { id: 'missing-act', scenario: 'missing_act', error_code: 'DELEGATION_030' },
      { id: 'agent-token-user-endpoint', scenario: 'agent_token_user_endpoint', error_code: 'SCOPE_MISMATCH' },
      { id: 'expired-token', scenario: 'expired_token', error_code: 'TOKEN_EXPIRED' },
    ];

    cases.forEach(({ id, scenario, error_code }) => {
      it(`runs the '${id}' scenario and returns its teaching payload`, async () => {
        const res = await request(buildApp()).post(`/api/test/token-validation/scenario/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.scenario).toBe(scenario);
        expect(res.body.error_code).toBe(error_code);
        expect(res.body.teaching_message).toEqual(expect.any(String));
        expect(res.body.token_details).toBeDefined();
      });
    });

    it('returns 400 unknown_scenario for an unrecognized id', async () => {
      const res = await request(buildApp()).post('/api/test/token-validation/scenario/does-not-exist');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unknown_scenario');
    });
  });

  describe('GET /scenarios', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('lists all five scenarios', async () => {
      const res = await request(buildApp()).get('/api/test/token-validation/scenarios');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.scenarios)).toBe(true);
      const ids = res.body.scenarios.map((s) => s.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'wrong-scope',
          'wrong-aud',
          'missing-act',
          'agent-token-user-endpoint',
          'expired-token',
        ])
      );
    });
  });
});
