'use strict';

/**
 * Prove the chips the API cannot prove.
 *
 * WHY THIS EXISTS
 *
 * ~20 catalog chips resolve to actions the BFF deliberately does NOT dispatch —
 * dispatchBankingAction returns null and the UI's own switch handles them. Any
 * check that replays chips through the API therefore says nothing about those
 * paths, and a green table silently implies coverage it does not have.
 *
 * Two static assertions cover what the replay cannot:
 *
 *   1. every client-dispatched action still has a handler in AIAgent.js
 *   2. the *-feature chips agree with featurePage.mcpTool
 *
 * (2) is the sharp one. vertical_feature_demo does NOT call the chip's `tool`
 * field — it calls `featurePage.mcpTool`, defaulting to show_mortgage when the
 * field is absent:
 *
 *     const featureTool = fp?.mcpTool || "show_mortgage";
 *
 * So `chips10[].tool` and `featurePage.mcpTool` are two independently editable
 * fields that must agree, and a vertical missing mcpTool silently serves
 * BANKING MORTGAGE DATA on, say, the government vertical. HTTP 200, wrong data,
 * no error anywhere. Adding a vertical without that field is a one-line
 * omission with no symptom.
 *
 * Mirrors check 6 of scripts/preflight-demo.sh.
 */

const fs = require('fs');
const path = require('path');
const { register } = require('./registry');
const { CLIENT_DISPATCHED_ACTIONS } = require('../../scripts/useCaseSweepCauses');

/**
 * Repo root. Inside a container the checkout may be bind-mounted at /repo while
 * the service itself runs from /app, so the UI sources are not under __dirname.
 * Probe both — and if neither has them, the check must WARN, never pass.
 */
function resolveRepoRoot() {
  // '/repo' FIRST, and this order is load-bearing.
  //
  // The api-server image BAKES a copy of the repo at the container root: /app is
  // not a mount (only /app/node_modules is), and /snapshots, /scope-topology.json
  // and /demo_api_ui all exist at / from build time. Only /repo is the live
  // bind-mount of the working checkout.
  //
  // So resolving __dirname/../../.. from /app/services/checks lands on '/', where
  // a snapshots dir DOES exist — and the probe stops there, reading a build-time
  // artifact. Measured 2026-07-27: / held a 7-actor policy snapshot while /repo
  // held 11, so a2a.registered_actors reported four specialists missing on a
  // system that was correctly configured. A confidently-red check about a healthy
  // demo is the failure mode this whole board exists to avoid.
  //
  // No file-existence heuristic can separate the two — the baked copy has the
  // same marker files. The mount path is the only reliable discriminator.
  const candidates = ['/repo', path.resolve(__dirname, '..', '..', '..')];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'demo_api_ui', 'src', 'components', 'AIAgent.js'))) return c;
    } catch (_) { /* next */ }
  }
  return path.resolve(__dirname, '..', '..', '..');
}
const ROOT = resolveRepoRoot();
const AGENT_JS = path.join(ROOT, 'demo_api_ui', 'src', 'components', 'AIAgent.js');
const VERTICALS_DIR = path.join(ROOT, 'demo_api_server', 'config', 'verticals');
const TOPOLOGY = path.join(ROOT, 'scope-topology.json');

/** Handlers appear in three forms; all three are real dispatch, none preferred. */
function hasHandler(src, action) {
  return new RegExp(
    `case\\s+"${action}"|action\\s*===\\s*"${action}"|action\\.id\\s*===\\s*"${action}"`,
  ).test(src);
}

/**
 * @returns {{missingHandlers:string[], featureIssues:string[], handled:number, featureOk:number}}
 */
