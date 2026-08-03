#!/usr/bin/env node
/*
 * gen-vertical-tools.js — derive the generic vertical ACTION tools (the bulk of
 * each vertical's chips) for BOTH downstream registries from the single runtime
 * source of truth: each vertical plugin's `config/verticals/<id>/tools.js`.
 *
 * Why: the MCP server's `VERTICAL_TOOLS` list (verticalHandlers.ts) was a HAND
 * list "keep in sync with tools.js" — it drifted badly (25 registered vs ~150
 * plugin tools), so newly-added verticals and intent-pack expansions returned
 * "Unknown tool" at the gateway/MCP server. This generator removes the manual
 * sync entirely.
 *
 * It writes two outputs from the plugins:
 *   1. oauth-mcp/src/tools/handlers/verticalTools.generated.ts
 *      — the typed VERTICAL_TOOLS array the MCP server exposes + relays to the BFF.
 *   2. scope-topology.json  tools{}  entries (ADD-ONLY)
 *      — { requiredScopes, surface:"gateway", challengeType? } so the gateway can
 *        authorize each tool. Never removes/reorders existing content.
 *
 * Curation (matches what the hand list curated):
 *   - Banking is EXCLUDED — its tools are core, registered directly in
 *     BankingToolRegistry, not relayed through the generic vertical handler.
 *   - Per vertical, the featurePage tool (manifest.featurePage.mcpTool, e.g.
 *     show_work_order) and the demo tools (api_key_demo, dual_token_demo) are
 *     EXCLUDED — they are registered on their own (api-key) path.
 *   - Everything else a plugin's getTools() returns is INCLUDED (incl. sensitive_*).
 *
 * Usage:
 *   node scripts/gen-vertical-tools.js check      # exit 1 if either output drifts from the plugins (CI)
 *   node scripts/gen-vertical-tools.js generate   # rewrite generated.ts + inject missing scope-topology tools
 */

const fs = require('node:fs');
const path = require('node:path');
const { stringifyTopology } = require('./lib/stringify-topology');

const ROOT = path.join(__dirname, '..');
const TOPOLOGY_PATH = path.join(ROOT, 'scope-topology.json');
// A list, not a single path: oauth-mcp used to have a duplicate tree
// (demo_mcp_server) that this generator skipped, and they drifted 6 tools apart
// with no gate able to see it. The duplicate is gone, but keeping the shape
// plural means a second tree can only ever be added by writing BOTH.
// `check` fails if ANY entry drifts.
const GENERATED_TS_PATHS = ['oauth-mcp'].map((tree) =>
  path.join(ROOT, tree, 'src', 'tools', 'handlers', 'verticalTools.generated.ts'),
);

const EXCLUDE_VERTICALS = new Set(['banking']);
const EXCLUDE_TOOLS = new Set(['api_key_demo', 'dual_token_demo']);

const isWriteScope = (scopes = []) =>
  scopes.some((s) => s === 'write' || /:(write|delete|manage)$/.test(s));

/**
 * Enumerate every generic vertical action tool from the plugins, applying the
 * curation rules. Returns [{ vertical, name, scope, requiredScopes, inputSchema?, challengeType? }],
 * sorted by (vertical, name) for deterministic output.
 */
function verticalToolsFromPlugins() {
  // eslint-disable-next-line global-require
  const { verticalManifest } = require('../demo_api_server/services/verticalManifest');
  verticalManifest.init();
  const out = [];
  for (const summary of verticalManifest.list()) {
    if (EXCLUDE_VERTICALS.has(summary.id)) continue;
    const plugin = verticalManifest.plugins.get(summary.id);
    if (!plugin || typeof plugin.getTools !== 'function') continue;

    let featureTool = null;
    try { featureTool = verticalManifest.resolver.resolve(summary.id)?.featurePage?.mcpTool || null; } catch (_e) { /* no manifest */ }

    for (const t of plugin.getTools()) {
      if (!t || !t.name) continue;
      if (t.name === featureTool || EXCLUDE_TOOLS.has(t.name)) continue;
      const scopes = Array.isArray(t.scopes) && t.scopes.length ? t.scopes : ['read'];
      const props = t.inputSchema && t.inputSchema.properties;
      const hasParams = props && Object.keys(props).length > 0;
      const entry = {
        vertical: summary.id,
        name: t.name,
        scope: isWriteScope(scopes) ? 'write' : 'read',
        requiredScopes: scopes,
      };
      if (hasParams) {
        entry.inputSchema = {
          type: 'object',
          properties: props,
          required: Array.isArray(t.inputSchema.required) ? t.inputSchema.required : [],
          additionalProperties: false,
        };
      }
      const challengeType = t.authz && t.authz.stepUp ? 'step_up' : (t.authz && t.authz.consent ? 'consent' : null);
      if (challengeType) entry.challengeType = challengeType;
      out.push(entry);
    }
  }
  return dedupeByName(out);
}

