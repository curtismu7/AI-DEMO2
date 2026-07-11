// banking_api_server/tests/agentModeResolver.regression.test.js
const { resolveAgentMode, AGENT_MODES, DEFAULT_MODE } = require('../services/agentModeResolver');

describe('resolveAgentMode (five single-brain modes)', () => {
  test('heuristics: no provider, heuristic routing on, no external wiring', () => {
    expect(resolveAgentMode('heuristics')).toEqual({
      mode: 'heuristics', provider: null, heuristicRouting: true, externalWiring: null,
    });
  });
  test('llamacpp: llamacpp provider, routing off (pure LLM), defaults to bff wiring', () => {
    expect(resolveAgentMode('llamacpp')).toEqual({
      mode: 'llamacpp', provider: 'llamacpp', heuristicRouting: false, externalWiring: 'bff',
    });
  });
  test('claude: anthropic provider, routing off, platform wiring honored', () => {
    expect(resolveAgentMode('claude', 'platform')).toEqual({
      mode: 'claude', provider: 'anthropic', heuristicRouting: false, externalWiring: 'platform',
    });
  });
  test('gemini: google provider, routing off, defaults to bff wiring', () => {
    expect(resolveAgentMode('gemini')).toEqual({
      mode: 'gemini', provider: 'google', heuristicRouting: false, externalWiring: 'bff',
    });
  });

  test('helix_google: helix provider, routing off, defaults to bff wiring', () => {
    expect(resolveAgentMode('helix_google')).toEqual({
      mode: 'helix_google', provider: 'helix', heuristicRouting: false, externalWiring: 'bff',
    });
  });

  test('google: google provider, routing off, defaults to bff wiring', () => {
    expect(resolveAgentMode('google')).toEqual({
      mode: 'google', provider: 'google', heuristicRouting: false, externalWiring: 'bff',
    });
  });

  test('mlx: mlx provider, routing off (pure LLM), defaults to bff wiring', () => {
    expect(resolveAgentMode('mlx')).toEqual({
      mode: 'mlx', provider: 'mlx', heuristicRouting: false, externalWiring: 'bff',
    });
  });

  test('AGENT_MODES lists exactly the six single-brain modes', () => {
    expect(AGENT_MODES.map((m) => m.id)).toEqual([
      'heuristics', 'llamacpp', 'mlx', 'claude', 'gemini', 'helix_google', 'google',
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
