#!/usr/bin/env node
'use strict';
/**
 * Attack-sim health probe — runs all 9 A6.2 attack simulations against a live
 * deployment and asserts each returns its REAL policy decision (not a masked
 * audience failure).
 *
 * Usage (defaults to the Ping AWS SE deployment):
 *   cd demo_api_ui && NODE_PATH=./node_modules node e2e/probe-attack-sims.cjs
 *   BASE_URL=https://api.ping.demo:3001 ... node e2e/probe-attack-sims.cjs
 *
 * Credentials load from demo_api_server/.env (DEMO_USER_USERNAME / DEMO_USER_PASSWORD).
 * Exit code 0 when all 9 execute; 1 otherwise. Useful as a post-deploy smoke test.
 *
 * Background: the sims exchange the user token via the MCP Exchanger app so the
 * token carries the gateway audience. If that regresses, PingOne mints the token
 * for the scope-owning API resource and BOTH gateways reject it — every sim then
 * fails with GATEWAY_AUDIENCE_MISMATCH (or a masked deny). See
 * demo_api_server/services/attackSimulatorService.js `_exchangeSimToken` and
 * demo_api_server/tests/attackSimExchangerParity.test.js.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Load demo_api_server/.env without adding a dotenv dependency. Existing env wins. */
function loadEnvFile() {
  const p = path.join(REPO_ROOT, 'demo_api_server', '.env');
  if (!fs.existsSync(p)) return null;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return p;
}
loadEnvFile();

const BASE_URL = process.env.BASE_URL || 'https://ai-demo.ping-devops.com';
const DEMO_USER = process.env.DEMO_USER_USERNAME || 'demoUser';
const DEMO_PASS = process.env.DEMO_USER_PASSWORD || '';

// Fail fast: without a password the login form just times out after 30s with a
// confusing locator error. A git worktree has no demo_api_server/.env (gitignored),
// so this is the common trip-up — say so instead of hanging.
if (!DEMO_PASS) {
  console.error(
    'ERROR: no password. Set DEMO_USER_PASSWORD (or run where demo_api_server/.env exists).\n' +
    '  e.g. DEMO_USER_PASSWORD=... node e2e/probe-attack-sims.cjs',
  );
  process.exit(2);
}

/** Must match VALID_SIMS in demo_api_server/routes/attackSimulator.js. */
const SIMS = [
  'insufficient-scope',
  'wrong-aud',
  'cross-owner-account',
  'replayed-token',
  'rogue-actor',
  'rar-exceeded',
  'tampered-intent-token',
  'impersonation-no-act',
  'rate-limit-burst',
];

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000).catch(() => {});
  const signInBtn = page.locator('button:has-text("Sign In")').first();
  if (!(await signInBtn.isVisible().catch(() => false))) return;

  await signInBtn.click();
  await page.waitForTimeout(2500).catch(() => {});
  for (const input of await page.locator('input').all()) {
    const type = await input.getAttribute('type').catch(() => '');
    if (type === 'email' || type === 'text') await input.fill(DEMO_USER);
    else if (type === 'password') await input.fill(DEMO_PASS);
  }
  await page
    .locator('button[type="submit"], button:has-text("Sign On"), button:has-text("Sign in")')
    .first()
    .click();
  await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500).catch(() => {});
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  console.log(`🔐 Login as ${DEMO_USER} @ ${BASE_URL}`);
  await login(page);
  console.log('✓ Logged in\n');
  console.log('Running all 9 attack sims via POST /api/demo/attack-sim/run:\n');

  let pass = 0;
  let fail = 0;
  for (const sim of SIMS) {
    const resp = await context.request
      .post(`${BASE_URL}/api/demo/attack-sim/run`, {
        data: { sim },
        headers: { 'Content-Type': 'application/json' },
        ignoreHTTPSErrors: true,
      })
      .catch((e) => ({ _err: e.message }));

    if (resp._err) {
      console.log(`❌ ${sim.padEnd(24)} request error: ${resp._err}`);
      fail++;
      continue;
    }
    const status = resp.status();
    let body = {};
    try {
      body = await resp.json();
    } catch {
      /* non-JSON response */
    }

    // A sim "ran" when the endpoint executed it and returned a decision — NOT
    // 400 unknown_sim (sim missing from the deployed VALID_SIMS = stale build).
    const ran = status === 200 && (body.errorCode || body.reason || body.status);
    if (ran) {
      console.log(`✅ ${sim.padEnd(24)} HTTP ${status}  decision=${body.errorCode || body.status}`);
      pass++;
    } else if (status === 400 && body.error === 'unknown_sim') {
      console.log(`❌ ${sim.padEnd(24)} HTTP 400 unknown_sim — not in deployed VALID_SIMS (stale build)`);
      fail++;
    } else if (status === 403) {
      console.log(`❌ ${sim.padEnd(24)} HTTP 403 ${body.error} — NODE_ENV=production or ff_use_cases_launcher off`);
      fail++;
    } else {
      console.log(`❌ ${sim.padEnd(24)} HTTP ${status}  ${body.error || JSON.stringify(body).slice(0, 70)}`);
      fail++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`ATTACK SIMS: ${pass}/${SIMS.length} executed, ${fail} failed`);
  console.log(`${'='.repeat(50)}`);

  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
