// banking_api_server/tests/routes/allChips.pipeline.integration.test.js
'use strict';
/**
 * CI integration suite — deterministic conditions only:
 *   (1) Heuristics-only routing for every built-in chip
 *   (2) No-user-token hard-fail on the pipeline (401, zero pipeline trail)
 *
 * Real Helix is NOT exercised here (non-deterministic / network) — that lives
 * in banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js.
 *
 * Models banking_api_server/tests/routes/hitlGateway.integration.test.js:
 * real configStore, mocked deep services, supertest.
 */
const express = require('express');
const request = require('supertest');

jest.setTimeout(20000);

// Force Heuristics-only: ff_heuristic_enabled defaults true; ensure no LLM is
// reachable by stubbing the Helix callers so a routing miss can never
// silently hit the network in CI.
jest.mock('../../services/helixLlmService', () => ({
  callHelixAgent: jest.fn(() => Promise.reject(new Error('helix disabled in CI'))),
  answerWithHelix: jest.fn(() => Promise.reject(new Error('helix disabled in CI'))),
}));

const { heuristicChips, allChips } = require('../../scripts/extractChips');
const { parseHeuristic } = require('../../services/nlIntentParser');

function buildNlApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { id: 'ci-' + Math.random().toString(36).slice(2, 8), save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/demo-agent', require('../../routes/demoAgentNl'));
  return app;
}

describe('all-chips — Heuristics-only routing (CI, deterministic)', () => {
  const app = buildNlApp();

  test.each(allChips.map((c) => [c.id, c.message]))(
    'chip %s routes via heuristic and never errors',
    async (_id, message) => {
      const res = await request(app)
        .post('/api/demo-agent/nl')
        .send({ message, provider: 'auto' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('source');
      expect(res.body).toHaveProperty('result');
      // Heuristic ALWAYS wins in this config (no LLM reachable).
      expect(res.body.source).toBe('heuristic');

      // Expectation derived from the real parser, not hardcoded.
      const expected = parseHeuristic(message);
      expect(res.body.result.kind).toBe(expected.kind);
      if (expected.kind === 'banking') {
        expect(res.body.result.banking.action).toBe(expected.banking.action);
      }
    },
  );

  test('every built-in HEURISTIC chip resolves to a banking action (not a hint)', () => {
    for (const c of heuristicChips) {
      const r = parseHeuristic(c.message);
      expect(r.kind).toBe('banking');
      expect(typeof r.banking.action).toBe('string');
    }
  });
});

// --- appended to allChips.pipeline.integration.test.js ---

describe('pipeline hard-fail — no user token (CI, deterministic)', () => {
  function buildMcpAppNoSession() {
    // Mount ONLY requireSession + a sentinel handler that must never run.
    const { requireSession } = require('../../middleware/auth');
    const app = express();
    app.use(express.json());
    // No session.user is ever set.
    let pipelineEntered = false;
    app.post('/api/mcp/tool', express.json(), requireSession, (req, res) => {
      pipelineEntered = true;
      res.json({ result: 'SHOULD_NOT_REACH' });
    });
    app.get('/__entered', (req, res) => res.json({ pipelineEntered }));
    return app;
  }

  test('POST /api/mcp/tool with no session → 401 unauthenticated, pipeline never entered', async () => {
    const app = buildMcpAppNoSession();
    const res = await request(app)
      .post('/api/mcp/tool')
      .send({ tool: 'get_my_accounts', params: {} });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
    expect(res.body.message).toBe('A valid session is required. Please sign in.');

    const probe = await request(app).get('/__entered');
    expect(probe.body.pipelineEntered).toBe(false);
  });
});
