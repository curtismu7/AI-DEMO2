#!/usr/bin/env node
/*
 * gen-scope-topology.js — derive a vertical's feature-page scope + tool entries
 * in scope-topology.json from its manifest, so adding a vertical needs NO
 * hand-edits to the scope SoT.
 *
 * For every vertical whose manifest declares a `featurePage`, this ensures the
 * feature scope (`scopes.featureScope`, e.g. "permits:read") exists in:
 *   - scopes{}                                  (the scope definition)
 *   - resources["Super Banking API"].scopes
 *   - resources["Super Banking MCP Server"].mirroredScopes
 *   - resources["Super Banking MCP Gateway"].mirroredScopes   (T-10: gateway checks scope before the RFC 8693 swap)
 *   - apps["Super Banking User App"].grantedScopes
 * and that the feature tool (`featurePage.mcpTool`, e.g. "show_permit") exists in:
 *   - tools{}  with requiredScopes:[scope], surface:"gateway"
 *
 * Usage:
 *   node scripts/gen-scope-topology.js check      # exit 1 if scope-topology.json drifts from the manifests (CI / pre-commit)
 *   node scripts/gen-scope-topology.js generate   # inject any missing feature entries (add-only; never removes/reorders non-feature content)
 *
 * Add-only and idempotent: it only INSERTS missing feature scopes/tools/array
 * members. It never touches admin/infra/A2A scopes or any non-feature content.
 */

const fs = require('node:fs');
const path = require('node:path');
const { stringifyTopology } = require('./lib/stringify-topology');

const ROOT = path.join(__dirname, '..');
const TOPOLOGY_PATH = path.join(ROOT, 'scope-topology.json');

const API_RES = 'Super Banking API';
const MCP_SERVER_RES = 'Super Banking MCP Server';
const MCP_GATEWAY_RES = 'Super Banking MCP Gateway';
const USER_APP = 'Super Banking User App';

/** Read every vertical manifest's feature-page scope+tool via the BFF loader. */
function featureEntriesFromManifests() {
  // eslint-disable-next-line global-require
  const { verticalManifest } = require('../demo_api_server/services/verticalManifest');
  verticalManifest.init();
  const out = [];
  for (const summary of verticalManifest.list()) {
    let m;
    try { m = verticalManifest.resolver.resolve(summary.id); } catch (_e) { continue; }
    const fp = m && m.featurePage;
    const scope = m && m.scopes && m.scopes.featureScope;
    if (!fp || !fp.mcpTool || !scope) continue;
    out.push({
      vertical: summary.id,
      scope,
      tool: fp.mcpTool,
      description: `Read ${fp.pageTitle || summary.id} data (${summary.id} vertical)`,
    });
  }
  return out;
}

/** Return the list of (path, mutation) needed to make `topo` consistent. */
function planChanges(topo, entries) {
  const changes = [];
  const ensureScope = (scope, description) => {
    if (!topo.scopes[scope]) {
      changes.push(`scopes["${scope}"] (definition)`);
    }
  };
  const ensureInArray = (arr, scope, label) => {
    if (!arr.includes(scope)) changes.push(`${label} += "${scope}"`);
  };
  for (const e of entries) {
    ensureScope(e.scope, e.description);
    ensureInArray(topo.resources[API_RES].scopes, e.scope, `resources["${API_RES}"].scopes`);
    ensureInArray(topo.resources[MCP_SERVER_RES].mirroredScopes, e.scope, `resources["${MCP_SERVER_RES}"].mirroredScopes`);
    ensureInArray(topo.resources[MCP_GATEWAY_RES].mirroredScopes, e.scope, `resources["${MCP_GATEWAY_RES}"].mirroredScopes`);
    ensureInArray(topo.apps[USER_APP].grantedScopes, e.scope, `apps["${USER_APP}"].grantedScopes`);
    if (!topo.tools[e.tool]) changes.push(`tools["${e.tool}"] (requiredScopes:["${e.scope}"], surface:"gateway")`);
  }
  return changes;
}

/** Apply the add-only mutations in place. */
function applyChanges(topo, entries) {
  const addToArr = (arr, scope) => { if (!arr.includes(scope)) arr.push(scope); };
  for (const e of entries) {
    if (!topo.scopes[e.scope]) {
      topo.scopes[e.scope] = { description: e.description, riskLevel: 'low', resource: API_RES, category: 'feature' };
    }
    addToArr(topo.resources[API_RES].scopes, e.scope);
    addToArr(topo.resources[MCP_SERVER_RES].mirroredScopes, e.scope);
    addToArr(topo.resources[MCP_GATEWAY_RES].mirroredScopes, e.scope);
    addToArr(topo.apps[USER_APP].grantedScopes, e.scope);
    if (!topo.tools[e.tool]) {
      topo.tools[e.tool] = { requiredScopes: [e.scope], surface: 'gateway' };
    }
  }
}

function main() {
  const mode = process.argv[2] || 'check';
  const topo = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, 'utf8'));
  const entries = featureEntriesFromManifests();
  const changes = planChanges(topo, entries);

  if (mode === 'check') {
    if (changes.length === 0) {
      console.log(`[OK] scope-topology.json carries all ${entries.length} featurePage scopes/tools.`);
      return;
    }
    console.error(`[FAIL] scope-topology.json is missing ${changes.length} feature entr(ies):\n  - ${changes.join('\n  - ')}\n  Run: node scripts/gen-scope-topology.js generate`);
    process.exit(1);
  }

  if (mode === 'generate') {
    if (changes.length === 0) {
      console.log('[OK] Nothing to add — scope-topology.json already consistent. (Not rewriting; no churn.)');
      return;
    }
    applyChanges(topo, entries);
    fs.writeFileSync(TOPOLOGY_PATH, `${stringifyTopology(topo)}\n`);
    console.log(`[OK] Injected ${changes.length} feature entr(ies) into scope-topology.json:\n  - ${changes.join('\n  - ')}`);
    return;
  }

  console.error(`Unknown mode "${mode}". Use "check" or "generate".`);
  process.exit(2);
}

main();
