#!/usr/bin/env node
'use strict';
/*
 * gen-intent-topology.js — derive the intent x vertical routing matrix from the
 * vertical manifests + the live heuristic/plugin/overlay code, so "which tool
 * does this prompt reach" stops being unproven.
 *
 * Why: three (really four) dispatch shapes decide which tool a chip reaches and
 * nothing gates any of them. tests/nlIntentParser.catalog.test.js:223 asserts a
 * phrase resolved to *a* kind, never that it resolved to the chip's own tool, so
 * a chip routing to the WRONG tool passes green.
 *
 * Source of truth (chips live NESTED — reading the manifest top level silently
 * finds zero, which looks like success):
 *   demo_api_server/config/verticals/<id>/manifest.json  ->  dashboard.chips10
 *
 * It writes ONE output:
 *   intent-topology.json — rows are intents, columns are verticals. Each cell
 *   carries { vertical, chipId, message, mode, declaredTool, resolvedTool,
 *   resolverPath, overlayPrecedence, ... } plus the gap report for that run.
 *
 * Checks (mode-appropriate — see the Stage 1 gate table):
 *   both    resolves via heuristics to its declared tool
 *   direct  its tool/denyTool exists and is reachable on the path it uses
 *           (reuses services/checks/uiDispatchCheck.js — no second copy)
 *   llm     its tool appears in the schemas offered to the LLM for that vertical
 *   plus    phrase collision within a vertical, and overlay tool-name/authz
 *           shadowing from mergeToolsByName / authzFor in verticalDispatch.js.
 *
 * NOT a fixer. It reports gaps; backfilling the missing declarations, tightening
 * the Zod schema and editing manifests are separate, later changes. Expect
 * `check` to exit 1 until those land — that is the point, it is currently
 * "green" only because nothing looks.
 *
 * Usage:
 *   node scripts/gen-intent-topology.js check      # exit 1 on drift or any blocking gap
 *   node scripts/gen-intent-topology.js generate   # rewrite intent-topology.json
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ARTIFACT_PATH = path.join(ROOT, 'intent-topology.json');
const VERTICALS_DIR = path.join(__dirname, '..', 'config', 'verticals');

const { CLIENT_DISPATCHED_ACTIONS } = require('./useCaseSweepCauses');
// The documented single source of truth for heuristic ACTION -> dispatched TOOL
// (tests/helpers/actionToTool.js says so in its own header). Read it rather than
// keeping a third copy; Stage 1 replaces it with this file's (action, vertical)
// resolver, at which point the require goes away instead of drifting.
const { ACTION_TO_TOOL } = require('../tests/helpers/actionToTool');
const { auditUiDispatch, gatewayToolNames } = require('../services/checks/uiDispatchCheck');

/**
 * Client-dispatched actions the UI resolves to a REAL tool, so the declaration
 * is still checkable. Values are (vertical, manifest) => toolName — the
 * vertical-parameterized resolver a flat map cannot express.
 * Each one is read off demo_api_ui/src/components/AIAgent.js's own switch.
 */
const CLIENT_ACTION_TO_TOOL = {
  jwt_decode_demo: () => 'jwt_decode_full',
  mortgage_demo: () => 'show_mortgage',
  // Available on every customer vertical; always show_investment regardless of
  // the active vertical's own featurePage.
  invest_demo: () => 'show_investment',
  vertical_feature_demo: (_vertical, manifest) => (manifest?.featurePage?.mcpTool || 'show_mortgage'),
};

/** Same normalization the parser uses for chip-text comparison. */
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const issue = (severity, check, vertical, chipId, code, detail) => ({
  severity, check, vertical, chipId, code, detail,
});

// ── Reading the manifests ─────────────────────────────────────────────────────

/**
 * Every vertical that carries chips, with its manifest. Verticals with an empty
 * or absent chips10 (admin-console) are omitted — they have no cells.
 * @returns {Array<{vertical: string, manifest: object, chips: object[]}>}
 */
