#!/usr/bin/env node
/**
 * check-tool-scope-registration.js — no-drift gate for the scopes the invest MCP
 * resource server's tools declare.
 *
 * Background (TECH_DEBT 2026-08-17): every Phase-1 SQLite tool shipped with a
 * `requiredScopes` of `<vertical>:read` — `healthcare:read`, `government:read`,
 * `anf:read` — and NONE of those strings was ever registered in
 * scope-topology.json. They are not scopes; they are typos with a colon in them.
 * The migration corrected each one only as its tool was routed (to the plain
 * `read` the SoT already declared), so the unrouted half still carries the
 * original bug. Routing one of those tools 403s on a scope the platform has
 * never heard of, and nothing catches it until a live call fails.
 *
 * This gate makes that a build failure instead:
 *   - every `requiredScopes` string in demo_mcp_resource_server/src/tools/
 *     must resolve to a scope (or alias) in scope-topology.json
 *   - tools in UNROUTED_UNREGISTERED are exempt ONLY while they stay unrouted;
 *     the moment demo_mcp_gateway/src/router.ts names one, this fails
 *   - an allowlist entry whose tool no longer exists is reported as stale, so
 *     the exemption list cannot quietly outlive what it excuses
 *
 *   node scripts/check-tool-scope-registration.js
 *   npm run topology:verify        (step 10/10)
 *
 * Self-test: node --test scripts/check-tool-scope-registration.test.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// TOOL_SCOPE_ROOT lets the self-test point at a fixture tree; default is the
// real repo root (this file lives in scripts/).
const ROOT = process.env.TOOL_SCOPE_ROOT || path.join(__dirname, '..');

const TOOLS_DIR = path.join(ROOT, 'demo_mcp_resource_server/src/tools');
const ROUTER = path.join(ROOT, 'demo_mcp_gateway/src/router.ts');
const TOPOLOGY = path.join(ROOT, 'scope-topology.json');

/**
 * Tools whose declared scope is NOT registered anywhere, exempted because
 * nothing routes them — no chip calls a single-record lookup by id, so the
 * broken declaration is unreachable today.
 *
 * This is a list of known-bad declarations, not a list of blessed ones. Adding
 * to it is the wrong move: if you are routing one of these, give it a real
 * scope in scope-topology.json (and a `tools.<name>` entry) and delete the line
 * here. The router check below enforces exactly that.
 *
 * TOOL_SCOPE_ALLOWLIST overrides this for the self-test, whose fixture tools do
 * not exist in the real tree.
 */
const UNROUTED_UNREGISTERED = [
  'get_anf_order',
  'get_banking_account',
  'get_course',
  'get_expense',
  'get_patient_record',
  'get_permit',
  'get_work_order',
  'list_banking_accounts',
];

const allowlist = new Set(
  process.env.TOOL_SCOPE_ALLOWLIST
    ? JSON.parse(process.env.TOOL_SCOPE_ALLOWLIST)
    : UNROUTED_UNREGISTERED,
);

/** @type {string[]} */
const fails = [];
/** @param {string} msg */
function fail(msg) {
  fails.push(msg);
}

// ---------------------------------------------------------------------------
// 1. The registered scope vocabulary.
// ---------------------------------------------------------------------------

if (!fs.existsSync(TOPOLOGY)) {
  console.error(`❌ scope-topology.json not found at ${TOPOLOGY}`);
  process.exit(1);
}
const topology = JSON.parse(fs.readFileSync(TOPOLOGY, 'utf8'));
// An alias is a real thing a token can carry (gateway:mcp:invoke -> mcp:invoke),
// so both sides of the alias map count as registered.
const registered = new Set([
  ...Object.keys(topology.scopes || {}),
  ...Object.keys(topology.aliases || {}),
  ...Object.values(topology.aliases || {}),
]);

// ---------------------------------------------------------------------------
// 2. Every requiredScopes declaration in the resource server's tool files.
//
// These are TS object literals, not JSON, and pulling in a TS parser for two
// fields is not worth it — the declarations are single-line and uniform
// (`name: 'x'` ... `requiredScopes: ['a', 'b']`), enforced by toolTypes.ts.
// Each `requiredScopes` is attributed to the nearest preceding `name:`.
// ---------------------------------------------------------------------------

if (!fs.existsSync(TOOLS_DIR)) {
  console.error(`❌ tools directory not found at ${TOOLS_DIR}`);
  process.exit(1);
}

/** @type {{tool: string, scope: string, file: string, line: number}[]} */
const refs = [];
/** @type {Set<string>} */
const declaredTools = new Set();

for (const file of fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts')).sort()) {
  const lines = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8').split('\n');
  let currentTool = null;
  lines.forEach((raw, i) => {
    // Ignore comment lines — several files document the pattern in prose that
    // otherwise looks exactly like a declaration.
    const line = raw.replace(/^\s*(\/\/|\*).*$/, '');
    const nameMatch = line.match(/\bname:\s*'([^']+)'/);
    if (nameMatch) {
      currentTool = nameMatch[1];
      declaredTools.add(currentTool);
    }
    const scopesMatch = line.match(/\brequiredScopes:\s*\[([^\]]*)\]/);
    if (!scopesMatch) return;
    for (const m of scopesMatch[1].matchAll(/'([^']+)'/g)) {
      refs.push({ tool: currentTool || '(unknown)', scope: m[1], file, line: i + 1 });
    }
  });
}

// ---------------------------------------------------------------------------
// 3. What the gateway actually routes.
// ---------------------------------------------------------------------------

const routerSrc = fs.existsSync(ROUTER) ? fs.readFileSync(ROUTER, 'utf8') : '';
/** @param {string} tool */
function isRouted(tool) {
  return new RegExp(`'${tool}'|"${tool}"`).test(routerSrc);
}

// ---------------------------------------------------------------------------
// 4. Verdicts.
// ---------------------------------------------------------------------------

let allowed = 0;
for (const ref of refs) {
  if (registered.has(ref.scope)) continue;
  if (allowlist.has(ref.tool)) {
    allowed += 1;
    if (isRouted(ref.tool)) {
      fail(
        `${ref.file}:${ref.line}: '${ref.tool}' is ROUTED in demo_mcp_gateway/src/router.ts but ` +
          `still declares the unregistered scope '${ref.scope}'. Routing it makes the broken ` +
          `declaration reachable — every call will 403. Give it a real scope in ` +
          `scope-topology.json and drop it from UNROUTED_UNREGISTERED.`,
      );
    }
    continue;
  }
  fail(
    `${ref.file}:${ref.line}: '${ref.tool}' requires scope '${ref.scope}', which is not in ` +
      `scope-topology.json (neither scopes{} nor aliases{}). A token can never carry it, so ` +
      `every call to this tool will 403.`,
  );
}

for (const tool of allowlist) {
  if (!declaredTools.has(tool)) {
    fail(
      `UNROUTED_UNREGISTERED lists '${tool}', which no tool file declares any more — stale ` +
        `exemption. Delete the entry.`,
    );
  }
}

if (fails.length) {
  console.error('❌ tool scope registration FAILED:\n');
  for (const f of fails) console.error('  ' + f);
  console.error(
    '\nEvery requiredScopes entry must name a scope that exists in scope-topology.json.\n' +
      'An invented `<vertical>:read` string is not a scope — it is a 403 waiting for\n' +
      'someone to route the tool that declares it.\n',
  );
  process.exit(1);
}

console.log(
  `✅ tool scopes registered in scope-topology.json ` +
    `(${refs.length} scope references across ${declaredTools.size} tools, ${allowed} allowlisted unrouted)`,
);
