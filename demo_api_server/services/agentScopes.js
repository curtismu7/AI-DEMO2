'use strict';

/**
 * resolveAgentScopes — the write-toggle scope resolver for the agent token.
 *
 * The in-agent scope picker is a write toggle ("Allow write actions: on/off").
 * Because the SoT uses vertical-specific READ scopes (healthcare reads need
 * `records:read`, sporting-goods `gear:read`, banking/retail `read`), a literal
 * ['read'] set would wrongly deny non-banking read tools. Instead we always
 * grant the active vertical's read scopes — derived from scope-topology.json ×
 * the vertical's tool list — and add the vertical's write-ish scopes (`write`,
 * and `transfer` for banking) only when the toggle is on.
 *
 * Sources of truth (no duplication):
 *   - services/scopeTopology.js: the shared accessor over scope-topology.json
 *     (toolScopes(name) — validated loader, ['read'] fallback for unknown tools)
 *   - verticalManifest.plugins.get(id).getTools(): the vertical's tool names
 */

const scopeTopology = require('./scopeTopology');
const { verticalManifest } = require('./verticalManifest');

// Write-ish scopes are the ones gated behind the write toggle. Derived from the
// SoT's per-scope riskLevel (high/critical = write/dangerous: write, transfer,
// admin:write, admin:delete, users:manage; low/medium = read/invoke) so a new
// write scope (e.g. records:write) is gated automatically and read-ish admin
// scopes (admin:read, users:read = medium) are NOT mis-gated. Falls back to the
// name heuristic only when a scope carries no SoT metadata.
function isWriteIsh(scope) {
  const meta = scopeTopology.scopeMeta(scope);
  if (meta && meta.riskLevel) {
    return meta.riskLevel === 'high' || meta.riskLevel === 'critical';
  }
  return scope === 'write' || scope === 'transfer' || scope.startsWith('admin');
}

/**
 * @param {string} vertical   active vertical id (e.g. 'healthcare', 'banking')
 * @param {boolean} allowWrite write toggle — add the vertical's write scopes
 * @returns {string[]} the scope set to request for the agent token
 */
function resolveAgentScopes(vertical, allowWrite) {
  const readScopes = new Set();
  const writeScopes = new Set();

  const toolNames = new Set();
  try {
    const plugin = verticalManifest.plugins.get(vertical);
    if (plugin && typeof plugin.getTools === 'function') {
      for (const t of plugin.getTools()) {
        if (t && t.name) toolNames.add(t.name);
      }
    }
    // Also collect the tools the dashboard chips declare. Some chip-backed tools
    // (e.g. banking's show_mortgage — an api_key-disposition tool, not in the
    // core MCP registry) aren't in getTools() but ARE invocable from a chip, so
    // their scopes (e.g. mortgage:read) must be requested or the chip is gated
    // permanently denied. The chip surface is the authoritative invocation set.
    // Read the STATIC manifest via the loader (the resolver is session-scoped
    // and returns null without a request context). The loader wraps the manifest
    // as { manifest, mockData }.
    const loaded = verticalManifest.loader.get(vertical);
    const staticManifest = loaded && (loaded.manifest || loaded);
    const chips = (staticManifest && staticManifest.dashboard && staticManifest.dashboard.chips10) || [];
    for (const c of chips) {
      if (c && c.tool) toolNames.add(c.tool);
    }
  } catch { /* unknown vertical — fall through to base scopes below */ }

  for (const name of toolNames) {
    for (const s of scopeTopology.toolScopes(name)) {
      if (isWriteIsh(s)) writeScopes.add(s);
      else readScopes.add(s);
    }
  }

  // Base read scope so an unknown/empty vertical still yields a usable token,
  // and mcp:invoke so the agent can always reach the gateway.
  readScopes.add('read');
  const out = new Set(readScopes);
  out.add('mcp:invoke');
  if (allowWrite) for (const s of writeScopes) out.add(s);

  return Array.from(out);
}

module.exports = { resolveAgentScopes, isWriteIsh };
