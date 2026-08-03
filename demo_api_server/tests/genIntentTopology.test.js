'use strict';

/**
 * Unit tests for scripts/gen-intent-topology.js.
 *
 * Every check gets a POSITIVE case (clean input passes) and a NEGATIVE case (a
 * deliberately broken input FAILS). The negative cases are the point: a checker
 * that has never been watched to go red proves nothing, which is the exact
 * defect this generator exists to fix (see the Stage 1 design note on
 * nlIntentParser.catalog.test.js:223).
 */

const gen = require('../scripts/gen-intent-topology');

/** Verified 2026-08-02 — chips live at manifest.dashboard.chips10, not top level. */
const EXPECTED_CHIP_COUNTS = {
  banking: 16,
  retail: 15,
  'oauth-teaching': 12,
  healthcare: 10,
  workforce: 10,
  government: 9,
  investment: 9,
  manufacturing: 9,
  university: 9,
  'sporting-goods': 9,
  admin: 8,
  'pingone-admin': 5,
  airlines: 5,
};

/** Minimal well-formed row; override one field per negative case. */
function row(over = {}) {
  return {
    vertical: 'retail',
    chipId: 'rt1',
    intentId: 'retail:rt1',
    message: 'list my orders',
    mode: 'both',
    declaredTool: 'list_orders',
    declaredToolSource: 'chips10[].tool',
    resolvedTool: 'list_orders',
    resolverPath: 'heuristic:vertical',
    overlayPrecedence: 'vertical',
    heuristicAction: 'list_orders',
    clientDispatched: false,
    offeredToLlm: true,
    reachable: true,
    ...over,
  };
}

const fails = (issues) => issues.filter((i) => i.severity === 'fail');

describe('gen-intent-topology — chip inventory', () => {
  let rows;
  beforeAll(() => { rows = gen.buildRows(); });

  it('covers 126 chips across 13 verticals', () => {
    expect(rows).toHaveLength(126);
    expect(new Set(rows.map((r) => r.vertical)).size).toBe(13);
  });

  it('reproduces the per-vertical chip counts exactly', () => {
    const counts = {};
    for (const r of rows) counts[r.vertical] = (counts[r.vertical] || 0) + 1;
    expect(counts).toEqual(EXPECTED_CHIP_COUNTS);
  });

  it('does not include admin-console, which has no chips', () => {
    expect(rows.some((r) => r.vertical === 'admin-console')).toBe(false);
  });

  it('every cell carries the matrix fields', () => {
    for (const r of rows) {
      for (const f of ['vertical', 'chipId', 'message', 'mode', 'declaredTool',
        'declaredToolSource', 'resolvedTool', 'resolverPath', 'overlayPrecedence']) {
        expect(r).toHaveProperty(f);
      }
      expect(['both', 'direct', 'llm']).toContain(r.mode);
    }
  });
});

describe('gen-intent-topology — intent x vertical matrix', () => {
  let topology;
  beforeAll(() => { topology = gen.buildTopology(gen.buildRows(), []); });

  it('keys rows by intent and columns by vertical', () => {
    const jwt = topology.intents.jwt;
    expect(jwt).toBeTruthy();
    expect(jwt.cells.banking.chipId).toBe('bk-jwt');
    expect(jwt.cells.healthcare.chipId).toBe('hc-jwt');
  });

  it('reports an intent that is not present in every vertical (empty cell)', () => {
    // `feature` exists in the 8 verticals with a featurePage, not in banking.
    expect(Object.keys(topology.intents.feature.cells)).not.toContain('banking');
  });

  it('carries the totals so a miscount is visible in the artifact', () => {
    expect(topology.counts.chips).toBe(126);
    expect(topology.counts.verticals).toBe(13);
    expect(topology.counts.byVertical).toEqual(EXPECTED_CHIP_COUNTS);
  });
});

describe('intentIdFor — derived, not authored', () => {
  it('aligns chips that share a suffix across verticals', () => {
    expect(gen.intentIdFor('bk-jwt', 'banking')).toEqual({ intentId: 'jwt', aligned: true });
    expect(gen.intentIdFor('hc-feature', 'healthcare')).toEqual({ intentId: 'feature', aligned: true });
    expect(gen.intentIdFor('bk-bad-scope', 'banking')).toEqual({ intentId: 'bad-scope', aligned: true });
  });

  it('scopes a numeric chip id to its own vertical rather than inventing an intent', () => {
    expect(gen.intentIdFor('rt10', 'retail')).toEqual({ intentId: 'retail:rt10', aligned: false });
    expect(gen.intentIdFor('ot1', 'oauth-teaching')).toEqual({ intentId: 'oauth-teaching:ot1', aligned: false });
  });
});

