#!/usr/bin/env node
'use strict';
/**
 * Use-case launcher screenshot runner with heuristic agent-reply detection.
 *
 * Drives every runnable use-case chip on /use-cases, clicks Run, waits for an
 * agent reply, and screenshots each card. Cards labelled "Run (coming in A6.2)"
 * or "Needs build" are recorded as SKIP rather than failures.
 *
 * Usage (defaults to the Ping AWS SE deployment):
 *   cd demo_api_ui && NODE_PATH=./node_modules node e2e/use-case-launcher-screenshots.cjs
 *   BASE_URL=https://api.ping.demo:3001 ... node e2e/use-case-launcher-screenshots.cjs
 *   UC_VERTICAL="CareConnect" ... node e2e/use-case-launcher-screenshots.cjs
 *
 * Credentials load from demo_api_server/.env (DEMO_USER_USERNAME / DEMO_USER_PASSWORD).
 * Outputs: test-results/use-case-launcher-screenshots-report.json
 *          test-results/screenshots/use-cases/<uc>.png
 *
 * NOTE: this is a standalone script (not a Playwright test) so it can run against
 * any deployed environment without the e2e config/fixtures.
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
const loadedEnvPath = loadEnvFile();

const BASE_URL = process.env.BASE_URL || 'https://ai-demo.ping-devops.com';
const DEMO_USER = process.env.DEMO_USER_USERNAME || 'demoUser';
const DEMO_PASS = process.env.DEMO_USER_PASSWORD || '';
const VERTICAL = process.env.UC_VERTICAL || 'Super Banking';

// Fail fast: without a password the login form just times out after 30s with a
// confusing locator error. A git worktree has no demo_api_server/.env (gitignored),
// so this is the common trip-up — say so instead of hanging.
if (!DEMO_PASS) {
  console.error(
    'ERROR: no password. Set DEMO_USER_PASSWORD (or run where demo_api_server/.env exists).\n' +
    '  e.g. DEMO_USER_PASSWORD=... node e2e/use-case-launcher-screenshots.cjs',
  );
  process.exit(2);
}
const TIMEOUT = 30_000;
const AGENT_REPLY_TIMEOUT = Number(process.env.UC_REPLY_TIMEOUT_MS || 20_000);
const OUT_DIR = path.join(REPO_ROOT, 'test-results');
const SCREENSHOT_DIR = path.join(OUT_DIR, 'screenshots', 'use-cases');

/** Log in via the app's Sign In button + the PingOne username/password form. */
async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000).catch(() => {});

  const signInBtn = page.locator('button:has-text("Sign In")').first();
  if (!(await signInBtn.isVisible().catch(() => false))) {
    console.log('  ✓ Already authenticated (no Sign In button)');
    return;
  }
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

  const err = await page.locator('#feedback-error, [class*="error"]').first().textContent().catch(() => '');
  if (err && /incorrect|invalid/i.test(err)) throw new Error(`Login failed: ${err.trim()}`);
  console.log(`  ✓ Logged in as ${DEMO_USER}`);
}

/** Navigate to Use Cases and select the target vertical. */
async function gotoUseCases(page) {
  const useCasesBtn = page.locator('button:has-text("Use Cases")').first();
  if (await useCasesBtn.isVisible().catch(() => false)) {
    await useCasesBtn.click();
    await page.waitForTimeout(3000).catch(() => {});
  } else {
    await page.goto(`${BASE_URL}/use-cases`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(3000).catch(() => {});
  }

  // Scope the vertical click to the picker: a bare button:has-text("Super Banking")
  // also matches the top-nav vertical dropdown and navigates away from the cards.
  // Super Banking is the default, so only non-default verticals need a click.
  if (VERTICAL !== 'Super Banking') {
    const chip = page.locator('[data-testid="uc-vertical-picker"]').locator(`button:has-text("${VERTICAL}")`).first();
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await page.waitForTimeout(2000).catch(() => {});
    }
  }
  console.log(`  ✓ On Use Cases page (vertical: ${VERTICAL})`);
}

/**
 * Enumerate use-case cards. Each exposes a Run button; walk up to the card
 * container to read the UC id, title, and maturity/flag state.
 */
