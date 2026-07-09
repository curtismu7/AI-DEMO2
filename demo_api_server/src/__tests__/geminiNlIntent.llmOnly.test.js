'use strict';

/**
 * geminiNlIntent.llmOnly.test.js
 *
 * Tests for the LLM-only path added in the conversational-Helix update:
 *   1. When ff_heuristic_enabled=false, Helix JSON router kind:'none' falls
 *      through to answerWithHelix instead of short-circuiting.
 *   2. answerWithHelix result is returned as source:'helix_fallback' with
 *      kind:'education' panel:'general-knowledge'.
 *   3. In normal (heuristic) mode, kind:'none' from Helix router still falls
 *      through to answerWithHelix.
 */

jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(),
  EDU: {},
  resolveVerticalRouting: jest.fn(() => ({ verticalId: 'banking', verticalCtx: null })),
}));

jest.mock('../../services/nlIntentSanitize', () => ({
  sanitizeNlResult: jest.fn((r) => ({ result: r, rejected: false, reason: '' })),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

// callHelixAgent is used by both the JSON router path and answerWithHelix.
// We control its return value per test.
const { callHelixAgent } = jest.requireMock('../../services/helixLlmService');
jest.mock('../../services/helixLlmService', () => ({
  callHelixAgent: jest.fn(),
}));

// Block real HTTP in tests
global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));

const { parseHeuristic } = require('../../services/nlIntentParser');
const configStore = require('../../services/configStore');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

// Helix needs at least base_url + api_key to be considered configured
const HELIX_CONFIG = {
  helix_base_url: 'https://helix.example.com',
  helix_api_key: 'test-key',
  helix_environment_id: 'env-1',
  helix_agent_id: 'agent-1',
  helix_prompt_field_id: 'field-1',
};

// Code-under-test now reads helix_* via getEffective so committed FIELD_DEFS
// defaults reach fresh clones. Mocks reflect that: getEffective serves both
// the ff_heuristic_enabled flag AND the helix_* keys; get() is kept in sync
// for any caller still using it.
function setLlmOnlyMode() {
  configStore.getEffective.mockImplementation((key) => {
    if (key === 'ff_heuristic_enabled') return 'false';
    return HELIX_CONFIG[key] || null;
  });
  configStore.get.mockImplementation((key) => HELIX_CONFIG[key] || null);
}

function setHeuristicMode() {
  configStore.getEffective.mockImplementation((key) => HELIX_CONFIG[key] || null);
  configStore.get.mockImplementation((key) => HELIX_CONFIG[key] || null);
}

beforeEach(() => {
  jest.clearAllMocks();
  callHelixAgent.mockReset();
});

describe('geminiNlIntent — LLM-only mode (ff_heuristic_enabled=false)', () => {
  it('calls parseHeuristic as a safety net even in LLM-only mode', async () => {
    // Contract (revised 2026-05-11): heuristic ALWAYS runs so its result is
    // available as a fallback when the LLM produces nothing. LLM-only mode
    // means "prefer LLM", not "disable heuristic".
    setLlmOnlyMode();
    parseHeuristic.mockReturnValue({ kind: 'none', message: '' });
    callHelixAgent
      .mockResolvedValueOnce('{"kind":"none","message":"I don\'t know"}')
      .mockResolvedValueOnce(null);

    await parseNaturalLanguage('what is my biggest purchase', {}, 'auto', {});

    expect(parseHeuristic).toHaveBeenCalledTimes(1);
  });

  // RESOLVED (supersedes the prior "Helix answer discarded" known-issue):
  // Root cause was a stale TEST, not a product defect. The LLM-only path
  // calls callHelixAgent THREE times — (1) JSON router, (2) retry-on-refusal
  // nudge added in commit 68c1396f, (3) conversational answerWithHelix. These
  // tests predated 68c1396f and mocked only 2 returns, so the 3rd call
  // (answerWithHelix's) got undefined → answerWithHelix returned null →
  // source fell back to 'heuristic'. The product code's helix_fallback path
  // (documented in geminiNlIntent.js:235) is correct. Fix = mock all 3 calls.
  it('falls through to answerWithHelix when JSON router returns kind:none', async () => {
    setLlmOnlyMode();
    // No heuristic match — open question should get conversational Helix.
    parseHeuristic.mockReturnValue({ kind: 'none', message: '' });
    callHelixAgent
      .mockResolvedValueOnce('{"kind":"none","message":"I cannot route this"}') // 1: router → kind:none
      .mockResolvedValueOnce('still not json') // 2: refusal-retry → non-JSON, falls through
      .mockResolvedValueOnce('Here is my conversational answer'); // 3: answerWithHelix

    const r = await parseNaturalLanguage('what is my biggest purchase', {}, 'auto', {});

    expect(r.source).toBe('helix_fallback');
    expect(r.result.kind).toBe('education');
    expect(r.result.education.panel).toBe('general-knowledge');
    expect(r.result.message).toBe('Here is my conversational answer');
  });


  it('prefers heuristic when LLM JSON action disagrees with chip match', async () => {
    setLlmOnlyMode();
    parseHeuristic.mockReturnValue({
      kind: 'vertical',
      vertical: 'workforce',
      action: 'list_expenses',
      params: {},
    });
    callHelixAgent.mockReset();
    callHelixAgent.mockResolvedValueOnce(
      '{"kind":"banking","banking":{"action":"unusual_patterns","params":{}}}',
    );

    const r = await parseNaturalLanguage(
      'Check for unusual patterns in my recent activity',
      { role: 'customer', vertical: 'workforce' },
      'helix',
      {},
    );

    expect(r.source).toBe('heuristic');
    expect(r.result.action).toBe('list_expenses');
    expect(r.llm_attempted).toBe(true);
  });

  it('prefers heuristic chip match over conversational when JSON router misses', async () => {
    // Write-chip phrases (checkout, release records, …) often omit optional
    // params; if Helix still returns kind:none after the JSON retry, use the
    // deterministic heuristic action instead of a general-knowledge paragraph.
    setLlmOnlyMode();
    parseHeuristic.mockReturnValue({
      kind: 'vertical',
      vertical: 'retail',
      action: 'checkout',
      params: {},
    });
    callHelixAgent
      .mockResolvedValueOnce('{"kind":"none","message":"need product and amount"}')
      .mockResolvedValueOnce('{"kind":"none","message":"still need params"}');

    const r = await parseNaturalLanguage('checkout', { vertical: 'retail' }, 'helix', {});

    expect(r.source).toBe('heuristic');
    expect(r.result.action).toBe('checkout');
    expect(r.llm_attempted).toBe(true);
    // Conversational answerWithHelix must NOT run when heuristic matched.
    expect(callHelixAgent).toHaveBeenCalledTimes(2);
  });

  it('falls through to answerWithHelix when JSON router parse fails', async () => {
    setLlmOnlyMode();
    parseHeuristic.mockReturnValue({ kind: 'none', message: '' });
    // 3 calls: router (non-JSON) → refusal-retry (non-JSON) → answerWithHelix.
    callHelixAgent
      .mockResolvedValueOnce('not valid json') // 1: router — parse fails
      .mockResolvedValueOnce('still not json') // 2: refusal-retry — parse fails
      .mockResolvedValueOnce('Fallback answer'); // 3: answerWithHelix

    const r = await parseNaturalLanguage('something unclear', {}, 'auto', {});

    expect(r.source).toBe('helix_fallback');
    expect(r.result.message).toBe('Fallback answer');
  });

  it('returns heuristic kind:none result when answerWithHelix also returns null', async () => {
    setLlmOnlyMode();
    parseHeuristic.mockReturnValue({ kind: 'none', message: '' });
    callHelixAgent.mockResolvedValue(null); // both calls return null

    const r = await parseNaturalLanguage('something unclear', {}, 'auto', {});

    expect(r.source).toBe('heuristic');
    expect(r.result.kind).toBe('none');
  });

  it('falls back to heuristic match when LLM-only mode is on but no LLM is configured', async () => {
    // Critical safety-net test: user has "LLM only" UI toggle on, but Helix is
    // not configured. A chip click like "accounts" must STILL work via heuristic.
    setLlmOnlyMode();
    // Override BOTH get and getEffective so Helix appears unconfigured.
    // (Code reads helix_* via getEffective; the ff_heuristic_enabled flag still
    // needs to return 'false' for LLM-only mode.)
    configStore.get.mockImplementation(() => null);
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_heuristic_enabled' ? 'false' : null,
    );
    parseHeuristic.mockReturnValue({
      kind: 'banking',
      banking: { action: 'accounts', params: {} },
    });
    callHelixAgent.mockResolvedValue(null);

    const r = await parseNaturalLanguage('accounts', {}, 'auto', {});

    expect(r.source).toBe('heuristic');
    expect(r.result.kind).toBe('banking');
    expect(r.result.banking.action).toBe('accounts');
  });

  it('routes a recognised banking phrase through Helix JSON router', async () => {
    setLlmOnlyMode();
    callHelixAgent.mockResolvedValueOnce(
      '{"kind":"banking","banking":{"action":"accounts","params":{}}}',
    );

    const r = await parseNaturalLanguage('show my accounts', {}, 'auto', {});

    expect(r.source).toBe('helix');
    expect(r.result.kind).toBe('banking');
    expect(r.result.banking.action).toBe('accounts');
    // answerWithHelix should NOT have been called (router matched)
    expect(callHelixAgent).toHaveBeenCalledTimes(1);
  });

});

