#!/usr/bin/env node
'use strict';
/**
 * captureGoldens.js — capture REPLAY goldens with NO browser.
 *
 * capture-goldens.real.spec.js needs Playwright only to log in; every call after
 * that is plain HTTP. When the browser is unavailable — on this machine both
 * Playwright chromium builds extract incompletely — capture was blocked for a
 * reason unrelated to the demo. This drives the same goldenCaptureCore with a
 * headless BFF session instead.
 *
 * Usage:
 *   node demo_api_server/scripts/captureGoldens.js [--vertical banking] [--dry-run]
 *
 * Reads demo_api_server/.env for the demo user credentials.
 */

// demo_api_server/.env is gitignored, so a git WORKTREE does not have one and a
// bare relative path silently loads nothing — dotenv reports "injected env (0)"
// instead of throwing, and the run then dies later with the far less obvious
// "could not resolve an enduser session".
//
// The git-derived main-checkout lookup this file used to hand-roll now lives in
// loadDemoEnv, which ALSO decrypts — post-dotenvx-cutover a plain config()
// returns `encrypted:...` ciphertext for every secret.
require('./loadDemoEnv').loadDemoEnv();

const { runGoldenCapture } = require('./goldenCaptureCore');
const { VERTICALS } = require('../config/useCases');

const argv = process.argv.slice(2);
const valOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = valOf('--base', process.env.E2E_BASE_URL || 'https://api.ping.demo:3001');
const only = valOf('--vertical', null);

/** Session cookie via the headless BFF login (no WebAuthn ceremony). */
async function resolveCookie() {
  const { resolveSession } = require('../tests/real/helpers/session.js');
  const s = await resolveSession('enduser');
  const cookie = typeof s === 'string' ? s : (s && (s.cookie || s.cookies));
  if (!cookie) throw new Error('could not resolve an enduser session');
  return cookie;
}

/** http adapter over fetch, shaped for goldenCaptureCore. */
function makeHttp(cookie) {
  const call = async (method, p, body, timeoutMs = 60000) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: ac.signal,
      });
      return { status: res.status, json: () => res.json() };
    } catch (err) {
      // Surface as a non-2xx rather than throwing, so one bad chip cannot abort
      // the whole run and lose every golden captured before it.
      return { status: 0, json: async () => ({ reply: '', error: err.message }) };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    get: (p) => call('GET', p),
    post: (p, body, timeoutMs) => call('POST', p, body, timeoutMs),
    patch: (p, body) => call('PATCH', p, body),
  };
}

async function main() {
  // The demo stack serves https with a local CA; these are local hosts only.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const verticals = only ? [only] : VERTICALS;
  console.log(`[capture-goldens] base=${BASE} verticals=${verticals.join(',')}`);

  const cookie = await resolveCookie();
  const { captured, skips } = await runGoldenCapture({ http: makeHttp(cookie), verticals });

  const byReason = {};
  for (const s of skips) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
  console.log(`\n[capture-goldens] captured ${captured}, skipped ${skips.length}`);
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${reason}`);
  }
  // Skips are expected (some chips cannot be captured by construction), so a
  // skip is not a failure — only capturing NOTHING is.
  process.exitCode = captured > 0 ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[capture-goldens] failed:', err.message);
    process.exit(1);
  });
}
