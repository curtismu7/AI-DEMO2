/**
 * Perf regression gate for finding #73: resolveUseCase() must reuse the
 * a2aDelegated value already precomputed on `base` at module load
 * (USE_CASES map, config/useCases.js) instead of recomputing it via
 * isA2aDelegatedPrimaryTool() -> scopeTopology.isA2aDelegatedTool() ->
 * load() on every call. That helper does a sync fs.statSync of the
 * scope-topology manifest each time it's asked to (re)validate its memo, so
 * a naive implementation adds one blocking stat syscall per catalog entry
 * per resolveUseCase()/listUseCases() call — ~57 of them per GET
 * /api/use-cases in the common case (no perVertical override, or an
 * override that never touches primaryTool).
 *
 * Proof strategy: spy on scopeTopology.isA2aDelegatedTool (the function
 * useCases.js's isA2aDelegatedPrimaryTool() lazily requires and calls) and
 * assert resolving the whole 'banking' catalog — which never applies a
 * perVertical override (resolveUseCase's own early-out) — makes ZERO
 * additional calls to it after module load. Before the fix this made one
 * call per catalog entry (~57).
 */
'use strict';

jest.resetModules();

const scopeTopology = require('../services/scopeTopology');
const spy = jest.spyOn(scopeTopology, 'isA2aDelegatedTool');

// Fresh require so isA2aDelegatedPrimaryTool's lazy internal require picks up
// the spied module instance from the shared registry above.
const { listUseCases, USE_CASES } = require('../config/useCases.js');

describe('resolveUseCase() a2aDelegated reuse (finding #73)', () => {
  test('listUseCases("banking") makes no extra isA2aDelegatedTool calls beyond module load', () => {
    // Sanity: the catalog is non-trivial in size, so a per-entry recompute
    // would be a real, measurable number of extra calls, not noise.
    expect(USE_CASES.length).toBeGreaterThan(20);

    spy.mockClear();
    const resolved = listUseCases('banking');
    expect(resolved).toHaveLength(USE_CASES.length);

    // 'banking' never has a perVertical override applied (resolveUseCase's
    // early-out covers vertical === 'banking' unconditionally), so every
    // entry's resolved primaryTool equals base.primaryTool — the precomputed
    // base.a2aDelegated should be reused for all of them.
    expect(spy).not.toHaveBeenCalled();

    // And the resolved values must still be correct — reuse must not change
    // the output, only how it's computed.
    resolved.forEach((uc, i) => {
      expect(uc.a2aDelegated).toBe(USE_CASES[i].a2aDelegated);
    });
  });
});
