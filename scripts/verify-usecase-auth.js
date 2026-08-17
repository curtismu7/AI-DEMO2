#!/usr/bin/env node
'use strict';

/**
 * Drift gate for the use-case auth SoT (demo_api_server/config/use-case-auth.json).
 *
 * The manifest is what the UI reads to decide whether a demo step needs a
 * sign-in. Nothing forces a new catalog entry to appear in it, and an entry
 * that silently defaults to `user` reproduces the original bug: a step the
 * server answers for guests, gated behind a sign-in prompt by the client.
 *
 * Checks:
 *   1. every catalog / admin-step id has a manifest entry
 *   2. every manifest entry maps to a real id (no orphans)
 *   3. every value is one of the declared levels
 *   4. every `public` chip step resolves to an action the server actually
 *      allows a guest to run (routes/agentRun.js PUBLIC_GUEST_ACTIONS)
 *
 * Run: npm run verify:usecase-auth
 */

const path = require('path');

const SERVER = path.join(__dirname, '..', 'demo_api_server');
const { USE_CASES, VERTICALS, resolveUseCase } = require(path.join(SERVER, 'config/useCases'));
const { ADMIN_DEMO_STEPS } = require(path.join(SERVER, 'config/admin/demoSteps'));
const MANIFEST = require(path.join(SERVER, 'config/use-case-auth.json'));
const { PUBLIC_GUEST_ACTIONS } = require(path.join(SERVER, 'config/publicGuestActions'));
const { parseHeuristic } = require(path.join(SERVER, 'services/nlIntentParser'));

const errors = [];
const levels = new Set(MANIFEST.levels);
const entries = MANIFEST.useCases;
const catalogIds = [...USE_CASES.map((u) => u.id), ...ADMIN_DEMO_STEPS.map((u) => u.id)];

// 1 — coverage
for (const id of catalogIds) {
  if (!Object.prototype.hasOwnProperty.call(entries, id)) {
    errors.push(`missing entry: "${id}" is in the catalog but not in use-case-auth.json`);
  }
}

// 2 — orphans
const known = new Set(catalogIds);
for (const id of Object.keys(entries)) {
  if (!known.has(id)) {
    errors.push(`orphan entry: "${id}" is in use-case-auth.json but not in any catalog`);
  }
}

// 3 — values
for (const [id, level] of Object.entries(entries)) {
  if (!levels.has(level)) {
    errors.push(`bad level: "${id}" = ${JSON.stringify(level)} (expected one of ${[...levels].join(', ')})`);
  }
}

// 4 — a public chip must be one the server lets a guest run. Checked across
// every vertical: the chip text is per-vertical, so banking passing alone would
// not prove a guest can run the step in the vertical the demo is set to.
for (const uc of USE_CASES) {
  if (entries[uc.id] !== 'public') continue;
  for (const vertical of VERTICALS) {
    const resolved = resolveUseCase(uc.id, vertical);
    const trigger = resolved?.trigger || {};
    if (trigger.type !== 'chip' || !trigger.text) continue;
    let action = '';
    try {
      action = String(parseHeuristic(trigger.text)?.banking?.action || '');
    } catch {
      action = '';
    }
    if (!PUBLIC_GUEST_ACTIONS.has(action)) {
      errors.push(
        `unenforceable public: "${uc.id}" is marked public but its ${vertical} chip `
        + `("${trigger.text}") resolves to action "${action || '<none>'}", which is not in `
        + 'PUBLIC_GUEST_ACTIONS — a guest would be told to sign in by the server anyway',
      );
    }
  }
}

if (errors.length) {
  console.error('use-case auth SoT drift:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} problem(s). Fix demo_api_server/config/use-case-auth.json.`);
  process.exit(1);
}

const counts = Object.values(entries).reduce((acc, l) => {
  acc[l] = (acc[l] || 0) + 1;
  return acc;
}, {});
console.log(
  `use-case auth SoT OK — ${catalogIds.length} ids covered `
  + `(${Object.entries(counts).map(([l, n]) => `${n} ${l}`).join(', ')})`,
);
