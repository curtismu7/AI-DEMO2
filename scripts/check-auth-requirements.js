#!/usr/bin/env node

/*
 * Auth-requirement no-drift gate.
 *
 *   node scripts/check-auth-requirements.js      (npm run authz:verify)
 *
 * `demo_api_server/config/auth-requirements.json` is the SoT for which demo
 * surfaces run signed out. It only stays true if nothing can quietly disagree
 * with it, so this fails on:
 *
 *   1. a use case (or admin demo step) with no entry            — coverage
 *   2. an entry for an id that no longer exists                 — rot
 *   3. a level outside the declared list                        — typo
 *   4. a use case more public than the route it links to        — dead end
 *   5. the BFF guest allowlist disagreeing with publicAgentActions
 *   6. a public chip whose text does not parse to an allowed action
 *
 * (5) is the one that matters at runtime: agentRun.js decides whether a
 * signed-out caller may run an action, and it fails closed. If the SoT says a
 * use case is public but that allowlist never learned about it, the use case is
 * public in the UI and 401 on the wire.
 *
 * (6) closes the gap (5) leaves open. (5) proves the two *lists* agree; it says
 * nothing about whether a given public chip actually reaches one of those
 * actions. Chip text is per-vertical — UC24 is "What branches are near me?" in
 * banking and different wording in the other ten — and the wire gate keys off
 * the action `parseHeuristic` extracts, not off the use-case id. So one
 * vertical's phrasing can stop resolving while every list still matches, and
 * that vertical alone breaks for guests. Checked across all verticals.
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { USE_CASES, VERTICALS, resolveUseCase } = require(path.join(ROOT, 'demo_api_server/config/useCases'));
const { ADMIN_DEMO_STEPS } = require(path.join(ROOT, 'demo_api_server/config/admin/demoSteps'));
const {
  AUTH_REQUIREMENTS, LEVELS, compareLevels, authLevelForUseCase, authLevelForRoute,
} = require(path.join(ROOT, 'demo_api_server/config/authRequirements'));

const failures = [];
const fail = (msg) => failures.push(msg);

const declared = AUTH_REQUIREMENTS.useCases;
const allIds = [...USE_CASES.map((u) => u.id), ...ADMIN_DEMO_STEPS.map((s) => s.id)];

// 1. coverage
for (const id of allIds) {
  if (!declared[id]) {
    fail(`use case "${id}" has no entry in auth-requirements.json (add one: public | user | admin)`);
  }
}

// 2. rot
const known = new Set(allIds);
for (const id of Object.keys(declared)) {
  if (!known.has(id)) fail(`auth-requirements.json lists "${id}", which is not a known use case`);
}

// 3. typo
for (const [id, level] of Object.entries(declared)) {
  if (!LEVELS.includes(level)) {
    fail(`use case "${id}" has level "${level}" — allowed: ${LEVELS.join(', ')}`);
  }
}
for (const [route, level] of Object.entries(AUTH_REQUIREMENTS.routes)) {
  if (!LEVELS.includes(level)) {
    fail(`route "${route}" has level "${level}" — allowed: ${LEVELS.join(', ')}`);
  }
}

// 4. a use case may not promise less auth than the page it opens
for (const uc of USE_CASES) {
  const target = uc.trigger?.type === 'link' ? uc.trigger.path : null;
  if (!target) continue;
  // Strip query/hash — /privilege-demo?tab=setup and /x#rar are the same route.
  const routePath = target.split(/[?#]/)[0];
  if (!(routePath in AUTH_REQUIREMENTS.routes)) continue; // unlisted routes use the default
  const ucLevel = authLevelForUseCase(uc.id);
  const routeLevel = authLevelForRoute(routePath);
  if (compareLevels(ucLevel, routeLevel) < 0) {
    fail(
      `use case "${uc.id}" is "${ucLevel}" but links to "${routePath}", which is "${routeLevel}" — `
      + 'a visitor who can start the step cannot reach the page',
    );
  }
}

// 5. the wire has to agree with the SoT
const agentRunSrc = fs.readFileSync(path.join(ROOT, 'demo_api_server/routes/agentRun.js'), 'utf8');
const allowlistMatch = agentRunSrc.match(/PUBLIC_GUEST_ACTIONS\s*=\s*new Set\(\[([^\]]*)\]\)/);
if (!allowlistMatch) {
  fail('could not find PUBLIC_GUEST_ACTIONS in demo_api_server/routes/agentRun.js — has it moved?');
} else {
  const onTheWire = (allowlistMatch[1].match(/'([^']+)'|"([^"]+)"/g) || [])
    .map((s) => s.replace(/['"]/g, ''))
    .sort();
  const inTheSot = [...AUTH_REQUIREMENTS.publicAgentActions].sort();
  if (onTheWire.join(',') !== inTheSot.join(',')) {
    fail(
      `PUBLIC_GUEST_ACTIONS in agentRun.js is [${onTheWire.join(', ')}] but `
      + `publicAgentActions in auth-requirements.json is [${inTheSot.join(', ')}]`,
    );
  }
}

// 6. a public chip must actually reach an allowed action, in every vertical
const publicActions = new Set(AUTH_REQUIREMENTS.publicAgentActions);
let parseHeuristic;
try {
  ({ parseHeuristic } = require(path.join(ROOT, 'demo_api_server/services/nlIntentParser')));
} catch (err) {
  fail(`could not load nlIntentParser to check public chip routing: ${err.message}`);
}
if (parseHeuristic) {
  for (const uc of USE_CASES) {
    if (authLevelForUseCase(uc.id) !== 'public') continue;
    for (const vertical of VERTICALS) {
      const trigger = resolveUseCase(uc.id, vertical)?.trigger || {};
      if (trigger.type !== 'chip' || !trigger.text) continue;
      let action = '';
      try {
        action = String(parseHeuristic(trigger.text)?.banking?.action || '');
      } catch {
        action = '';
      }
      if (!publicActions.has(action)) {
        fail(
          `use case "${uc.id}" is "public" but its ${vertical} chip ("${trigger.text}") `
          + `resolves to action "${action || '<none>'}", which is not in publicAgentActions — `
          + 'a signed-out visitor would be refused on the wire',
        );
      }
    }
  }
}

if (failures.length) {
  console.error('\n[authz:verify] FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `[authz:verify] OK — ${allIds.length} use cases, `
  + `${Object.keys(AUTH_REQUIREMENTS.routes).length} routes, `
  + `${AUTH_REQUIREMENTS.publicAgentActions.length} public agent action(s)`,
);
