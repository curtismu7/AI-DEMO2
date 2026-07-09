// One-shot: login → activate vertical → click first heuristic chip → screenshot Token Chain
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4010';
const API = process.env.E2E_API_URL || 'https://api.ping.demo:3001';
const USER = process.env.E2E_CUSTOMER_USERNAME || 'demoUser';
const PASS = process.env.E2E_CUSTOMER_PASSWORD || '2Federate!';
const OUT = process.env.REPORT_DIR ||
  '/Users/curtismuir/Development/AI-DEMO2-fix-token-chain-heuristics-all-verticals/docs/reports/token-chain-heuristics-verticals-2026-07-08';

const VERTICALS = [
  { id: 'healthcare', name: 'CareConnect', chipText: /coverage|accounts|balance|My |Check /i },
  { id: 'government', name: 'CivicPermit', chipText: /permit|license|application|My |Check /i },
  { id: 'banking', name: 'Super Banking', chipText: /My accounts|Check balance|Recent transactions/i },
];

fs.mkdirSync(OUT, { recursive: true });
const results = [];

function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  return page.screenshot({ path: file, fullPage: false }).then(() => file);
}

async function login(page) {
  await page.goto(`${BASE}/api/auth/oauth/user/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // PingOne hosted login
  await page.waitForURL(/pingone\.com|auth\.pingone|localhost|127\.0\.0\.1/, { timeout: 60000 });
  // Username
  const userSel = 'input[name="username"], input#username, input[type="email"], input[autocomplete="username"]';
  await page.waitForSelector(userSel, { timeout: 30000 });
  await page.fill(userSel, USER);
  // Next or password on same page
  const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue"), button[type="submit"]').first();
  if (await page.locator('input[type="password"]').count() === 0) {
    await nextBtn.click();
  }
  const passSel = 'input[name="password"], input#password, input[type="password"]';
  await page.waitForSelector(passSel, { timeout: 30000 });
  await page.fill(passSel, PASS);
  await page.locator('button:has-text("Sign On"), button:has-text("Sign in"), button:has-text("Submit"), button[type="submit"]').first().click();
  await page.waitForURL(/dashboard|admin|\//, { timeout: 60000 });
  // settle
  await page.waitForTimeout(2000);
}

async function activateVertical(page, verticalId) {
  // Prefer API with session cookies from the page context
  const res = await page.request.post(`${BASE}/api/verticals/active`, {
    data: { id: verticalId },
    headers: { 'Content-Type': 'application/json' },
  });
  // Fallback to absolute API if proxy path differs
  if (![200, 204].includes(res.status())) {
    const res2 = await page.request.post(`${API}/api/verticals/active`, {
      data: { id: verticalId },
      headers: { 'Content-Type': 'application/json' },
    });
    return res2.status();
  }
  return res.status();
}

async function openActionsAndClickChip(page, chipText) {
  // Open Actions dropdown — several possible labels
  const actions = page.locator('button:has-text("Actions"), [aria-label*="Actions"], .banking-chips-dropdown__trigger, button:has-text("Ask")').first();
  if (await actions.count()) {
    await actions.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
  // Prefer data-chip-id buttons that are not LLM
  const chip = page.locator('.banking-chips-dropdown__button--heuristic, .banking-chips-dropdown__button').filter({ hasText: chipText }).first();
  if (await chip.count() === 0) {
    // any heuristic chip
    const any = page.locator('.banking-chips-dropdown__button--heuristic').first();
    if (await any.count()) {
      await any.click();
      return await any.innerText();
    }
    throw new Error('No heuristic chip found in Actions dropdown');
  }
  const label = (await chip.innerText()).trim();
  await chip.click();
  return label;
}

async function openTokenChain(page) {
  // Token Chain rail / tab
  const candidates = [
    'button:has-text("Token Chain")',
    '[data-testid="token-chain"]',
    'button:has-text("Tokens")',
    '.tctr-rail',
    'text=Token Chain',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      try { await loc.click({ timeout: 2000 }); } catch {}
      break;
    }
  }
  await page.waitForTimeout(800);
}

async function readHeuristicSteps(page) {
  // Collect step titles/lanes/status from Token Chain Trace Rail
  return await page.evaluate(() => {
    const steps = [...document.querySelectorAll('.tctr-step')].map((el) => {
      const title = el.querySelector('.tctr-step-title')?.textContent?.trim() || '';
      const lane = el.querySelector('.tctr-lane')?.textContent?.trim() || '';
      const status = el.getAttribute('data-status') || '';
      const icon = el.querySelector('.tctr-ic')?.textContent?.trim() || '';
      return { title, lane, status, icon };
    });
    return steps;
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  console.log('Logging in…');
  await login(page);
  await shot(page, '00-after-login');
  console.log('Logged in at', page.url());

  for (const v of VERTICALS) {
    const row = { vertical: v.id, name: v.name, ok: false, chip: null, steps: [], notes: [], screenshots: [] };
    try {
      console.log(`\n=== ${v.name} (${v.id}) ===`);
      const st = await activateVertical(page, v.id);
      row.notes.push(`activateVertical HTTP ${st}`);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
      row.screenshots.push(await shot(page, `${v.id}-01-dashboard`));

      // Open agent / actions if needed
      const agentBtn = page.locator('button:has-text("Actions"), button:has-text("Ask the agent"), .ba-fab, [aria-label*="agent" i]').first();
      if (await agentBtn.count()) {
        await agentBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }
      row.screenshots.push(await shot(page, `${v.id}-02-actions-open`));

      const chipLabel = await openActionsAndClickChip(page, v.chipText);
      row.chip = chipLabel;
      row.notes.push(`clicked chip: ${chipLabel}`);
      await page.waitForTimeout(4000); // allow pipeline
      row.screenshots.push(await shot(page, `${v.id}-03-after-chip`));

      await openTokenChain(page);
      row.screenshots.push(await shot(page, `${v.id}-04-token-chain`));

      const steps = await readHeuristicSteps(page);
      row.steps = steps;
      const s4 = steps.find((s) => /Heuristics — intent|LLM — reasoning|4\./.test(s.title));
      const s11 = steps.find((s) => /Heuristics composes|LLM composes|11\./.test(s.title));
      row.step4 = s4 || null;
      row.step11 = s11 || null;
      const heuristicsOk =
        s4 && s4.lane === 'HEURISTICS' && s4.status === 'done' &&
        s11 && s11.lane === 'HEURISTICS';
      // step 11 may still be pending until mcpDone; allow done OR title/lane correct
      row.ok = !!(s4 && s4.lane === 'HEURISTICS' && s4.status === 'done' && s11 && s11.lane === 'HEURISTICS');
      row.notes.push(heuristicsOk ? 'HEURISTICS labels verified' : 'HEURISTICS labels incomplete');
      console.log(JSON.stringify({ chip: chipLabel, step4: s4, step11: s11, ok: row.ok }, null, 2));
    } catch (e) {
      row.notes.push(`ERROR: ${e.message}`);
      try { row.screenshots.push(await shot(page, `${v.id}-error`)); } catch {}
      console.error(v.id, e);
    }
    results.push(row);
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log('\nWrote', path.join(OUT, 'results.json'));
console.log(JSON.stringify(results.map((r) => ({ name: r.name, ok: r.ok, chip: r.chip, notes: r.notes })), null, 2));
