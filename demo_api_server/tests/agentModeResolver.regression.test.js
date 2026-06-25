// banking_api_server/tests/agentModeResolver.regression.test.js
const { resolveAgentMode, AGENT_MODES, DEFAULT_MODE } = require('../services/agentModeResolver');

describe('resolveAgentMode (four single-brain modes)', () => {
  test('heuristics: no provider, heuristic routing on, no external wiring', () => {
    expect(resolveAgentMode('heuristics')).toEqual({
      mode: 'heuristics', provider: null, heuristicRouting: true, externalWiring: null,
    });
  });
  test('ollama: ollama provider, routing off (pure LLM), defaults to bff wiring', () => {
    expect(resolveAgentMode('ollama')).toEqual({
      mode: 'ollama', provider: 'ollama', heuristicRouting: false, externalWiring: 'bff',
    });
  });
  test('claude: anthropic provider, routing off, platform wiring honored', () => {
    expect(resolveAgentMode('claude', 'platform')).toEqual({
      mode: 'claude', provider: 'anthropic', heuristicRouting: false, externalWiring: 'platform',
    });
  });
  test('helix_google: helix provider, routing off, defaults to bff wiring', () => {
    expect(resolveAgentMode('helix_google')).toEqual({
      mode: 'helix_google', provider: 'helix', heuristicRouting: false, externalWiring: 'bff',
    });
  });

  test('AGENT_MODES lists exactly the four single-brain modes', () => {
    expect(AGENT_MODES.map((m) => m.id)).toEqual([
      'heuristics', 'ollama', 'claude', 'helix_google',
    ]);
  });

  test('no surviving mode is a hybrid (heuristicRouting implies no provider)', () => {
    // The retired "Heuristics + X" combos were the source of fallback-chain
    // instability. Guard that no mode both routes heuristically AND has an LLM.
    AGENT_MODES.forEach((m) => {
      if (m.heuristicRouting) expect(m.provider).toBeNull();
    });
  });

  test('retired modes resolve to the default (heuristics) rather than throwing', () => {
    ['heuristics_helix', 'heuristics_ollama', 'lmstudio', 'chatgpt', 'bogus']
      .forEach((id) => { expect(resolveAgentMode(id).mode).toBe('heuristics'); });
  });

  test('null/undefined/empty modeId falls back to the default', () => {
    expect(resolveAgentMode(null).mode).toBe('heuristics');
    expect(resolveAgentMode(undefined).mode).toBe('heuristics');
    expect(resolveAgentMode('').mode).toBe('heuristics');
  });

  test('externalWiring is case-sensitive — "PLATFORM" is treated as bff', () => {
    expect(resolveAgentMode('claude', 'PLATFORM').externalWiring).toBe('bff');
  });

  test('DEFAULT_MODE export is heuristics', () => {
    expect(DEFAULT_MODE).toBe('heuristics');
  });
});