async function collectCards(page) {
  const runButtons = await page.locator('button:has-text("Run")').all();
  const cards = [];
  for (let i = 0; i < runButtons.length; i++) {
    const button = runButtons[i];
    const btnText = ((await button.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const card = button.locator(
      'xpath=ancestor::*[contains(@class,"card") or contains(@class,"use-case") or contains(@class,"item")][1]',
    );
    const cardText = ((await card.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const idMatch = cardText.match(/\buc\s?(\d+)\b/i);

    cards.push({
      index: i,
      id: idMatch ? `UC${idMatch[1]}` : `card-${i}`,
      title: cardText.substring(0, 80),
      comingSoon: /coming in a6\.2/i.test(btnText) || /coming in a6\.2/i.test(cardText),
      needsBuild: /needs build/i.test(cardText),
      flagGated: /flag-gated/i.test(cardText) && /turn on to run/i.test(cardText),
      button,
      card,
    });
  }
  return cards;
}

/** Heuristic: has the card gained a substantive agent reply since Run was clicked? */
async function detectReply(page, card, beforeText) {
  const start = Date.now();
  while (Date.now() - start < AGENT_REPLY_TIMEOUT) {
    const now = ((await card.card.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const grew = now.length > beforeText.length + 40;
    const signal = /(allowed|denied|blocked|balance|\$|token|scope|error|sorry|result|success|forbidden|consent|approv)/i
      .test(now.slice(beforeText.length));
    if (grew && signal) return true;

    const toast = await page
      .locator('[class*="toast"], [class*="response"], [class*="reply"], [class*="result"]')
      .first().isVisible().catch(() => false);
    if (toast) return true;

    await page.waitForTimeout(500).catch(() => {});
  }
  return false;
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    vertical: VERTICAL,
    summary: { total: 0, pass: 0, skip: 0, fail: 0 },
    results: [],
    errors: [],
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  try {
    console.log(`🚀 Screenshot runner → ${BASE_URL}`);
    console.log(`🔐 Credentials: ${DEMO_USER} (env: ${loadedEnvPath || 'defaults'})`);
    await login(page);
    await gotoUseCases(page);

    const cards = await collectCards(page);
    console.log(`\n📊 Found ${cards.length} use-case cards\n`);

    for (const card of cards) {
      const rec = { id: card.id, title: card.title, status: 'unknown', hasReply: false, screenshot: null, error: null };

      if (card.comingSoon || card.needsBuild) {
        const reason = card.comingSoon ? 'coming-in-a6.2' : 'needs-build';
        console.log(`⏭️  SKIP ${card.id}: ${reason}`);
        Object.assign(rec, { status: 'skip', reason });
        results.summary.skip++;
        results.results.push(rec);
        continue;
      }

      try {
        console.log(`▶️  RUN  ${card.id}${card.flagGated ? ' (flag-gated OFF)' : ''}`);
        await card.button.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400).catch(() => {});

        const before = ((await card.card.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        await card.button.click();
        await page.waitForTimeout(1000).catch(() => {});

        // UC7 step-up: an approval modal may appear — accept it.
        if (card.id === 'UC7') {
          const confirm = page
            .locator('button:has-text("Confirm"), button:has-text("Approve"), button:has-text("Continue")')
            .first();
          if (await confirm.isVisible().catch(() => false)) {
            await confirm.click().catch(() => {});
            await page.waitForTimeout(1000).catch(() => {});
          }
        }

        const hasReply = await detectReply(page, card, before);

        const shotPath = path.join(SCREENSHOT_DIR, `${card.id}.png`);
        await card.card.screenshot({ path: shotPath }).catch(async () => {
          await page.screenshot({ path: shotPath }).catch(() => {});
        });
        rec.screenshot = shotPath;

        rec.status = 'pass';
        rec.hasReply = hasReply;
        if (!hasReply) rec.note = 'no-reply-detected';
        console.log(
          hasReply
            ? `✅ PASS ${card.id}: agent reply detected`
            : `⚠️  PASS ${card.id}: ran, no clear reply within ${AGENT_REPLY_TIMEOUT / 1000}s`,
        );
        results.summary.pass++;
        results.results.push(rec);
        await page.waitForTimeout(500).catch(() => {});
      } catch (e) {
        console.error(`❌ FAIL ${card.id}: ${e.message}`);
        Object.assign(rec, { status: 'fail', error: e.message });
        results.summary.fail++;
        results.results.push(rec);
      }
    }

    results.summary.total = results.results.length;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESULTS — ${VERTICAL}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total:   ${results.summary.total}`);
    console.log(`✅ PASS: ${results.summary.pass}`);
    console.log(`⏭️  SKIP: ${results.summary.skip}`);
    console.log(`❌ FAIL: ${results.summary.fail}`);
    console.log(`${'='.repeat(60)}`);
  } catch (error) {
    console.error(`\n💥 FATAL: ${error.message}`);
    results.errors.push(error.message);
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const reportPath = path.join(OUT_DIR, 'use-case-launcher-screenshots-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Report: ${reportPath}`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  process.exit(results.summary.fail > 0 || results.errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
