'use strict';

/**
 * Vertical consistency guard.
 *
 * For every vertical whose manifest declares a `featurePage`, the feature scope
 * and feature tool must be present everywhere the API-key feature-page path
 * needs them, or the page silently fails with `invalid_scope` / 403 at runtime.
 * This guard turns that silent failure into a loud boot-time error — the
 * permanent version of the cross-file consistency check used when wiring a
 * vertical by hand.
 *
 * Single source of truth: each vertical's manifest (`scopes.featureScope`,
 * `featurePage.mcpTool`) + `scope-topology.json`. Mirrors startupConfigGuard.js.
 */

// Load the manifest through the shared scopeTopology service so this guard
// honors SCOPE_TOPOLOGY_PATH. A repo-root-relative require() resolves to the
// stale copy baked into the Docker image (/scope-topology.json) instead of
// the live directory-mounted file — the guard then FATALs the BFF on drift
// the real manifest doesn't have.
const { _manifest: loadTopology } = require('./scopeTopology');

const USER_APP = 'Super Banking User App';
const API_RES = 'Super Banking API';
const MCP_SERVER_RES = 'Super Banking MCP Server';
const MCP_GATEWAY_RES = 'Super Banking MCP Gateway';

function resourceAllScopes(topology, resourceName) {
  const r = topology.resources[resourceName] || {};
  return [...(r.scopes || []), ...(r.mirroredScopes || [])];
}

/**
 * Collect consistency issues. Pure — no I/O beyond require(). Returns string[].
 */
function collectIssues() {
  const topology = loadTopology();
  // eslint-disable-next-line global-require
  const { verticalManifest } = require('./verticalManifest');

  // Ensure manifests are loaded — otherwise list() is empty and the guard
  // would vacuously "pass" (a false-clean). init() is idempotent.
  try { verticalManifest.init(); } catch (_e) { /* already initialized */ }

  const issues = [];
  const userGrant = topology.apps[USER_APP]?.grantedScopes || [];
  const apiScopes = resourceAllScopes(topology, API_RES);
  const mcpServerScopes = resourceAllScopes(topology, MCP_SERVER_RES);
  const mcpGatewayScopes = resourceAllScopes(topology, MCP_GATEWAY_RES);

  for (const summary of verticalManifest.list()) {
    const id = summary.id;
    let m;
    try {
      m = verticalManifest.resolver.resolve(id);
    } catch (e) {
      issues.push(`vertical "${id}": manifest failed to resolve (${e.message})`);
      continue;
    }
    const fp = m && m.featurePage;
    if (!fp) continue; // no feature page → nothing to check

    const scope = m.scopes && m.scopes.featureScope;
    const tool = fp.mcpTool;

    if (!scope) {
      issues.push(`vertical "${id}": featurePage declared but scopes.featureScope is missing`);
      continue;
    }
    if (!tool) {
      issues.push(`vertical "${id}": featurePage declared but featurePage.mcpTool is missing`);
      continue;
    }

    if (!topology.scopes[scope]) issues.push(`vertical "${id}": scope "${scope}" missing from scope-topology.json scopes`);
    if (!apiScopes.includes(scope)) issues.push(`vertical "${id}": scope "${scope}" missing from resources["${API_RES}"].scopes`);
    if (!mcpServerScopes.includes(scope)) issues.push(`vertical "${id}": scope "${scope}" missing from resources["${MCP_SERVER_RES}"].mirroredScopes`);
    if (!mcpGatewayScopes.includes(scope)) issues.push(`vertical "${id}": scope "${scope}" missing from resources["${MCP_GATEWAY_RES}"].mirroredScopes (gateway checks scope before the RFC 8693 swap)`);
    if (!userGrant.includes(scope)) issues.push(`vertical "${id}": scope "${scope}" missing from apps["${USER_APP}"].grantedScopes`);

    const toolEntry = topology.tools[tool];
    if (!toolEntry) {
      issues.push(`vertical "${id}": feature tool "${tool}" missing from scope-topology.json tools`);
    } else {
      if (!(toolEntry.requiredScopes || []).includes(scope)) issues.push(`vertical "${id}": tool "${tool}" requiredScopes does not include "${scope}"`);
      if (toolEntry.surface !== 'gateway') issues.push(`vertical "${id}": tool "${tool}" surface is "${toolEntry.surface}" (expected "gateway")`);
    }
  }
  return issues;
}

/**
 * Run the guard. Logs a one-line OK, or reports issues and (by default) exits.
 * Set VERTICAL_GUARD=warn to downgrade to a warning. Never throws to the caller.
 */
function runVerticalConsistencyGuard() {
  let issues;
  try {
    issues = collectIssues();
  } catch (err) {
    console.warn(`[VERTICAL GUARD] skipped — could not load source of truth: ${err.message}`);
    return;
  }

  if (issues.length === 0) {
    console.log('[VERTICAL GUARD] OK — every featurePage vertical is consistent across scope-topology.json.');
    return;
  }

  const report = `[VERTICAL GUARD] ${issues.length} feature-page consistency issue(s):\n  - ${issues.join('\n  - ')}`;
  if (String(process.env.VERTICAL_GUARD || '').toLowerCase() === 'warn') {
    console.warn(`[WARN] ${report}\n  (VERTICAL_GUARD=warn — continuing anyway)`);
    return;
  }
  console.error(`[FATAL] ${report}\n  A feature page will 403/invalid_scope until fixed. Add the scope/tool to scope-topology.json (see the add-vertical skill, Step 6), or set VERTICAL_GUARD=warn to override.`);
  process.exit(1);
}

module.exports = { runVerticalConsistencyGuard, collectIssues };