/**
 * MCP tool names are globally unique, so a name defined by >1 vertical collapses
 * to ONE registry entry. Such a shared tool is emitted CROSS-VERTICAL (no
 * `vertical` tag) so the gateway's per-vertical tools/list filter always passes
 * it for every vertical that legitimately has it — the BFF still runs the ACTIVE
 * vertical's implementation by name. A uniquely-named tool keeps its vertical tag
 * so AllowedVertical correctly hides it from foreign verticals.
 */
function dedupeByName(rows) {
  const byName = new Map();
  for (const r of rows) {
    const ex = byName.get(r.name);
    if (!ex) { byName.set(r.name, { ...r, verticals: new Set([r.vertical]) }); continue; }
    ex.verticals.add(r.vertical);
    if (r.scope === 'write') ex.scope = 'write';            // most-restrictive scope wins
    if (!ex.inputSchema && r.inputSchema) ex.inputSchema = r.inputSchema;
    if (!ex.challengeType && r.challengeType) ex.challengeType = r.challengeType;
  }
  const deduped = [...byName.values()].map((e) => {
    const out = { name: e.name, scope: e.scope, requiredScopes: e.requiredScopes };
    if (e.verticals.size === 1) out.vertical = [...e.verticals][0]; // shared → cross-vertical (omit)
    if (e.inputSchema) out.inputSchema = e.inputSchema;
    if (e.challengeType) out.challengeType = e.challengeType;
    return out;
  });
  deduped.sort((a, b) => {
    const va = a.vertical || '~'; const vb = b.vertical || '~'; // cross-vertical entries sort last
    return va === vb ? a.name.localeCompare(b.name) : va.localeCompare(vb);
  });
  return deduped;
}

// ── Output 1: the MCP server's generated VERTICAL_TOOLS array ──────────────────

