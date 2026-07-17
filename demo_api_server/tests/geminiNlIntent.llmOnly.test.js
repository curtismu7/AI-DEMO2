'use strict';

/**
 * Regression — LLM-only routing (ff_heuristic_enabled=false) must actually route
 * dashboard chip phrases through the LLM, not silently fall back to the heuristic
 * chip floor.
 *
 * Root cause it guards (REGRESSION_PLAN §4, 2026-07-17): the llama.cpp intent
 * grammar only required `{ kind: <string> }`. Under constrained decoding a small
 * model satisfied that with `{"kind":"banking"}` (no `banking.action`), which
 * validateIntent rejected — so the router "missed" and the heuristic answered,
 * labeled "Heuristic" even in LLM-only mode. buildIntentSchema now forces the
 * complete per-vertical shape so the model must emit the action.
 *
 * Test note: the shared setup.js runs jest.resetModules() in afterEach, so
 * geminiNlIntent's lazy `require('./llamacppLlmService')` would return a fresh
 * mock that no longer matches a top-level captured reference. loadFresh() re-
 * requires the module-under-test and its mock together (same registry
 * generation) and re-applies the configStore override each test.
 */

jest.mock('../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));

let mockHeuristicEnabled = 'false';

// Load the module-under-test + its mock in the current (post-reset) module
// generation so their identities align, and force LLM-only routing by
// overriding only ff_heuristic_enabled + agent_mode on the real configStore.
function loadFresh() {
  const configStore = require('../services/configStore');
  const realGetEffective = configStore.getEffective.bind(configStore);
  configStore.getEffective = (key) => {
    if (key === 'ff_heuristic_enabled') return mockHeuristicEnabled;
    if (key === 'agent_mode') return undefined; // no pinned mode → request provider drives routing
    return realGetEffective(key);
  };
  const { callLlamaCpp } = require('../services/llamacppLlmService');
  const nlIntentResultCache = require('../services/nlIntentResultCache');
  nlIntentResultCache.clear();
  const { parseNaturalLanguage, __test } = require('../services/geminiNlIntent');
  return { callLlamaCpp, parseNaturalLanguage, buildIntentSchema: __test.buildIntentSchema };
}

describe('buildIntentSchema — forces the complete per-vertical action shape', () => {
  const { buildIntentSchema } = loadFresh();

  test('banking vertical requires banking.action (not just kind)', () => {
    const schema = buildIntentSchema('banking');
    expect(Array.isArray(schema.anyOf)).toBe(true);
    const actionShape = schema.anyOf[0];
    expect(actionShape.properties.kind.const).toBe('banking');
    expect(actionShape.required).toEqual(expect.arrayContaining(['kind', 'banking']));
    expect(actionShape.properties.banking.required).toContain('action');
  });

  test('non-banking vertical requires vertical + action', () => {
    const schema = buildIntentSchema('healthcare');
    const actionShape = schema.anyOf[0];
    expect(actionShape.properties.kind.const).toBe('vertical');
    expect(actionShape.required).toEqual(expect.arrayContaining(['kind', 'vertical', 'action']));
  });

  test('kind:none stays allowed so open questions can fall through to conversational', () => {
    const schema = buildIntentSchema('banking');
    const kinds = schema.anyOf.map((s) => s.properties.kind.const);
    expect(kinds).toContain('none');
  });
});

describe('LLM-only routing (ff_heuristic_enabled=false)', () => {
  let parseNaturalLanguage;
  let callLlamaCpp;

  beforeEach(() => {
    mockHeuristicEnabled = 'false';
    ({ parseNaturalLanguage, callLlamaCpp } = loadFresh());
  });

  test('a chip phrase routes through llama.cpp, not the heuristic floor', async () => {
    callLlamaCpp.mockResolvedValue(
      JSON.stringify({ kind: 'banking', banking: { action: 'accounts', params: {} } }),
    );
    const out = await parseNaturalLanguage('show my accounts', { vertical: 'banking' }, 'llamacpp');
    expect(out.source).toBe('llamacpp');
    expect(out.result.kind).toBe('banking');
    expect(out.result.banking.action).toBe('accounts');
  });

  test('the intent call passes a schema that requires the action (guards the root cause)', async () => {
    callLlamaCpp.mockResolvedValue(
      JSON.stringify({ kind: 'banking', banking: { action: 'accounts', params: {} } }),
    );
    await parseNaturalLanguage('show my accounts', { vertical: 'banking' }, 'llamacpp');
    expect(callLlamaCpp).toHaveBeenCalled();
    const opts = callLlamaCpp.mock.calls[0][1];
    expect(opts.jsonSchema.anyOf[0].properties.banking.required).toContain('action');
  });
});