describe('normalizeDeclaredTool — three unschema-d fields into one', () => {
  const manifest = { featurePage: { mcpTool: 'show_permit' } };

  it('reads chips10[].tool', () => {
    expect(gen.normalizeDeclaredTool({ id: 'gv1', tool: 'view_permits' }, manifest))
      .toEqual({ declaredTool: 'view_permits', declaredToolSource: 'chips10[].tool' });
  });

  it('prefers denyTool — a negative chip targets the tool it means to be denied', () => {
    expect(gen.normalizeDeclaredTool({ id: 'bk-deny', denyTool: 'show_health_record' }, manifest))
      .toEqual({ declaredTool: 'show_health_record', declaredToolSource: 'chips10[].denyTool' });
  });

  it('falls back to featurePage.mcpTool for a -feature chip with no tool', () => {
    expect(gen.normalizeDeclaredTool({ id: 'gv-feature' }, manifest))
      .toEqual({ declaredTool: 'show_permit', declaredToolSource: 'featurePage.mcpTool' });
  });

  it('reports null when nothing is declared', () => {
    expect(gen.normalizeDeclaredTool({ id: 'ot1' }, {}))
      .toEqual({ declaredTool: null, declaredToolSource: null });
  });
});

describe('resolveToolForAction — (action, vertical), not a flat map', () => {
  const govManifest = { featurePage: { mcpTool: 'show_permit' } };

  it('resolves vertical_feature_demo per vertical', () => {
    expect(gen.resolveToolForAction('vertical_feature_demo', 'government', govManifest).tool)
      .toBe('show_permit');
    expect(gen.resolveToolForAction('vertical_feature_demo', 'healthcare', { featurePage: { mcpTool: 'show_health_record' } }).tool)
      .toBe('show_health_record');
  });

  it('resolves the UI-dispatched jwt chip to the tool AIAgent.js actually calls', () => {
    expect(gen.resolveToolForAction('jwt_decode_demo', 'banking', {}))
      .toEqual({ tool: 'jwt_decode_full', clientDispatched: true });
  });

  it('applies the shared heuristic ACTION -> tool map', () => {
    expect(gen.resolveToolForAction('transfer', 'banking', {}).tool).toBe('create_transfer');
  });

  it('falls back to identity for a vertical plugin action', () => {
    expect(gen.resolveToolForAction('view_permits', 'government', govManifest))
      .toEqual({ tool: 'view_permits', clientDispatched: false });
  });

  it('returns a null tool for a client-dispatched action with no BFF tool', () => {
    // The trap: comparing these naively produces ~19 false mismatches.
    expect(gen.resolveToolForAction('mcp_tools', 'pingone-admin', {}))
      .toEqual({ tool: null, clientDispatched: true });
  });
});