function readChips() {
  let dirs = [];
  try { dirs = fs.readdirSync(VERTICALS_DIR); } catch (_e) { dirs = []; }
  const out = [];
  for (const vertical of dirs.sort()) {
    const mpath = path.join(VERTICALS_DIR, vertical, 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch (_e) { continue; }
    // NESTED. manifest.chips10 does not exist; reading it returns zero for every
    // vertical and the generator reports a clean, entirely fictional run.
    const chips = (manifest.dashboard && manifest.dashboard.chips10) || [];
    if (!chips.length) continue;
    out.push({ vertical, manifest, chips });
  }
  return out;
}

/**
 * Intent id for a chip, DERIVED from the chip id rather than authored, so the
 * matrix cannot go stale the first time a chip is added.
 *
 * A chip id is `<verticalPrefix>-<suffix>` when it names a shared intent
 * (bk-jwt / hc-jwt / gv-jwt -> "jwt"), and `<prefix><n>` when it is numbered and
 * therefore vertical-local (rt10, ot1). A numbered chip gets a vertical-scoped
 * intent id and aligned:false — an honest "this intent is not aligned across
 * verticals yet" rather than a guessed alignment.
 * @param {string} chipId
 * @param {string} vertical
 * @returns {{intentId: string, aligned: boolean}}
 */
function intentIdFor(chipId, vertical) {
  const id = String(chipId || '');
  const dash = id.indexOf('-');
  if (dash > 0 && dash < id.length - 1) {
    return { intentId: id.slice(dash + 1), aligned: true };
  }
  return { intentId: `${vertical}:${id}`, aligned: false };
}

/**
 * Collapse the THREE unschema'd tool declarations into one field.
 *
 * Precedence, and why:
 *   1. chips10[].denyTool      — a negative chip names the tool it means to be
 *                                DENIED; that is the tool it dispatches.
 *   2. chips10[].tool          — the ordinary declaration.
 *   3. featurePage.mcpTool     — a `-feature` chip is dispatched by the UI to
 *                                featurePage.mcpTool, so a feature chip with no
 *                                `tool` still has a real declaration.
 * uiDispatchCheck.js already gates the case where (2) and (3) disagree; this
 * function does not re-litigate it.
 * @param {object} chip
 * @param {object} manifest
 * @returns {{declaredTool: string|null, declaredToolSource: string|null}}
 */
function normalizeDeclaredTool(chip, manifest) {
  if (chip && chip.denyTool) {
    return { declaredTool: chip.denyTool, declaredToolSource: 'chips10[].denyTool' };
  }
  if (chip && chip.tool) {
    return { declaredTool: chip.tool, declaredToolSource: 'chips10[].tool' };
  }
  const isFeatureChip = String((chip && chip.id) || '').endsWith('-feature');
  const mcpTool = manifest && manifest.featurePage && manifest.featurePage.mcpTool;
  if (isFeatureChip && mcpTool) {
    return { declaredTool: mcpTool, declaredToolSource: 'featurePage.mcpTool' };
  }
  return { declaredTool: null, declaredToolSource: null };
}

/**
 * Heuristic ACTION -> dispatched TOOL, parameterized by vertical.
 *
 * A client-dispatched action is NOT required to equal a BFF tool name — the UI
 * runs it, not the BFF (useCaseSweepCauses.js:29-43). Comparing those naively
 * produced ~19 false mismatches. The four in CLIENT_ACTION_TO_TOOL do resolve to
 * a real tool the UI names, so they stay checkable; the rest resolve to null and
 * the tool-equality assertion is skipped for them.
 * @param {string|null} action
 * @param {string} vertical
 * @param {object} manifest
 * @returns {{tool: string|null, clientDispatched: boolean}}
 */
function resolveToolForAction(action, vertical, manifest) {
  if (!action) return { tool: null, clientDispatched: false };
  const clientDispatched = CLIENT_DISPATCHED_ACTIONS.has(action);
  const viaClient = CLIENT_ACTION_TO_TOOL[action];
  if (viaClient) return { tool: viaClient(vertical, manifest), clientDispatched };
  if (clientDispatched) return { tool: null, clientDispatched: true };
  // Vertical plugin actions ARE their tool names (identity fallback).
  return { tool: ACTION_TO_TOOL[action] || action, clientDispatched: false };
}

// ── Resolving each chip against the live routing code ─────────────────────────

/**
 * Tool names a chip can actually be dispatched to: the gateway's registry plus
 * every vertical/overlay plugin's own tools (local tools like explain_concept
 * never reach the gateway and are absent from scope-topology.json).
 * @returns {Set<string>}
 */
function dispatchableToolNames() {
  const { verticalManifest } = require('../services/verticalManifest');
  const verticalDispatch = require('../services/verticalDispatch');
  verticalManifest.init();
  const names = gatewayToolNames();
  const ids = [...verticalManifest.listAll().map((v) => v.id), ...verticalDispatch.PLUGIN_OVERLAY_IDS, 'a2a'];
  for (const id of new Set(ids)) {
    const p = verticalDispatch.resolvePlugin(id);
    if (!p || typeof p.getTools !== 'function') continue;
    for (const t of p.getTools()) if (t && t.name) names.add(t.name);
  }
  return names;
}

/**
 * Which provider WINS for a tool name under mergeToolsByName's base -> admin ->
 * a2a order. 'none' means no plugin owns the name (a gateway-only tool such as
 * show_mortgage, dispatched by the UI rather than by a plugin).
 * @param {string|null} tool
 * @param {string} vertical
 * @param {{baseTools: object, overlayTools: object}} inputs
 * @returns {string}
 */
function overlayPrecedenceFor(tool, vertical, inputs) {
  if (!tool) return 'none';
  let winner = 'none';
  if ((inputs.baseTools[vertical] || []).includes(tool)) winner = 'vertical';
  for (const overlayId of Object.keys(inputs.overlayTools).sort()) {
    if ((inputs.overlayTools[overlayId] || []).includes(tool)) winner = overlayId;
  }
  return winner;
}

/**
 * One row (cell) per chip, resolved against the live parser, plugin registry and
 * overlays. This is the only function that touches process-global state, and it
 * does not: parseHeuristic / resolveVerticalCtx / toolSchemasFor all take the
 * vertical explicitly, so no setActive() call is needed or made.
 * @returns {object[]}
 */
function buildRows() {
  const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
  const verticalDispatch = require('../services/verticalDispatch');
  const { verticalManifest } = require('../services/verticalManifest');
  verticalManifest.init();

  const reachable = dispatchableToolNames();
  const overlayInputs = collectOverlayInputs();
  const rows = [];

  for (const { vertical, manifest, chips } of readChips()) {
    const ctx = resolveVerticalCtx(vertical);
    const llmSchemas = new Set(
      verticalDispatch.toolSchemasFor(vertical, {}, () => []).map((t) => t.name),
    );

    for (const chip of chips) {
      const mode = chip.mode || 'both';
      const { intentId, aligned } = intentIdFor(chip.id, vertical);
      const { declaredTool, declaredToolSource } = normalizeDeclaredTool(chip, manifest);

      let kind = null;
      let heuristicAction = null;
      const parsed = parseHeuristic(chip.message, vertical, ctx);
      if (parsed) {
        kind = parsed.kind;
        heuristicAction = (parsed.banking && parsed.banking.action) || parsed.action || null;
      }
      const { tool: resolvedTool, clientDispatched } =
        resolveToolForAction(heuristicAction, vertical, manifest);

      let resolverPath;
      if (mode === 'direct') resolverPath = 'direct';
      else if (mode === 'llm') resolverPath = 'llm';
      else if (!heuristicAction) resolverPath = 'unresolved';
      else resolverPath = `heuristic:${kind}${clientDispatched ? '+client' : ''}`;

      rows.push({
        vertical,
        chipId: chip.id,
        intentId,
        intentAligned: aligned,
        message: chip.message,
        mode,
        declaredTool,
        declaredToolSource,
        resolvedTool,
        resolverPath,
        overlayPrecedence: overlayPrecedenceFor(declaredTool || resolvedTool, vertical, overlayInputs),
        heuristicAction,
        clientDispatched,
        offeredToLlm: declaredTool ? llmSchemas.has(declaredTool) : false,
        reachable: declaredTool ? reachable.has(declaredTool) : false,
      });
    }
  }
  return rows;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Mode-appropriate tool resolution. No exemptions — every chip is gated, but the
 * assertion differs by how the chip is actually dispatched.
 * @param {object[]} rows
 * @returns {object[]} issues
 */
function checkResolution(rows) {
  const issues = [];
  for (const r of rows) {
    const at = (code, detail, severity = 'fail') =>
      issues.push(issue(severity, 'resolution', r.vertical, r.chipId, code, detail));

    if (!r.declaredTool) {
      at('missing_declared_tool',
        `mode=${r.mode} declares no tool / denyTool / featurePage.mcpTool, so nothing can be proven about where "${r.message}" goes`);
      continue;
    }

    if (r.mode === 'direct') {
      if (!r.reachable) {
        at('unreachable_tool',
          `direct chip dispatches "${r.declaredTool}" by name, but no plugin or gateway registry owns it`);
      }
      continue;
    }

    if (r.mode === 'llm') {
      if (!r.offeredToLlm) {
        at('not_offered_to_llm',
          `"${r.declaredTool}" is not in the tool schemas offered to the LLM for ${r.vertical}`);
      }
      continue;
    }

    // mode 'both'
    if (!r.heuristicAction) {
      at('unresolved',
        `heuristics return kind:'${r.resolverPath === 'unresolved' ? 'none' : r.resolverPath}' for "${r.message}" — the chip dead-ends without an LLM`);
      continue;
    }
    if (r.resolvedTool === null && r.clientDispatched) {
      // Honours CLIENT_DISPATCHED_ACTIONS: the UI dispatches this action, so its
      // heuristic action is NOT required to equal a BFF tool name. Recorded so
      // the blind spot stays visible, never counted as a mismatch.
      at('client_dispatched_unverifiable',
        `action "${r.heuristicAction}" is dispatched by the UI and maps to no BFF tool, so declared "${r.declaredTool}" cannot be verified statically`,
        'warn');
      continue;
    }
    if (r.resolvedTool !== r.declaredTool) {
      at('tool_mismatch',
        `declares "${r.declaredTool}" but heuristics resolve action "${r.heuristicAction}" -> "${r.resolvedTool}"`);
    }
  }
  return issues;
}

/**
 * Two chips in one vertical answering to the same phrase. Ordering in the
 * heuristics array decides which one wins (verticalDispatch.js:85-87), so a new
 * chip can silently steal another chip's phrase.
 *
 * fail when the colliding chips declare DIFFERENT tools — routing is ambiguous.
 * warn when they declare the SAME tool — an intentional alias (a vertical's
 * `direct` chip reusing a `both` chip's wording), still worth surfacing.
 * @param {object[]} rows
 * @returns {object[]} issues
 */
function checkPhraseCollisions(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.vertical} ${norm(r.message)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const issues = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const tools = new Set(group.map((r) => r.declaredTool || '(none)'));
    const ids = group.map((r) => `${r.chipId}->${r.declaredTool || '(none)'}`).join(', ');
    const same = tools.size === 1;
    issues.push(issue(
      same ? 'warn' : 'fail',
      'phrase-collision',
      group[0].vertical,
      group.map((r) => r.chipId).join('+'),
      same ? 'phrase_duplicate' : 'phrase_collision',
      `${group.length} chips share the phrase "${group[0].message}": ${ids}`,
    ));
  }
  return issues;
}

/**
 * Overlay shadowing. mergeToolsByName (verticalDispatch.js:70-74) and authzFor's
 * `{ ...authz, ...overlay.getAuthz() }` (line 197) are both last-write-wins and
 * report nothing, so an overlay name that matches a base vertical name silently
 * replaces it.
 * @param {{baseTools: object, overlayTools: object, baseAuthz: object, overlayAuthz: object}} inputs
 * @returns {object[]} issues
 */
function checkOverlayShadowing(inputs) {
  const issues = [];
  const scan = (base, overlay, code, mechanism) => {
    for (const overlayId of Object.keys(overlay).sort()) {
      const overlayNames = new Set(overlay[overlayId] || []);
      for (const vertical of Object.keys(base).sort()) {
        for (const name of (base[vertical] || []).slice().sort()) {
          if (!overlayNames.has(name)) continue;
          issues.push(issue('fail', 'overlay-shadow', vertical, null, code,
            `overlay "${overlayId}" defines "${name}", which ${mechanism} silently overrides on the ${vertical} vertical`));
        }
      }
    }
  };
  scan(inputs.baseTools, inputs.overlayTools, 'overlay_tool_shadow', 'mergeToolsByName');
  scan(inputs.baseAuthz, inputs.overlayAuthz, 'overlay_authz_shadow', 'authzFor');
  return issues;
}

/**
 * Live base/overlay tool names + authz keys, straight from the plugins.
 * @returns {{baseTools: object, overlayTools: object, baseAuthz: object, overlayAuthz: object}}
 */
function collectOverlayInputs() {
  const { verticalManifest } = require('../services/verticalManifest');
  const verticalDispatch = require('../services/verticalDispatch');
  verticalManifest.init();

  // 'a2a' is not in PLUGIN_OVERLAY_IDS (delegate_to_specialist is intercepted by
  // the agent loop) but IS merged by toolSchemasFor/authzFor, so it shadows too.
  const overlayIds = new Set([...verticalDispatch.PLUGIN_OVERLAY_IDS, 'a2a']);
  const inputs = { baseTools: {}, overlayTools: {}, baseAuthz: {}, overlayAuthz: {} };

  const namesOf = (p) => (typeof p.getTools === 'function' ? p.getTools().map((t) => t.name).filter(Boolean) : []);
  const authzOf = (p) => (typeof p.getAuthz === 'function' ? Object.keys(p.getAuthz() || {}) : []);

  for (const overlayId of [...overlayIds].sort()) {
    const p = verticalDispatch.resolvePlugin(overlayId);
    if (!p) continue;
    inputs.overlayTools[overlayId] = namesOf(p);
    inputs.overlayAuthz[overlayId] = authzOf(p);
  }
  for (const v of verticalManifest.listAll()) {
    if (overlayIds.has(v.id)) continue;
    const p = verticalDispatch.resolvePlugin(v.id);
    if (!p) continue;
    inputs.baseTools[v.id] = namesOf(p);
    inputs.baseAuthz[v.id] = authzOf(p);
  }
  return inputs;
}

/**
 * @param {object[]} rows
 * @returns {object[]} every issue, blocking and informational, sorted for stable output
 */
function runChecks(rows) {
  const issues = [
    ...checkResolution(rows),
    ...checkPhraseCollisions(rows),
    ...checkOverlayShadowing(collectOverlayInputs()),
  ];
  // uiDispatchCheck already owns "the -feature chip and featurePage.mcpTool
  // disagree" — surface its findings here instead of re-implementing them.
  for (const detail of auditUiDispatch().featureIssues) {
    issues.push(issue('fail', 'ui-dispatch', String(detail).split(/[:/]/)[0], null, 'feature_tool_disagreement', detail));
  }
  issues.sort((a, b) => `${a.vertical}${a.chipId}${a.code}`.localeCompare(`${b.vertical}${b.chipId}${b.code}`));
  return issues;
}

// ── Output ───────────────────────────────────────────────────────────────────

/**
 * The matrix: rows are intents, columns are verticals.
 * @param {object[]} rows
 * @param {object[]} issues
 * @returns {object}
 */
function buildTopology(rows, issues) {
  const byVertical = {};
  for (const r of rows) byVertical[r.vertical] = (byVertical[r.vertical] || 0) + 1;

  const intents = {};
  for (const r of rows.slice().sort((a, b) => `${a.intentId}${a.vertical}`.localeCompare(`${b.intentId}${b.vertical}`))) {
    if (!intents[r.intentId]) {
      intents[r.intentId] = { aligned: r.intentAligned, verticals: [], cells: {} };
    }
    const entry = intents[r.intentId];
    entry.verticals.push(r.vertical);
    const { intentId, intentAligned, ...cell } = r;
    entry.cells[r.vertical] = cell;
  }

  return {
    _comment: 'AUTO-GENERATED by demo_api_server/scripts/gen-intent-topology.js — DO NOT EDIT BY HAND. Regenerate: cd demo_api_server && npm run intents:gen',
    counts: {
      verticals: Object.keys(byVertical).length,
      chips: rows.length,
      intents: Object.keys(intents).length,
      byVertical,
    },
    gaps: {
      blocking: issues.filter((i) => i.severity === 'fail').length,
      informational: issues.filter((i) => i.severity === 'warn').length,
      issues,
    },
    intents,
  };
}

/**
 * @param {object[]} issues
 * @returns {string} the gap report, grouped by vertical
 */
function formatGapReport(issues) {
  if (!issues.length) return 'No gaps.';
  const byVertical = new Map();
  for (const i of issues) {
    const v = i.vertical || '(cross-vertical)';
    if (!byVertical.has(v)) byVertical.set(v, []);
    byVertical.get(v).push(i);
  }
  const lines = [];
  for (const v of [...byVertical.keys()].sort()) {
    const group = byVertical.get(v);
    const blocking = group.filter((i) => i.severity === 'fail').length;
    lines.push(`  ${v} — ${group.length} issue(s), ${blocking} blocking`);
    for (const i of group) {
      const mark = i.severity === 'fail' ? 'FAIL' : 'warn';
      lines.push(`    [${mark}] ${i.chipId || '-'} ${i.code}: ${i.detail}`);
    }
  }
  return lines.join('\n');
}

function main() {
  const mode = process.argv[2] || 'check';
  const rows = buildRows();
  const issues = runChecks(rows);
  const want = `${JSON.stringify(buildTopology(rows, issues), null, 2)}\n`;
  const blocking = issues.filter((i) => i.severity === 'fail');

  if (mode === 'check') {
    const have = fs.existsSync(ARTIFACT_PATH) ? fs.readFileSync(ARTIFACT_PATH, 'utf8') : '';
    const drift = want !== have;
    if (!drift && blocking.length === 0) {
      console.log(`[OK] ${rows.length} chips across ${new Set(rows.map((r) => r.vertical)).size} verticals resolve to their declared tool; no phrase collisions, no overlay shadowing.`);
      return;
    }
    if (drift) {
      console.error('[FAIL] intent-topology.json is stale (manifests or routing changed).');
    }
    if (blocking.length) {
      console.error(`[FAIL] ${blocking.length} blocking intent-routing gap(s) across ${rows.length} chips:\n${formatGapReport(issues)}`);
    }
    console.error('  Run: cd demo_api_server && npm run intents:gen');
    process.exit(1);
  }

  if (mode === 'generate') {
    fs.writeFileSync(ARTIFACT_PATH, want);
    console.log(`[OK] Wrote ${rows.length} chips across ${new Set(rows.map((r) => r.vertical)).size} verticals to intent-topology.json — ${blocking.length} blocking gap(s), ${issues.length - blocking.length} informational.`);
    if (issues.length) console.log(formatGapReport(issues));
    return;
  }

  console.error(`Unknown mode "${mode}". Use "check" or "generate".`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = {
  ARTIFACT_PATH,
  CLIENT_ACTION_TO_TOOL,
  readChips,
  intentIdFor,
  normalizeDeclaredTool,
  resolveToolForAction,
  dispatchableToolNames,
  buildRows,
  buildTopology,
  checkResolution,
  checkPhraseCollisions,
  checkOverlayShadowing,
  collectOverlayInputs,
  runChecks,
  formatGapReport,
};
