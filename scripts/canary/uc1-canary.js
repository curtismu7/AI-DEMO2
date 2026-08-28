// scripts/canary/uc1-canary.js
//
// Live-site canary: sign in as the demo user, run UC1 ("Delegated access with
// proof") from the use-case launcher, and assert the agent produced a real
// tool result. Exits non-zero (with a screenshot in CANARY_OUT_DIR) when the
// demo is broken — this catches the whole class of failures that hit the live
// site on 2026-07-11 (broken sign-in redirect, heuristics routed to a dead
// LLM, authz fail-closed DENY, TLS/tool-callback errors).
//
// Env:
//   CANARY_BASE_URL   (default https://ai-demo.ping-devops.com)
//   CANARY_USERNAME   (required)
//   CANARY_PASSWORD   (required)
//   CANARY_OUT_DIR    (default .)   — screenshots/diagnostics on failure
//   CANARY_TIMEOUT_MS (default 120000) — max wait for the agent reply
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.env.CANARY_BASE_URL || 'https://ai-demo.ping-devops.com').replace(/\/$/, '');
const USERNAME = process.env.CANARY_USERNAME;
const PASSWORD = process.env.CANARY_PASSWORD;
const OUT_DIR = process.env.CANARY_OUT_DIR || '.';
const REPLY_TIMEOUT_MS = parseInt(process.env.CANARY_TIMEOUT_MS || '120000', 10);

// Any of these in the agent area means the demo is broken, even if text grew.
const FAILURE_MARKERS = [
  /could not parse/i,
  /unexpected error/i,
  /Heuristics-only mode — no LLM/i, // catalog fallback instead of a result
  /could not complete/i,
  /certificate verify failed/i,
  /encountered an error/i,
  /no longer signed in/i,
];

// A real tool result for the UC1 read chip, across verticals (permits table,
// account balances, records list...). Every pattern must be absent from the
// pre-run greeting text, or the canary false-passes before the reply lands.
const SUCCESS_MARKERS = [
  /here are your/i,          // standard tool-result lead-in
  /permit id/i,              // government permits table header
  /\$[\d,]+\.\d{2}/,         // any currency amount with cents (balances, fees)
];

function fail(msg) {
  console.error(`CANARY FAIL: ${msg}`);
  process.exitCode = 1;
}

