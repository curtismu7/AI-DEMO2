// geminiNlIntent.pingoneAdmin.test.js
//
// The pingone-admin vertical shipped with 8 heuristic rules pinning exact
// hosted-MCP tool names (config/verticals/pingone-admin/index.js), but
// parseNaturalLanguage refused to use ANY of them unless the resolved LLM
// provider was Helix — provider:"pingone-admin" short-circuited to a
// "PingOne Admin tools require Helix to be configured" kind:'none'.
// A full heuristics path existed that production could never reach.
//
// These tests use the REAL nlIntentParser and the REAL pingone-admin plugin
// (no stub heuristics) so they prove the shipped rules resolve. The LLM
// services are mocked only to guarantee no network is reachable — with the
// guards gone the heuristic short-circuits before any LLM call.

'use strict';

const _cfg = {};
jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn((key) => (key in _cfg ? _cfg[key] : null)),
}));

// No LLM may be reached: any call here is itself the failure.
jest.mock('../services/helixLlmService', () => ({
  callHelixAgent: jest.fn(async () => { throw new Error('LLM must not be called'); }),
}));
jest.mock('../services/llamacppLlmService', () => ({
  callLlamaCpp: jest.fn(async () => { throw new Error('LLM must not be called'); }),
}));
jest.mock('axios', () => ({
  post: jest.fn(async () => { throw new Error('no network in tests'); }),
  get: jest.fn(async () => { throw new Error('no network in tests'); }),
}));

const { parseNaturalLanguage } = require('../services/geminiNlIntent');
const { callHelixAgent } = require('../services/helixLlmService');
const chips = require('../config/verticals/pingone-admin/manifest.json').dashboard.chips10;

// Each chip's message and the hosted MCP tool its heuristic pins.
// pa1 ("List Tools") routes to the cross-vertical mcp_tools action, which the
// SPA dispatches client-side — it has no pinned hosted-tool name.
const EXPECTED = {
  pa2: 'listUsers',
  pa3: 'listApplications',
  pa4: 'listPopulations',
  pa5: 'getEnvironment',
};

// A deliberately non-Helix provider — this is what tripped the old guard.
const NON_HELIX_CONFIG = { provider: 'llamacpp' };

function resetCfg(next = {}) {
  for (const k of Object.keys(_cfg)) delete _cfg[k];
  Object.assign(_cfg, next);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCfg();
});

describe('parseNaturalLanguage — pingone-admin resolves through heuristics without Helix', () => {
  test('the manifest still ships exactly the 5 chips these assertions cover', () => {
    expect(chips.map((c) => c.id)).toEqual(['pa1', 'pa2', 'pa3', 'pa4', 'pa5']);
  });

  test.each(chips.map((c) => [c.id, c.message]))(
    '%s resolves to a heuristic action (not the Helix-required refusal)',
    async (id, message) => {
      const out = await parseNaturalLanguage(
        message,
        { vertical: 'pingone-admin' },
        'pingone-admin',
        NON_HELIX_CONFIG,
      );

      expect(out.source).toBe('heuristic');
      expect(out.result.kind).not.toBe('none');
      expect(out.result.message).toBeUndefined();
      if (EXPECTED[id]) {
        expect(out.result).toMatchObject({
          kind: 'vertical',
          vertical: 'pingone-admin',
          action: 'call_pingone_tool',
          params: { name: EXPECTED[id] },
        });
      } else {
        // pa1 — discovery. Resolves to an action, not to a refusal.
        expect(typeof (out.result.action || out.result.banking?.action)).toBe('string');
      }
      expect(callHelixAgent).not.toHaveBeenCalled();
    },
  );

  test('no chip returns the removed "requires Helix" refusal', async () => {
    for (const chip of chips) {
      const out = await parseNaturalLanguage(
        chip.message,
        { vertical: 'pingone-admin' },
        'pingone-admin',
        NON_HELIX_CONFIG,
      );
      expect(JSON.stringify(out)).not.toContain('require Helix');
      expect(out.llm_not_configured).toBeUndefined();
    }
  });

  test('free text still falls through to the configured LLM, not to a Helix demand', async () => {
    // No heuristic matches this; provider:"pingone-admin" must resolve to the
    // configured provider (llamacpp here) rather than being pinned to Helix.
    const out = await parseNaturalLanguage(
      'zxq unmatched free text',
      { vertical: 'pingone-admin' },
      'pingone-admin',
      NON_HELIX_CONFIG,
    );
    expect(JSON.stringify(out)).not.toContain('require Helix');
    expect(callHelixAgent).not.toHaveBeenCalled();
  });
});