function auditUiDispatch() {
  const missingHandlers = [];
  const featureIssues = [];
  let handled = 0;
  let featureOk = 0;

  let src = '';
  try { src = fs.readFileSync(AGENT_JS, 'utf8'); } catch (_) { src = ''; }
  if (src) {
    for (const action of [...CLIENT_DISPATCHED_ACTIONS].sort()) {
      if (hasHandler(src, action)) handled += 1;
      else missingHandlers.push(action);
    }
  }

  let topologyTools = new Set();
  try {
    const t = JSON.parse(fs.readFileSync(TOPOLOGY, 'utf8')).tools || {};
    topologyTools = new Set(Array.isArray(t) ? t.map((x) => x && x.name).filter(Boolean) : Object.keys(t));
  } catch (_) { topologyTools = new Set(); }

  let dirs = [];
  try { dirs = fs.readdirSync(VERTICALS_DIR); } catch (_) { dirs = []; }
  for (const vertical of dirs.sort()) {
    const mpath = path.join(VERTICALS_DIR, vertical, 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch (_) { continue; }
    const chips = (((manifest.dashboard || {}).chips10) || [])
      .filter((c) => String((c && c.id) || '').endsWith('-feature'));
    if (!chips.length) continue;
    const mcpTool = (manifest.featurePage || {}).mcpTool;
    for (const chip of chips) {
      const declared = chip.tool;
      if (!mcpTool) {
        featureIssues.push(
          `${vertical}: featurePage.mcpTool missing — ${chip.id} would silently call show_mortgage (banking data on ${vertical})`,
        );
      } else if (declared && mcpTool !== declared) {
        featureIssues.push(
          `${vertical}/${chip.id}: featurePage.mcpTool=${mcpTool} but chip tool=${declared} — the UI calls the former, the catalog claims the latter`,
        );
      } else if (topologyTools.size && !topologyTools.has(mcpTool)) {
        featureIssues.push(`${vertical}: featurePage.mcpTool ${mcpTool} is not in scope-topology.json`);
      } else {
        featureOk += 1;
      }
    }
  }
  return { missingHandlers, featureIssues, handled, featureOk };
}

const uiDispatch = {
  id: 'ui.dispatch_coverage',
  name: 'Client-dispatched chips are wired',
  category: 'Use cases',
  severity: 'blocking',
  async run() {
    const { missingHandlers, featureIssues, handled, featureOk } = auditUiDispatch();
    const total = CLIENT_DISPATCHED_ACTIONS.size;

    // Zero evidence is NOT a pass. The first live run of this check reported
    // "0/13 client-dispatched actions have a UI handler" as PASS, because inside
    // the container demo_api_ui/ is not under __dirname so it read nothing and
    // found nothing to complain about. A check that goes green without reading
    // anything is worse than no check — it is the exact silent-pass shape this
    // check exists to catch elsewhere.
    if (handled === 0 || featureOk + featureIssues.length === 0) {
      return {
        status: 'warn',
        detail:
          'Could not read the UI sources from here, so nothing was verified '
          + `(searched ${ROOT}). handled=${handled}, feature chips seen=${featureOk + featureIssues.length}.`,
        meta: { handled, featureOk, root: ROOT },
        nextAction:
          'Run this where the repo is present — the host, or a container with the '
          + 'checkout bind-mounted. scripts/preflight-demo.sh check 6 asserts the same thing.',
      };
    }

    if (missingHandlers.length || featureIssues.length) {
      const parts = [];
      if (missingHandlers.length) {
        parts.push(`no UI handler for: ${missingHandlers.join(', ')}`);
      }
      if (featureIssues.length) parts.push(featureIssues.join(' | '));
      return {
        status: 'fail',
        detail: parts.join(' — '),
        meta: { missingHandlers, featureIssues, handled, featureOk },
        nextAction:
          'A client-dispatched chip with no handler dead-ends in the UI. '
          + 'A featurePage.mcpTool mismatch serves another vertical\'s data with HTTP 200.',
      };
    }
    return {
      status: 'pass',
      detail:
        `${handled}/${total} client-dispatched actions have a UI handler; `
        + `${featureOk} vertical(s): featurePage.mcpTool == chip tool, in topology.`,
      meta: { handled, featureOk },
    };
  },
};

register(uiDispatch);
module.exports = { uiDispatch, auditUiDispatch };
