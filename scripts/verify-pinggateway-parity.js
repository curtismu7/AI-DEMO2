#!/usr/bin/env node
/*
 * verify-pinggateway-parity.js — assert the PingGateway (and Node MCP gateway)
 * config literals stay in lock-step with scope-topology.json (the SSOT).
 *
 * These layers duplicate the manifest's resource audiences and mcp:invoke scope
 * as ENV literals (PingGateway reads them via ${env['..']} property substitution;
 * the Node gateway via process.env). Nothing tied them to the manifest, so a
 * rename of a resource uri or scope in scope-topology.json could silently diverge
 * from what the gateways enforce. This check closes that gap.
 *
 * Verifies, against demo_api_server/services/scopeTopology (the SSOT accessor):
 *   - audience env literals  == the matching resource `uri`   (compared by host,
 *     so a bare audience and an https:// URL form reconcile)
 *   - scope env literals     normalize (via aliases{}) to a DECLARED scope
 *   - the config.json inbound-scope fallback literal is a declared scope
 *
 * Usage:  node scripts/verify-pinggateway-parity.js
 * Exit:   0 = in sync; 1 = drift (prints each mismatch); 2 = usage/parse error.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const topo = require(path.join(ROOT, 'demo_api_server/services/scopeTopology'));

// ── What to check ────────────────────────────────────────────────────────────
// Audience env literals that MUST equal a manifest resource uri (by host).
const AUDIENCE_CHECKS = [
  { file: 'ping-gateway/.env.example', key: 'PG_GATEWAY_RESOURCE_URI', resource: 'Super Banking MCP Gateway' },
  { file: 'ping-gateway/.env.example', key: 'PG_OLB_RESOURCE_URI', resource: 'Super Banking MCP Server' },
  { file: 'ping-gateway/.env.example', key: 'PG_INVEST_RESOURCE_URI', resource: 'Super Banking MCP Invest' },
  { file: 'demo_mcp_gateway/.env.example', key: 'MCP_GW_RESOURCE_URI', resource: 'Super Banking MCP Gateway' },
  { file: 'demo_mcp_gateway/.env.example', key: 'MCP_OLB_RESOURCE_URI', resource: 'Super Banking MCP Server' },
  { file: 'demo_mcp_gateway/.env.example', key: 'MCP_INVEST_RESOURCE_URI', resource: 'Super Banking MCP Invest' },
];

// Scope env literals that MUST normalize (via aliases{}) to a declared scope.
const SCOPE_CHECKS = [
  { file: 'ping-gateway/.env.example', key: 'PG_INBOUND_SCOPE' },
  { file: 'ping-gateway/.env.example', key: 'PG_OLB_SCOPE' },
  { file: 'ping-gateway/.env.example', key: 'PG_INVEST_SCOPE' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Reduce an audience/URL to its bare host so 'x.ping.demo' and
 *  'https://x.ping.demo:3006/mcp' compare equal. */
function hostOf(value) {
  return String(value)
    .replace(/^[a-z]+:\/\//i, '') // scheme
    .replace(/[:/].*$/, ''); // :port and /path
}

/** Parse KEY=VALUE lines from an env file into a Map. Ignores comments/blanks. */
function parseEnv(absPath) {
  const map = new Map();
  const text = fs.readFileSync(absPath, 'utf8');
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return map;
}

const problems = [];
const envCache = new Map();
function envFor(file) {
  if (!envCache.has(file)) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      problems.push(`${file}: file not found (cannot verify PingGateway parity)`);
      envCache.set(file, null);
    } else {
      envCache.set(file, parseEnv(abs));
    }
  }
  return envCache.get(file);
}

const declared = new Set(topo.allScopes());

// ── Audience checks ──────────────────────────────────────────────────────────
for (const c of AUDIENCE_CHECKS) {
  const env = envFor(c.file);
  if (!env) continue;
  const val = env.get(c.key);
  const expected = topo.resourceUri(c.resource);
  if (val === undefined) {
    problems.push(`${c.file}: ${c.key} missing (expected host ${expected} for "${c.resource}")`);
    continue;
  }
  if (hostOf(val) !== hostOf(expected)) {
    problems.push(`${c.file}: ${c.key}=${val} (host ${hostOf(val)}) != resource "${c.resource}".uri=${expected}`);
  }
}

// ── Scope env checks ─────────────────────────────────────────────────────────
for (const c of SCOPE_CHECKS) {
  const env = envFor(c.file);
  if (!env) continue;
  const val = env.get(c.key);
  if (val === undefined) {
    problems.push(`${c.file}: ${c.key} missing (expected a scope declared in scope-topology.json)`);
    continue;
  }
  const norm = topo.normalizeScope(val);
  if (!declared.has(norm)) {
    problems.push(`${c.file}: ${c.key}=${val} normalizes to "${norm}", which is NOT a declared scope (add it to scopes{} or fix aliases{})`);
  }
}

// ── config.json inbound-scope fallback literal ───────────────────────────────
const CONFIG_JSON = 'ping-gateway/config/config.json';
const cfgAbs = path.join(ROOT, CONFIG_JSON);
if (!fs.existsSync(cfgAbs)) {
  problems.push(`${CONFIG_JSON}: file not found`);
} else {
  const cfgText = fs.readFileSync(cfgAbs, 'utf8');
  // e.g. ${empty env['PG_INBOUND_SCOPE'] ? 'mcp:invoke' : env['PG_INBOUND_SCOPE']}
  const re = /env\['(PG_[A-Z_]*SCOPE)'\]\s*\?\s*'([^']+)'/g;
  const matches = [...cfgText.matchAll(re)];
  for (const m of matches) {
    const norm = topo.normalizeScope(m[2]);
    if (!declared.has(norm)) {
      problems.push(`${CONFIG_JSON}: fallback for ${m[1]} = '${m[2]}' normalizes to "${norm}", not a declared scope`);
    }
  }
  if (matches.length === 0) {
    // Not fatal — the config may not embed a literal fallback — but note it so a
    // silent removal of the scope enforcement is visible.
    console.log(`[info] ${CONFIG_JSON}: no inbound-scope fallback literal found (nothing to verify there)`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  const n = AUDIENCE_CHECKS.length + SCOPE_CHECKS.length;
  console.log(`[OK] PingGateway config matches scope-topology.json (${n} literal(s) verified).`);
  process.exit(0);
}
console.error(`[FAIL] PingGateway config drifts from scope-topology.json (${problems.length} issue(s)):`);
for (const p of problems) console.error(`  - ${p}`);
console.error('  Fix the env/config literal, or the manifest, so they agree.');
process.exit(1);