describe('check: resolution — mode-appropriate', () => {
  it('passes a `both` chip that resolves to its declared tool', () => {
    expect(fails(gen.checkResolution([row()]))).toEqual([]);
  });

  it('FAILS a `both` chip whose heuristics resolve to a different tool', () => {
    const issues = fails(gen.checkResolution([row({ resolvedTool: 'rewards_balance' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('tool_mismatch');
    expect(issues[0].chipId).toBe('rt1');
  });

  it('FAILS a `both` chip that resolves to nothing', () => {
    const issues = fails(gen.checkResolution([row({
      resolvedTool: null, heuristicAction: null, resolverPath: 'unresolved',
    })]));
    expect(issues.map((i) => i.code)).toEqual(['unresolved']);
  });

  it('FAILS a chip that declares no tool at all', () => {
    const issues = fails(gen.checkResolution([row({
      declaredTool: null, declaredToolSource: null,
    })]));
    expect(issues.map((i) => i.code)).toEqual(['missing_declared_tool']);
  });

  it('does NOT fault a client-dispatched chip with no BFF tool mapping', () => {
    // CLIENT_DISPATCHED_ACTIONS honoured — the UI dispatches it, so the
    // heuristic action is not required to equal a BFF tool name.
    const issues = gen.checkResolution([row({
      vertical: 'pingone-admin',
      chipId: 'pa1',
      declaredTool: 'list_pingone_tools',
      resolvedTool: null,
      heuristicAction: 'mcp_tools',
      clientDispatched: true,
      resolverPath: 'heuristic:banking+client',
    })]);
    expect(fails(issues)).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(['client_dispatched_unverifiable']);
  });

  it('passes a `direct` chip whose tool is reachable', () => {
    expect(fails(gen.checkResolution([row({
      chipId: 'rt-direct', mode: 'direct', resolverPath: 'direct',
      resolvedTool: null, heuristicAction: null,
    })]))).toEqual([]);
  });

  it('FAILS a `direct` chip whose declared tool is unreachable', () => {
    const issues = fails(gen.checkResolution([row({
      chipId: 'rt-direct', mode: 'direct', resolverPath: 'direct',
      declaredTool: 'no_such_tool', reachable: false,
      resolvedTool: null, heuristicAction: null,
    })]));
    expect(issues.map((i) => i.code)).toEqual(['unreachable_tool']);
  });

  it('passes an `llm` chip whose tool is offered to the LLM', () => {
    expect(fails(gen.checkResolution([row({
      chipId: 'rt-llm', mode: 'llm', resolverPath: 'llm',
      resolvedTool: null, heuristicAction: null,
    })]))).toEqual([]);
  });

  it('FAILS an `llm` chip whose tool is not in the schemas offered for that vertical', () => {
    const issues = fails(gen.checkResolution([row({
      chipId: 'rt-llm', mode: 'llm', resolverPath: 'llm',
      offeredToLlm: false, resolvedTool: null, heuristicAction: null,
    })]));
    expect(issues.map((i) => i.code)).toEqual(['not_offered_to_llm']);
  });
});

describe('check: phrase collision within a vertical', () => {
  it('passes distinct phrases', () => {
    expect(gen.checkPhraseCollisions([
      row({ chipId: 'rt1', message: 'list my orders' }),
      row({ chipId: 'rt2', message: 'order status', declaredTool: 'order_status' }),
    ])).toEqual([]);
  });

  it('FAILS two chips in one vertical that share a phrase but declare different tools', () => {
    const issues = fails(gen.checkPhraseCollisions([
      row({ chipId: 'rt1', message: 'list my orders', declaredTool: 'list_orders' }),
      row({ chipId: 'rt9', message: 'List My Orders', declaredTool: 'rewards_balance' }),
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('phrase_collision');
    expect(issues[0].detail).toContain('rt1');
    expect(issues[0].detail).toContain('rt9');
  });

  it('warns rather than fails when the colliding chips declare the same tool', () => {
    const issues = gen.checkPhraseCollisions([
      row({ chipId: 'rt1', message: 'list my orders' }),
      row({ chipId: 'rt-direct', message: 'list my orders', mode: 'direct' }),
    ]);
    expect(fails(issues)).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(['phrase_duplicate']);
  });

  it('ignores the same phrase in two different verticals', () => {
    expect(gen.checkPhraseCollisions([
      row({ vertical: 'retail', message: 'order status', declaredTool: 'order_status' }),
      row({ vertical: 'sporting-goods', message: 'order status', declaredTool: 'gear_order_status' }),
    ])).toEqual([]);
  });
});

describe('check: overlay tool-name shadowing', () => {
  const clean = {
    baseTools: { banking: ['get_my_accounts'], retail: ['list_orders'] },
    overlayTools: { admin: ['lookup_customer'], a2a: ['delegate_to_specialist'] },
    baseAuthz: { banking: ['get_my_accounts'], retail: ['list_orders'] },
    overlayAuthz: { admin: ['lookup_customer'], a2a: ['delegate_to_specialist'] },
  };

  it('passes when no overlay name collides with a base vertical name', () => {
    expect(gen.checkOverlayShadowing(clean)).toEqual([]);
  });

  it('FAILS when an overlay tool silently overrides a base vertical tool (mergeToolsByName)', () => {
    const issues = fails(gen.checkOverlayShadowing({
      ...clean,
      overlayTools: { ...clean.overlayTools, admin: ['lookup_customer', 'list_orders'] },
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('overlay_tool_shadow');
    expect(issues[0].detail).toContain('list_orders');
    expect(issues[0].detail).toContain('admin');
  });

  it('FAILS when an overlay authz rule silently overrides a base rule (authzFor spread)', () => {
    const issues = fails(gen.checkOverlayShadowing({
      ...clean,
      overlayAuthz: { ...clean.overlayAuthz, a2a: ['delegate_to_specialist', 'get_my_accounts'] },
    }));
    expect(issues.map((i) => i.code)).toEqual(['overlay_authz_shadow']);
    expect(issues[0].detail).toContain('get_my_accounts');
  });

  it('reads the live plugins without throwing', () => {
    expect(Array.isArray(gen.checkOverlayShadowing(gen.collectOverlayInputs()))).toBe(true);
  });
});

describe('gap report', () => {
  it('groups issues by vertical and names the check', () => {
    const text = gen.formatGapReport([
      { severity: 'fail', check: 'resolution', vertical: 'retail', chipId: 'rt5', code: 'missing_declared_tool', detail: 'no tool declared' },
      { severity: 'warn', check: 'resolution', vertical: 'retail', chipId: 'rt8', code: 'client_dispatched_unverifiable', detail: 'UI dispatches it' },
    ]);
    expect(text).toContain('retail');
    expect(text).toContain('rt5');
    expect(text).toContain('missing_declared_tool');
    expect(text).toContain('rt8');
  });

  it('says so when there is nothing to report', () => {
    expect(gen.formatGapReport([])).toContain('No gaps');
  });
});

describe('runChecks against the live manifests', () => {
  let issues;
  beforeAll(() => { issues = gen.runChecks(gen.buildRows()); });

  it('reports zero blocking gaps — this is what `npm run intents:check` gates on', () => {
    expect(fails(issues)).toEqual([]);
  });

  it('does not report a tool_mismatch for any *-jwt or *-feature chip', () => {
    // These are the ~19 false mismatches CLIENT_DISPATCHED_ACTIONS exists to prevent.
    const bogus = issues.filter((i) => i.code === 'tool_mismatch'
      && /-(jwt|feature)$/.test(i.chipId));
    expect(bogus).toEqual([]);
  });
});

/**
 * Revert-to-RED: the gate is only worth having if removing a declaration turns
 * it red. Each case reads the REAL manifest chip (so deleting the declaration
 * from the manifest fails the first assertion loudly), then feeds the reverted
 * shape through the same check the CLI runs.
 */
describe('the gate goes RED when a backfilled declaration is reverted', () => {
  const manifestOf = (v) => require(`../config/verticals/${v}/manifest.json`);
  const chipOf = (v, id) => manifestOf(v).dashboard.chips10.find((c) => c.id === id);

  /** Live row for a chip, as `check` builds it. */
  const liveRow = (() => {
    let rows;
    return (v, id) => {
      if (!rows) rows = gen.buildRows();
      return rows.find((r) => r.vertical === v && r.chipId === id);
    };
  })();

  it.each([
    ['oauth-teaching', 'ot1', 'explain_concept'],
    ['oauth-teaching', 'ot11', 'demonstrate_token_exchange'],
    ['retail', 'rt10', 'view_recently_viewed'],
    ['banking', 'bk-bad-scope', 'test_wrong_scope'],
    ['banking', 'bk-dpop', 'test_wrong_audience'],
    ['banking', 'bk8', 'get_my_transactions'],
    ['investment', 'inv-llm', 'show_investment'],
    ['workforce', 'wf10', 'list_expenses'],
  ])('%s/%s declares %s, and dropping it FAILS missing_declared_tool', (v, id, tool) => {
    expect(chipOf(v, id).tool).toBe(tool);

    const row = liveRow(v, id);
    expect(fails(gen.checkResolution([row]))).toEqual([]);

    const reverted = { ...row, declaredTool: null, declaredToolSource: null };
    expect(fails(gen.checkResolution([reverted])).map((i) => i.code))
      .toEqual(['missing_declared_tool']);
  });

  it('bk-a2a FAILS tool_mismatch again if the actionToTool alias is dropped', () => {
    const { ACTION_TO_TOOL } = require('./helpers/actionToTool');
    expect(ACTION_TO_TOOL.sensitive_account_details).toBe('get_sensitive_account_details');

    const row = liveRow('banking', 'bk-a2a');
    expect(fails(gen.checkResolution([row]))).toEqual([]);

    // Without the alias, resolveToolForAction falls back to identity on the
    // heuristic action name — exactly the state before the mapping was added.
    const reverted = { ...row, resolvedTool: row.heuristicAction };
    const red = fails(gen.checkResolution([reverted]));
    expect(red.map((i) => i.code)).toEqual(['tool_mismatch']);
    expect(red[0].detail).toContain('get_sensitive_account_details');
  });
});