describe('geminiNlIntent — heuristic mode kind:none fallthrough', () => {
  it('in normal mode, kind:none from helix router falls through to answerWithHelix', async () => {
    setHeuristicMode();
    parseHeuristic.mockReturnValue({ kind: 'none', message: '' });

    // 3 calls: router (kind:none) → refusal-retry (non-JSON) → answerWithHelix fallback.
    callHelixAgent.mockReset();
    callHelixAgent
      .mockResolvedValueOnce('{"kind":"none","message":"unknown"}') // 1: router → kind:none
      .mockResolvedValueOnce('still not json') // 2: refusal-retry — parse fails
      .mockResolvedValueOnce('General knowledge answer'); // 3: answerWithHelix fallback

    const r = await parseNaturalLanguage('random open question', {}, 'auto', {});

    expect(r.source).toBe('helix_fallback');
    expect(r.result.message).toBe('General knowledge answer');
  });

  it('in normal mode, heuristic match short-circuits before Helix', async () => {
    setHeuristicMode();
    parseHeuristic.mockReturnValue({
      kind: 'banking',
      banking: { action: 'transactions', params: {} },
    });

    const r = await parseNaturalLanguage('recent transactions', {}, 'auto', {});

    expect(r.source).toBe('heuristic');
    expect(r.result.banking.action).toBe('transactions');
    expect(callHelixAgent).not.toHaveBeenCalled();
  });
});
