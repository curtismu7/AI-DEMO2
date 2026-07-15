/**
 * @file geminiNlIntent.heuristic.test.js
 * Unit tests for the ff_heuristic_enabled feature flag in parseNaturalLanguage.
 *
 * Contract (revised 2026-05-11): the heuristic is a deterministic safety net and
 * ALWAYS runs — chip clicks and other well-known phrases must work even when
 * Helix is not configured. The ff_heuristic_enabled=false flag (set by the
 * "LLM only" UI toggle) changes *short-circuit* behavior: when false, a heuristic
 * match is NOT used to return early — the LLM path is preferred. The heuristic
 * result is still used as a fallback when the LLM produces nothing.
 *
 * Strategy: mock nlIntentParser, configStore, and the LLM path so we can assert
 * parseHeuristic call count and the chosen `source` without real HTTP requests.
 */

'use strict';

jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(),
  EDU: {},
  resolveVerticalRouting: jest.fn(() => ({ verticalId: 'banking', verticalCtx: null })),
}));

jest.mock('../../services/nlIntentSanitize', () => ({
  sanitizeNlResult: jest.fn((r) => r),
}));

jest.mock('../../services/helixLlmService', () => ({
  callHelixAgent: jest.fn().mockRejectedValue(new Error('helix not configured')),
}));

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

// Prevent accidental real HTTP — mock axios for safety
jest.mock('axios', () => ({
  post: jest.fn().mockRejectedValue(new Error('http not available in tests')),
}));

const { parseHeuristic } = require('../../services/nlIntentParser');
const configStore = require('../../services/configStore');
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: heuristic enabled (flag absent → treated as true)
  configStore.getEffective.mockReturnValue(null);
});

describe('parseNaturalLanguage — ff_heuristic_enabled flag', () => {
  it('calls parseHeuristic when ff_heuristic_enabled is absent (default on)', async () => {
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'accounts', params: {} } });
    configStore.getEffective.mockReturnValue(null); // absent → enabled

    const r = await parseNaturalLanguage('show my accounts', {}, 'auto', {});

    expect(parseHeuristic).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('heuristic');
  });

  it('calls parseHeuristic when ff_heuristic_enabled=true', async () => {
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'accounts', params: {} } });
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_heuristic_enabled' ? 'true' : null,
    );

    const r = await parseNaturalLanguage('show my accounts', {}, 'auto', {});

    expect(parseHeuristic).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('heuristic');
  });

  it('calls parseHeuristic even in LLM-only mode (ff_heuristic_enabled=false) — safety net always runs', async () => {
    // Even with the flag off, parseHeuristic is called so its result is available
    // as a fallback when the LLM produces nothing.
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'accounts', params: {} } });
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_heuristic_enabled' ? 'false' : null,
    );

    await parseNaturalLanguage('show my accounts', {}, 'auto', {});

    expect(parseHeuristic).toHaveBeenCalledTimes(1);
  });

  it('LLM-only mode does not short-circuit on heuristic match — LLM is preferred', async () => {
    // Heuristic recognises "Transfer $100" but flag prevents it from short-circuiting.
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'transfer', params: {} } });
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_heuristic_enabled' ? 'false' : null,
    );

    // Helix mocked to fail above; heuristic should be the fallback source.
    const r = await parseNaturalLanguage('Transfer $100', {}, 'auto', {});

    // parseHeuristic ran (safety net), but LLM was preferred. With LLM unavailable,
    // heuristic result is used as the final fallback.
    expect(parseHeuristic).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('heuristic');
  });

  it('Fallback ON + Google provider short-circuits known chips (no LLM)', async () => {
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'transactions', params: {} } });
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_heuristic_enabled' ? 'true' : null,
    );

    const r = await parseNaturalLanguage('recent transactions', {}, 'google', {});

    expect(parseHeuristic).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('heuristic');
  });

  it('LLM only + Google provider does not short-circuit before LLM attempt', async () => {
    parseHeuristic.mockReturnValue({ kind: 'banking', banking: { action: 'transactions', params: {} } });
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_heuristic_enabled') return 'false';
      if (key === 'google_api_key') return '';
      return null;
    });

    const r = await parseNaturalLanguage('recent transactions', {}, 'google', {});

    // No early short-circuit: LLM-only tries Gemini; missing key → heuristic safety net.
    expect(parseHeuristic).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('heuristic');
    expect(r.llm_not_configured).toBe(true);
  });
});
