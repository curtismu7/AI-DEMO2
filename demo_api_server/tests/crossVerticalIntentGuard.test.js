/**
 * Cross-vertical intent mismatch guard — routes/agentInvokeRoute.js
 *
 * "extend my rental $300" mints intent=extend_rental in ANY vertical (the
 * pre-execution regexes are vertical-blind), but the heuristic dispatch runs
 * against the ACTIVE vertical only. In a vertical that has no such action the
 * prompt falls through to the LLM, whose tool list lacks the intent's tool —
 * so the model answers as chat and the demo silently does nothing
 * (observed live 2026-09-22). The guard detects that shape and replies with a
 * switch-vertical guidance card instead.
 */
const request = require('supertest');

// Hoist-safe mocks: the route pulls a large dependency graph.
jest.mock('../services/agentFrameworkOrchestrator', () => ({ selectFramework: jest.fn() }));
jest.mock('../services/mcpFlowSseHub', () => ({
  ensurePostTrace: jest.fn(() => 'none'),
  publish: jest.fn(),
}));

describe('cross-vertical intent mismatch guard (agent/invoke)', () => {
  let app;
  let configStore;

  beforeAll(() => {
    // The heuristic floor must be ON so banking's parseHeuristic misses and the
    // LLM fallback runs — the exact shape the guard detects.
    process.env.CI = 'true';
  });

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    const configStore = require('../services/configStore');
    configStore.setRaw({ ff_heuristic_enabled: 'true' });
    // eslint-disable-next-line global-require
    ({ app } = require('../server'));
  });

  test('extend_rental prompt in banking vertical returns a switch-vertical hint, not LLM chat', async () => {
    const res = await request(app)
      .post('/api/agent/invoke')
      .send({ prompt: 'extend my rental $300', vertical: 'banking' });

    expect(res.status).toBe(200);
    expect(res.body.crossVerticalHint).toEqual({
      intent: 'extend_rental',
      activeVertical: 'banking',
      ownerVertical: 'sporting-goods',
    });
    expect(res.body.toolsCalled).toEqual([]);
    expect(res.body.reply).toMatch(/sporting goods/i);
    expect(res.body.reply).toMatch(/vertical/i);
  });

  test('the same prompt in its owning vertical is NOT intercepted', async () => {
    const res = await request(app)
      .post('/api/agent/invoke')
      .send({ prompt: 'extend my rental $300', vertical: 'sporting-goods' });

    expect(res.status).toBe(200);
    expect(res.body.crossVerticalHint).toBeUndefined();
  });

  test('an unknown-intent prompt is NOT intercepted', async () => {
    const res = await request(app)
      .post('/api/agent/invoke')
      .send({ prompt: 'tell me a joke please', vertical: 'banking' });

    expect(res.status).toBe(200);
    expect(res.body.crossVerticalHint).toBeUndefined();
  });
});
