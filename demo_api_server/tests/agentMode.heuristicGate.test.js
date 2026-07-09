// banking_api_server/tests/agentMode.heuristicGate.test.js
const { resolveAgentMode } = require('../services/agentModeResolver');
const parser = require('../services/nlIntentParser');

describe('agent mode → heuristic routing gate', () => {
  test('heuristics is the only mode that routes via heuristic', () => {
    expect(resolveAgentMode('heuristics').heuristicRouting).toBe(true);
  });
  test('the LLM modes do NOT route via heuristic (pure single-brain)', () => {
    ['llamacpp', 'mlx', 'claude', 'gemini', 'helix_google'].forEach((m) => {
      expect(resolveAgentMode(m).heuristicRouting).toBe(false);
    });
  });
  test('Mode-1 no-match catalog message is the buildCatalogMessage output', () => {
    expect(typeof parser.buildCatalogMessage()).toBe('string');
    expect(parser.buildCatalogMessage()).toMatch(/can help/i);
  });
});