(async () => {
  if (!USERNAME || !PASSWORD) {
    console.error('CANARY FAIL: CANARY_USERNAME / CANARY_PASSWORD not set');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  const shoot = async (name) => {
    try { await page.screenshot({ path: path.join(OUT_DIR, name) }); } catch { /* page may be gone */ }
  };

  try {
    // ── Sign in via the PingOne hosted form ──────────────────────────────
    // Go straight to the BFF's OAuth login redirect instead of clicking the
    // top-nav Sign In button: that button computes a 0x0 bounding box in a
    // headless viewport (confirmed 2026-08-17), so click() always times out
    // even though the demo itself is healthy. The button just calls this
    // same redirect (navigateToCustomerOAuthLogin() in authUi.js) — skip it.
    await page.goto(BASE + '/api/auth/oauth/user/login?return_to=%2Fdashboard');
    await page.waitForURL(/apps\.pingone\.com/, { timeout: 30000 });
    await page.waitForSelector('#username');
    await page.fill('#username', USERNAME);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: /sign on/i }).click();
    // The redirect_uri regression sent users to a dev-only host — assert we
    // came back to the SAME public origin we started on.
    await page.waitForURL((u) => u.href.startsWith(BASE), { timeout: 30000 })
      .catch(async () => {
        await shoot('canary-login-redirect.png');
        throw new Error(`login did not return to ${BASE} (landed on ${page.url()})`);
      });
    console.log('canary: signed in, landed on', page.url());

    // ── Run UC1 from the use-case launcher ───────────────────────────────
    await page.goto(BASE + '/use-cases');
    await page.waitForLoadState('networkidle').catch(() => {});
    const card = page.locator('text=Delegated access with proof').first();
    await card.waitFor({ timeout: 30000 });
    await card.click();
    const runBtn = page.getByRole('button', { name: /^run$/i }).first();
    await runBtn.waitFor({ timeout: 15000 });
    await runBtn.click();
    await page.waitForURL(/dashboard/, { timeout: 30000 });
    console.log('canary: UC1 launched');

    // ── Wait for the agent reply and judge it ────────────────────────────
    // Judge the FULL chat text, not a baseline delta: heuristics-mode replies
    // can render faster than a baseline snapshot, and none of the markers
    // below occur in the pre-run greeting. Poll until a marker appears.
    const region = page.locator('[aria-label="AI banking assistant"]').first();
    const t0 = Date.now();
    let text = '';
    let failureHit = null;
    let successHit = null;
    while (Date.now() - t0 < REPLY_TIMEOUT_MS) {
      text = await region.innerText().catch(() => '');
      failureHit = FAILURE_MARKERS.find((re) => re.test(text)) || null;
      successHit = SUCCESS_MARKERS.find((re) => re.test(text)) || null;
      if (failureHit || successHit) break;
      await page.waitForTimeout(4000);
    }
    const tail = text.replace(/\s+/g, ' ').slice(-300);

    if (failureHit) {
      await shoot('canary-agent-failure.png');
      fail(`agent reply contains failure marker ${failureHit}: ...${tail}`);
    } else if (!successHit) {
      await shoot('canary-agent-timeout.png');
      fail(`no data result within ${REPLY_TIMEOUT_MS / 1000}s: ...${tail}`);
    } else {
      console.log(`CANARY PASS: UC1 result rendered (matched ${successHit}) — ...${tail.slice(-200)}`);
    }

    // ── The movie reel must be ON SCREEN, not merely in the DOM ───────────
    // Five "the reel is gone" reports, and every guard before this one checked
    // that the component rendered — which stayed true while it sat below the
    // fold. We are already signed in on /dashboard after a real run, so the
    // check costs nothing.
    //
    // The skin half of this gate is gone with the classic dashboard: there is
    // one customer dashboard now. (The gate used to also test `.customer-skin-p1`
    // to tell the Ping2026 dashboard from the frozen classic one — and before
    // that, wrongly, `.user-dashboard--2026`, which BOTH dashboards carried, so
    // it skipped nothing and the canary failed every run.)
    //
    // No layout is exempt any more. Clinical split used to be skipped here --
    // it was an early return in UserDashboardPing2026 that never reached either
    // reel render, so the canary encoded its absence as "no reel by design".
    // PR #2524 gave it a ReelDock, and the SE frontend carrying that was
    // verified on 2026-08-28 (the served bundle contains tcfs-float-host,
    // "Collapse token chain" and user-dashboard--clinical-split), so the
    // deploy-lag allowance that kept the skip alive is spent.
    //
    // `clinical` is still reported, purely so a failure message names which
    // layout was live -- the two layouts pin the reel by different mechanisms
    // (a grid row in focus mode, a sticky host in clinical/float), so knowing
    // which one was on screen is the first thing you need when this goes red.
    const reel = await page.evaluate(() => {
      const clinical = !!document.querySelector('.user-dashboard--clinical-split');
      const el = document.querySelector('.tcfs-chain');
      if (!el) return { clinical, present: false };
      const r = el.getBoundingClientRect();
      return {
        clinical,
        present: true,
        onScreen: r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
        top: Math.round(r.top),
        vh: window.innerHeight,
      };
    });
    const layout = reel.clinical ? 'clinical-split' : 'focus/float';
    if (!reel.present) {
      await shoot('canary-reel-missing.png');
      fail(`movie reel (.tcfs-chain) is not in the DOM on /dashboard (layout: ${layout})`);
    } else if (!reel.onScreen) {
      await shoot('canary-reel-offscreen.png');
      fail(`movie reel is in the DOM but off screen (layout: ${layout}, top=${reel.top}, viewport=${reel.vh})`);
    } else {
      console.log(`canary: movie reel on screen (layout: ${layout})`);
    }
  } catch (err) {
    await shoot('canary-error.png');
    fail(err.message);
  } finally {
    await browser.close();
  }
})();
