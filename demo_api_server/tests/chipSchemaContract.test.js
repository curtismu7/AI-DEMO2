'use strict';

/**
 * Chip → tool schema contract (stall-risk gate).
 *
 * For every vertical, for every dashboard chip that carries a `message`
 * (dashboard.chips10 + dashboard.securityShowcase.tabs[].chips), this test
 * reproduces exactly what the BFF does at dispatch:
 *   1. parse the chip message via nlIntentParser.parseHeuristic(message, vertical, {})
 *   2. resolve the tool from the vertical plugin's getTools()
 *   3. apply the SAME recordId normalization the dispatcher applies
 *      (demoAgentLangGraphService.__test.normalizeVerticalToolArgs)
 * then asserts the normalized args carry NO missing required param (so the
 * missing-params gate can't return a "please provide X" clarify — a stall) and
 * NO param outside the tool's declared inputSchema.properties (which the
 * additionalProperties:false gateway schema would 400).
 *
 * Only chips that parse to kind:'vertical' for the ACTIVE vertical are in scope
 * — that is precisely the dispatch path guarded by the missing-params gate and
 * normalizeVerticalToolArgs. Banking chips (kind:'banking'), education, LLM-only
 * chips, and cross-vertical/admin actions take other paths and are not subject
 * to this contract.
 *
 * ALLOWLIST: the `admin` vertical is skipped — its chips intentionally require a
 * selected customer, so a bare chip legitimately clarifies.
 */

const fs = require('fs');
const path = require('path');
const { parseHeuristic } = require('../services/nlIntentParser');
const { verticalManifest } = require('../services/verticalManifest');
const { __test } = require('../services/demoAgentLangGraphService');

const { normalizeVerticalToolArgs } = __test;

const VERTICALS_ROOT = path.join(__dirname, '..', 'config', 'verticals');
const SKIP_VERTICALS = new Set(['admin']); // allowlist: admin chips require a selected customer

/** Verticals that have BOTH a manifest.json and a plugin index.js. */
function discoverVerticals() {
  return fs.readdirSync(VERTICALS_ROOT).filter((v) => {
    if (SKIP_VERTICALS.has(v)) return false;
    const dir = path.join(VERTICALS_ROOT, v);
    return fs.existsSync(path.join(dir, 'manifest.json'))
      && fs.existsSync(path.join(dir, 'index.js'));
  });
}

/** dashboard.chips10 + every securityShowcase tab's chips that carry a message. */
function chipsWithMessage(manifest) {
  const d = (manifest && manifest.dashboard) || {};
  const showcaseTabs = (d.securityShowcase && d.securityShowcase.tabs) || [];
  const showcaseChips = showcaseTabs.flatMap((t) => t.chips || []);
  return [...(d.chips10 || []), ...showcaseChips].filter((c) => typeof c.message === 'string');
}

/**
 * Build the flat case list once. Each case is a chip that parses to a vertical
 * tool for its own vertical — the exact set the dispatcher would route through
 * the missing-params gate.
 */
function buildCases() {
  const cases = [];
  for (const vertical of discoverVerticals()) {
    const plugin = verticalManifest.plugins.get(vertical);
    if (!plugin) continue;
    const tools = plugin.getTools();
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const manifest = require(path.join(VERTICALS_ROOT, vertical, 'manifest.json'));
    for (const chip of chipsWithMessage(manifest)) {
      const parsed = parseHeuristic(chip.message, vertical, {});
      if (!parsed || parsed.kind !== 'vertical' || parsed.vertical !== vertical) continue;
      const toolDef = tools.find((t) => t.name === parsed.action);
      if (!toolDef) continue; // not a declared vertical tool → other dispatch path
      cases.push({ vertical, chipId: chip.id, message: chip.message, action: parsed.action, params: parsed.params || {}, toolDef });
    }
  }
  return cases;
}

const CASES = buildCases();

describe('chip → tool schema contract (no stall-risk chips)', () => {
  test('at least one vertical write chip is exercised (guards against a silent no-op sweep)', () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  test.each(CASES.map((c) => [`${c.vertical}/${c.chipId} → ${c.action}`, c]))(
    '%s carries every required param and no undeclared param',
    (_label, c) => {
      const args = normalizeVerticalToolArgs({ ...c.params }, c.toolDef) || {};
      const required = (c.toolDef.inputSchema && c.toolDef.inputSchema.required) || [];
      const properties = (c.toolDef.inputSchema && c.toolDef.inputSchema.properties) || {};

      const missing = required.filter((k) => args[k] == null || args[k] === '');
      const undeclared = Object.keys(args).filter((k) => !(k in properties));

      expect({ missing, undeclared }).toEqual({ missing: [], undeclared: [] });
    },
  );

  test('sweep: zero non-admin chips would stall or send an undeclared param', () => {
    const stalls = CASES.filter((c) => {
      const args = normalizeVerticalToolArgs({ ...c.params }, c.toolDef) || {};
      const required = (c.toolDef.inputSchema && c.toolDef.inputSchema.required) || [];
      const properties = (c.toolDef.inputSchema && c.toolDef.inputSchema.properties) || {};
      const missing = required.filter((k) => args[k] == null || args[k] === '');
      const undeclared = Object.keys(args).filter((k) => !(k in properties));
      return missing.length > 0 || undeclared.length > 0;
    }).map((c) => `${c.vertical}/${c.chipId} → ${c.action}`);

    expect(stalls).toEqual([]);
  });
});
