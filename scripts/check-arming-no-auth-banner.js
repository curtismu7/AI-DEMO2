#!/usr/bin/env node
'use strict';

/*
 * Every feature-flag arming call must opt out of the re-auth banner.
 *
 *   node scripts/check-arming-no-auth-banner.js   (npm run authz:verify runs this too)
 *
 * `PATCH /api/admin/feature-flags` is admin-gated, so any caller without an
 * admin session gets a 401. That 401 says nothing about the user's session —
 * arming is best-effort preflight — but apiClient's interceptor treats every
 * 401 as proof the session is gone and raises the global SessionReauthBanner.
 *
 * That is the bug this repo shipped: a signed-out visitor ran UC24, got a
 * correct answer with all seven branch cards, and then had
 * "For a more personalized experience, please sign in." dropped on top of it.
 *
 * Nothing stops a new arming site from being added without the opt-out, and the
 * failure is invisible in tests — the request still succeeds for an admin, and
 * unit tests do not render the banner. So this gate reads the call sites.
 *
 * ONLY preflight arming is in scope. A deliberate toggle — an admin flipping a
 * switch, the agent's "reset demo flags" button — is a different thing: there a
 * 401 really does mean the session is gone and the banner is correct. Muting it
 * would hide a real session loss.
 *
 * The two are distinguishable by shape, which is why this gate can be precise:
 *
 *   arming  apiClient.patch(ROUTE, { updates })              <- computed list
 *   toggle  apiClient.patch(ROUTE, { updates: { [id]: v } }) <- literal, user-driven
 *
 * Arming builds `updates` from a required-flags array and passes it shorthand.
 * A toggle names the flag inline. Only the shorthand form is checked.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UI_SRC = path.join(ROOT, 'demo_api_ui', 'src');
const ARMING_ROUTE = '/api/admin/feature-flags';

/** Recursively collect .js/.jsx under a directory, skipping tests and vendor dirs. */
function collectSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      collectSources(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the argument text of a `.patch(...)` call starting at `open`, by
 * walking to the balanced close paren. Regex alone cannot do this — the second
 * argument is an object literal containing its own parens and braces.
 */
function callArgs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

const failures = [];

for (const file of collectSources(UI_SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(ARMING_ROUTE)) continue;

  // Only PATCH arms flags; the GET on the same route is a plain read.
  const re = /\.patch\s*\(/g;
  let m = re.exec(src);
  while (m !== null) {
    const args = callArgs(src, re.lastIndex - 1);
    // `{ updates }` shorthand === preflight arming from a computed flag list.
    // `{ updates: {...} }` === a deliberate toggle, which must keep the banner.
    const isArming = args
      && args.includes(ARMING_ROUTE)
      && /\{\s*updates\s*\}/.test(args);
    if (isArming && !args.includes('_noAuthBanner')) {
      const line = src.slice(0, m.index).split('\n').length;
      failures.push(
        `${path.relative(ROOT, file)}:${line} — arming PATCH ${ARMING_ROUTE} without `
        + '{ _noAuthBanner: true }. Its 401 is expected for any non-admin and says '
        + 'nothing about the session, but it would raise the global re-auth banner '
        + 'over a step that may have answered correctly.',
      );
    }
    m = re.exec(src);
  }
}

if (failures.length) {
  console.error('\n[arming-banner] FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log('[arming-banner] OK — every feature-flag arming call opts out of the re-auth banner');