function renderGeneratedTs(entries, topo) {
  const lines = entries.map((e) => {
    const base = { name: e.name, scope: e.scope };
    if (e.vertical) base.vertical = e.vertical; // omitted = cross-vertical (shared name)
    // a2aDelegatedScope is a MANUAL scope-topology field (the specialist's
    // per-vertical Exchange #2 scope — PingOne scope-name uniqueness). Carry it
    // into the MCP server registry so the scope gate can accept it as an
    // alternative to the coarse scope on A2A-delegated calls.
    const delegated = topo && topo.tools[e.name] && topo.tools[e.name].a2aDelegatedScope;
    if (delegated) base.a2aDelegatedScope = delegated;
    if (e.inputSchema) base.inputSchema = e.inputSchema;
    return `  ${JSON.stringify(base)},`;
  });
  return [
    '// AUTO-GENERATED by scripts/gen-vertical-tools.js — DO NOT EDIT BY HAND.',
    '// Source of truth: each vertical plugin\'s config/verticals/<id>/tools.js',
    '// (+ scope-topology.json a2aDelegatedScope for A2A-delegated sensitive tools).',
    '// Regenerate: cd demo_api_server && npm run verticals:gen',
    "import type { JSONSchema } from '../../interfaces/mcp';",
    '',
    'export type VerticalToolDef = { name: string; scope: \'read\' | \'write\'; vertical?: string; a2aDelegatedScope?: string; inputSchema?: JSONSchema };',
    '',
    'export const GENERATED_VERTICAL_TOOLS: VerticalToolDef[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

// ── Output 2: scope-topology.json tools{} entries ─────────────────────────────

/** Scope arrays are unordered sets — compare members, not position, to avoid order-only churn. */
function sameScopes(a, b) {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
}

/**
 * Plan scope-topology changes for the generator-owned fields, both fully derived
 * from the plugin's tools.js and RECONCILED (not just added):
 *   - requiredScopes — from the tool's scopes (compared as a set).
 *   - challengeType  — from the tool's authz, but ONLY when the plugin implies one
 *     (stepUp/consent). A plugin that implies NO challengeType never removes an
 *     existing one, so a manual challengeType (e.g. book_appointment's consent,
 *     not derivable from authz) is preserved. `surface` and the `a2aDelegated*`
 *     flags on sensitive_* tools are never touched.
 */
function planTopologyChanges(topo, entries) {
  const missing = [];
  const scopeDrift = [];
  const challengeDrift = [];
  for (const e of entries) {
    const cur = topo.tools[e.name];
    if (!cur) { missing.push(e.name); continue; }
    if (!sameScopes(cur.requiredScopes, e.requiredScopes)) {
      scopeDrift.push(`${e.name}: ${JSON.stringify(cur.requiredScopes)} -> ${JSON.stringify(e.requiredScopes)}`);
    }
    if (e.challengeType && cur.challengeType !== e.challengeType) {
      challengeDrift.push(`${e.name}: ${cur.challengeType || 'none'} -> ${e.challengeType}`);
    }
  }
  return { missing, scopeDrift, challengeDrift };
}

function applyTopologyChanges(topo, entries) {
  for (const e of entries) {
    const cur = topo.tools[e.name];
    if (!cur) {
      const entry = { requiredScopes: e.requiredScopes, surface: 'gateway' };
      if (e.challengeType) entry.challengeType = e.challengeType;
      topo.tools[e.name] = entry;
      continue;
    }
    // Reconcile only the generator-owned fields in place. requiredScopes is set
    // only when the members differ (preserve any hand-ordering). challengeType is
    // set/updated only when the plugin implies one — never removed, so a manual
    // challengeType survives. surface and a2aDelegated* are preserved.
    if (!sameScopes(cur.requiredScopes, e.requiredScopes)) cur.requiredScopes = e.requiredScopes;
    if (e.challengeType && cur.challengeType !== e.challengeType) cur.challengeType = e.challengeType;
  }
}

function main() {
  const mode = process.argv[2] || 'check';
  const entries = verticalToolsFromPlugins();
  const topo = JSON.parse(fs.readFileSync(TOPOLOGY_PATH, 'utf8'));

  const wantTs = renderGeneratedTs(entries, topo);
  const staleTsPaths = GENERATED_TS_PATHS.filter((p) => {
    const haveTs = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    return wantTs !== haveTs;
  });
  const { missing, scopeDrift, challengeDrift } = planTopologyChanges(topo, entries);

  if (mode === 'check') {
    if (!staleTsPaths.length && missing.length === 0 && scopeDrift.length === 0 && challengeDrift.length === 0) {
      console.log(`[OK] ${entries.length} generic vertical tools registered + scope-equal in ${GENERATED_TS_PATHS.length} verticalTools.generated.ts + scope-topology.json.`);
      return;
    }
    for (const p of staleTsPaths) {
      console.error(`[FAIL] ${path.relative(ROOT, p)} is stale (plugins changed, or the duplicate MCP server trees drifted).`);
    }
    if (missing.length) console.error(`[FAIL] scope-topology.json missing ${missing.length} vertical tool(s): ${missing.join(', ')}`);
    if (scopeDrift.length) console.error(`[FAIL] scope-topology.json requiredScopes drift (${scopeDrift.length}):\n  - ${scopeDrift.join('\n  - ')}`);
    if (challengeDrift.length) console.error(`[FAIL] scope-topology.json challengeType drift (${challengeDrift.length}):\n  - ${challengeDrift.join('\n  - ')}`);
    console.error('  Run: cd demo_api_server && npm run verticals:gen');
    process.exit(1);
  }

  if (mode === 'generate') {
    for (const p of GENERATED_TS_PATHS) fs.writeFileSync(p, wantTs);
    if (missing.length || scopeDrift.length || challengeDrift.length) {
      applyTopologyChanges(topo, entries);
      fs.writeFileSync(TOPOLOGY_PATH, `${stringifyTopology(topo)}\n`);
    }
    console.log(`[OK] Wrote ${entries.length} tools to ${GENERATED_TS_PATHS.length} verticalTools.generated.ts; added ${missing.length}, reconciled ${scopeDrift.length} scope(s) + ${challengeDrift.length} challengeType(s) in scope-topology.json.`);
    return;
  }

  console.error(`Unknown mode "${mode}". Use "check" or "generate".`);
  process.exit(2);
}

main();
