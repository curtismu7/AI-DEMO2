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
 *   - PG_GATEWAY_RESOURCE_ID == deployment.pingGatewayResourceUri (EXACT, incl.
 *     port — guards the :3006/:3036 McpProtectionFilter-resourceId port typo that
 *     a host-only comparison would miss)
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
    map.set(line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim()));
  }
  return map;
}

/**
 * Strip one matching pair of surrounding quotes. Quoting is legal in a .env
 * (`PG_OLB_SCOPE="read mcp:invoke"`) and dotenv strips it, so a parser that
 * keeps the quotes reports every token of a quoted scope LIST as undeclared
 * ('"read', 'mcp:invoke"'). That fires only on real .env files, which are
 * gitignored — so it never reproduced in CI and only ever broke local runs.
 */
function unquote(value) {
  const m = /^(['"])([\s\S]*)\1$/.exec(value);
  return m ? m[2] : value;
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

// ── PG_GATEWAY_RESOURCE_ID exact-match check ─────────────────────────────────
// PG_GATEWAY_RESOURCE_ID is the McpProtectionFilter.resourceId — the aud the
// inbound MCP token MUST carry. It is a DISTINCT identifier from
// PG_GATEWAY_RESOURCE_URI (checked above) and lives in the SoT's deployment block
// (deployment.environments.local.pingGatewayResourceUri), not provisioning.resources.
// Compare the FULL URI incl. port: the historical app-breaking drift was a
// :3006 vs :3036 port typo, which the host-only hostOf() comparison used above
// would silently treat as equal — so this check is intentionally exact.
{
  const env = envFor('ping-gateway/.env.example');
  if (env) {
    const rawTopo = JSON.parse(fs.readFileSync(path.join(ROOT, 'scope-topology.json'), 'utf8'));
    const expected = rawTopo.deployment?.environments?.local?.pingGatewayResourceUri;
    const val = env.get('PG_GATEWAY_RESOURCE_ID');
    if (!expected) {
      problems.push('scope-topology.json: deployment.environments.local.pingGatewayResourceUri missing (cannot verify PG_GATEWAY_RESOURCE_ID)');
    } else if (val === undefined) {
      problems.push(`ping-gateway/.env.example: PG_GATEWAY_RESOURCE_ID missing (expected exactly ${expected})`);
    } else if (val !== expected) {
      problems.push(`ping-gateway/.env.example: PG_GATEWAY_RESOURCE_ID=${val} != SoT deployment.pingGatewayResourceUri=${expected} (EXACT match required incl. port — a :3006/:3036 typo is the exact drift this guards)`);
    }
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
  // PG_*_SCOPE is an OAuth scope value — a space-delimited LIST (e.g. the
  // generator emits "read mcp:invoke invest:read"). Validate that EVERY token
  // normalizes (via aliases{}) to a declared scope, not the value as one string.
  for (const tok of String(val).trim().split(/\s+/).filter(Boolean)) {
    const norm = topo.normalizeScope(tok);
    if (!declared.has(norm)) {
      problems.push(`${c.file}: ${c.key}=${val} contains "${tok}" which normalizes to "${norm}", NOT a declared scope (add it to scopes{} or fix aliases{})`);
    }
  }
}

// ── Real .env scope drift (skip-if-absent) ───────────────────────────────────
// The checks above read the committed .env.example. The gateway actually loads
// the sibling real .env, which is per-machine and gitignored — so a value like
// PG_OLB_SCOPE=server:mcp:invoke can drift there undetected. When a real .env
// exists next to a checked .env.example, hold its scope keys to the same
// normalize-to-declared rule. Absent (CI, fresh clone) → skipped, not failed.
for (const c of SCOPE_CHECKS) {
  const realFile = c.file.replace(/\.env\.example$/, '.env');
  if (realFile === c.file) continue;
  const abs = path.join(ROOT, realFile);
  if (!fs.existsSync(abs)) continue;
  const val = parseEnv(abs).get(c.key);
  if (val === undefined) continue; // key not overridden in the real .env — fine
  // Same space-delimited scope-list rule as the .env.example loop above.
  for (const tok of String(val).trim().split(/\s+/).filter(Boolean)) {
    const norm = topo.normalizeScope(tok);
    if (!declared.has(norm)) {
      problems.push(`${realFile}: ${c.key}=${val} contains "${tok}" which normalizes to "${norm}", NOT a declared scope (real .env drifted from ${c.file}; fix the value or add an alias in scope-topology.json)`);
    }
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
  const n = AUDIENCE_CHECKS.length + SCOPE_CHECKS.length + 1; // +1 = PG_GATEWAY_RESOURCE_ID exact check
  console.log(`[OK] PingGateway config matches scope-topology.json (${n} literal(s) verified).`);
  process.exit(0);
}
console.error(`[FAIL] PingGateway config drifts from scope-topology.json (${problems.length} issue(s)):`);
for (const p of problems) console.error(`  - ${p}`);
console.error('  Fix the env/config literal, or the manifest, so they agree.');
process.exit(1);
