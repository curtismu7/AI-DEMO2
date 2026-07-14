// demo_api_server/tests/agentRunHeuristicsProvider.test.js
'use strict';

// Regression: "Heuristics only" must call NO LLM.
//
// routes/agentRun.js never read agent_mode. Its provider chain ended in a
// hard-coded 'anthropic', so any run that arrived without an explicit provider
// — heuristics selected, a stale session provider, or the HITL resume/cancel
// runs which send none — silently called Anthropic. On the SE deploy that
// surfaced as `401 invalid x-api-key` while the picker said "Heuristics only".
//
// The agent service understands provider='none' as "no LLM, heuristic routing"
// (langchain_agent/src/agent/llm_factory.py), so heuristics must pin that.

const { resolveAgentMode } = require('../services/agentModeResolver');

/** The provider resolution from routes/agentRun.js, extracted verbatim in shape. */
function resolveProvider({ bodyProvider, sessionProvider, bodyMode, configMode, configProvider, envProvider }) {
  const requestedMode = (typeof bodyMode === 'string' && bodyMode.trim())
    ? bodyMode.trim()
    : configMode;
  const resolvedMode = resolveAgentMode(requestedMode);
  const isHeuristics = resolvedMode && resolvedMode.provider === null;

  return isHeuristics
    ? 'none'
    : (bodyProvider
      || (resolvedMode && resolvedMode.provider)
      || sessionProvider
      || configProvider
      || envProvider
      || 'anthropic');
}

describe('agentRun provider resolution — heuristics never reaches an LLM', () => {
  test('heuristics from the request body pins provider=none', () => {
    expect(resolveProvider({ bodyMode: 'heuristics' })).toBe('none');
  });

  test('heuristics wins even when a stale session provider says anthropic', () => {
    // The exact live failure: user switched to Heuristics, session still held
    // anthropic from the previous mode, run 401'd on invalid x-api-key.
    expect(resolveProvider({
      bodyMode: 'heuristics',
      sessionProvider: 'anthropic',
      configProvider: 'anthropic',
    })).toBe('none');
  });

  test('heuristics from server config wins when the body omits the mode (HITL resume path)', () => {
    // HITL resume/cancel runs send neither mode nor provider.
    expect(resolveProvider({
      configMode: 'heuristics',
      sessionProvider: 'anthropic',
    })).toBe('none');
  });

  test('an LLM mode still resolves to its provider (no regression)', () => {
    expect(resolveProvider({ bodyMode: 'claude' })).toBe('anthropic');
    expect(resolveProvider({ bodyMode: 'llamacpp' })).toBe('llamacpp');
    expect(resolveProvider({ bodyMode: 'gemini' })).toBe('google');
  });

  test('explicit body provider still wins for non-heuristic modes', () => {
    expect(resolveProvider({
      bodyMode: 'claude',
      bodyProvider: 'groq',
    })).toBe('groq');
  });

  test('resolveAgentMode maps heuristics to a null provider (the contract this relies on)', () => {
    expect(resolveAgentMode('heuristics').provider).toBeNull();
  });
});
