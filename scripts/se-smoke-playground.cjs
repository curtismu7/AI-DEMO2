#!/usr/bin/env node
'use strict';
/**
 * Smoke test for the ID-JAG playground and Inspector on a deployed environment (SE by default).
 * Run it after every deploy. Needs a human sign-in (the sign-in has MFA), then it drives the real pages.
 *
 *   node scripts/se-smoke-playground.cjs                       # opens a visible browser, you sign in, press Enter
 *   node scripts/se-smoke-playground.cjs --cdp http://127.0.0.1:9333   # attach to a browser you already signed in
 *
 * Options: --base <url>  --out <dir>  --lanes oauth-mcp,pf-pf  --subjects OIDC,SAML  --skip-inspector
 *
 * What it checks (each line is PASS or FAIL; exit code 1 on any FAIL):
 *   per lane and subject: Request ID-JAG answers 200 and the page shows the right audience, Redeem answers 200
 *   step 4 (List tools): either 200, or a 502 that does NOT raise the sign-in dialog or the "session expired" text
 *   Inspector: Get an ID-JAG, 0 failed checks, trusted-IdP row, Show token reveals a 3-part JWT, Hide clears it,
 *              Backends starts collapsed, Discovery is not a tab
 * It never prints tokens: only status codes, lengths and the JWT header type.
 *
 * Needs: demo_api_ui dependencies installed (it uses that Playwright). Screenshots go to --out.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { createRequire } = require('module');

const requireFromUi = createRequire(path.join(__dirname, '..', 'demo_api_ui', 'package.json'));
const { chromium } = requireFromUi('@playwright/test');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);
const BASE = opt('base', 'https://ai-demo.ping-devops.com').replace(/\/$/, '');
const CDP = opt('cdp', '');
const OUT = opt('out', fs.mkdtempSync(path.join(os.tmpdir(), 'se-smoke-')));
const LANES = opt('lanes', 'oauth-mcp,pf-pf').split(',');
const SUBJECTS = opt('subjects', 'OIDC,SAML').split(',');
const AUD = { 'oauth-mcp': 'cmuir-mcp.ping-devops.com', 'pf-pf': 'cmuir-pf-acme.ping-devops.com' };
const MODE_RX = { 'oauth-mcp': '^PingFederate\\s*\\S+\\s*oauth-mcp$', 'pf-pf': '^PingFederate\\s*\\S+\\s*PingFederate$' };

const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, tries, ms = 1500) {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(ms); }
  return false;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let browser; let ctx; let launched = false; let profile = '';
  if (CDP) {
    browser = await chromium.connectOverCDP(CDP);
    ctx = browser.contexts()[0];
  } else {
    launched = true;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'se-smoke-profile-'));
    ctx = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  }
  const page = ctx.pages().find((p) => /pingfederate-id-jag\/playground/.test(p.url())) || ctx.pages()[0] || (await ctx.newPage());
  if (!/pingfederate-id-jag\/playground/.test(page.url())) await page.goto(`${BASE}/pingfederate-id-jag/playground`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (launched) {
    console.log('\nA browser window is open. Sign in to the app (user menu > Sign In), then in the first lane click');
    console.log('"Sign in with PingFederate" and finish it. When step 1 shows you are signed in, press Enter here.\n');
    await new Promise((resolve) => { const rl = readline.createInterface({ input: process.stdin }); rl.once('line', () => { rl.close(); resolve(); }); });
  }

  const api = [];
  const onResponse = async (r) => {
    const u = r.url().split('?')[0];
    if (!/\/api\/(id-jag-playground|id-jag-inspect)\/(issue|redeem|call|issued-check|issued-token|discovery)$/.test(u)) return;
    api.push({ path: u.replace(BASE, ''), status: r.status() });
  };
  ctx.on('response', onResponse);
  const lastStatus = (suffix, since) => api.slice(since).filter((a) => a.path.endsWith(suffix)).map((a) => a.status).pop();
  const bodyText = async (p) => (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }).catch(() => {});
  const clickBtn = (p, rx, flags = '') => p.evaluate(([src, f]) => { const re = new RegExp(src, f); const b = [...document.querySelectorAll('button')].find((x) => re.test((x.innerText || '').trim())); if (b && !b.disabled) { b.click(); return true; } return false; }, [rx, flags]);

  const cfg = await ctx.request.get(`${BASE}/api/id-jag-playground/config`, { failOnStatusCode: false });
  record('signed in to the app (config API 200)', cfg.status() === 200, `status ${cfg.status()}`);
  if (cfg.status() !== 200) { await finish(browser, ctx, launched, profile); return; }

  let step4Done = false;
  for (const lane of LANES) {
    const picked = await page.evaluate((rx) => { const re = new RegExp(rx); const b = [...document.querySelectorAll('button')].find((x) => re.test((x.innerText || '').trim())); if (!b) return 'missing'; if (b.getAttribute('aria-pressed') === 'true') return 'already'; b.click(); return 'clicked'; }, MODE_RX[lane]);
    await sleep(3500);
    let t = await bodyText(page);
    const signed = /Signed in/.test(t) && !/Not signed in/.test(t);
    record(`${lane}: mode available and signed in at PingFederate`, picked !== 'missing' && signed, picked === 'missing' ? 'mode button missing' : signed ? '' : 'click "Sign in with PingFederate" in step 1, then re-run');
    if (!signed) continue;
    for (const subject of SUBJECTS) {
      await page.evaluate((s) => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === s); if (b) b.click(); }, subject);
      await sleep(1500);
      let since = api.length;
      await clickBtn(page, 'Request ID-JAG');
      await waitFor(async () => lastStatus('/issue', since) !== undefined, 30);
      await sleep(2500); t = await bodyText(page);
      const issued = lastStatus('/issue', since);
      record(`${lane} ${subject}: Request ID-JAG`, issued === 200 && t.includes(AUD[lane]), `status ${issued}${t.includes(AUD[lane]) ? '' : ', audience ' + AUD[lane] + ' not shown'}`);
      await shot(page, `${lane}-${subject}-1-requested`);
      since = api.length;
      const redeemClicked = await clickBtn(page, 'Redeem ID-JAG');
      if (!redeemClicked) { record(`${lane} ${subject}: Redeem ID-JAG`, false, 'button disabled (no ID-JAG to redeem)'); continue; }
      await waitFor(async () => lastStatus('/redeem', since) !== undefined, 30);
      await sleep(2500);
      record(`${lane} ${subject}: Redeem ID-JAG`, lastStatus('/redeem', since) === 200, `status ${lastStatus('/redeem', since)}`);
      await shot(page, `${lane}-${subject}-2-redeemed`);
      if (!step4Done && lane === 'oauth-mcp') {
        step4Done = true;
        since = api.length;
        const listed = await clickBtn(page, 'List tools this token can see');
        if (listed) {
          await waitFor(async () => lastStatus('/call', since) !== undefined, 30);
          await sleep(3000);
          const st = lastStatus('/call', since); const tt = await bodyText(page);
          const dialogs = await page.locator('[role=dialog]:visible').count();
          const ok = st === 200 || (st === 502 && dialogs === 0 && !/session has expired/i.test(tt));
          record('step 4 (List tools): no false "session expired"', ok, `status ${st}, dialogs ${dialogs}${st === 502 ? ', PingOne-only note ' + (/validates tokens with PingOne only/.test(tt) ? 'shown' : 'NOT shown') : ''}`);
          await shot(page, 'step4-listtools');
        } else record('step 4 (List tools): no false "session expired"', false, 'button not available');
      }
    }
  }

  if (!flag('skip-inspector')) {
    const ins = await ctx.newPage();
    const since0 = api.length;
    await ins.goto(`${BASE}/pingfederate-id-jag/inspect`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    let t = await bodyText(ins);
    record('Inspector: Decode & check and Live log tabs, Discovery is not a tab', /Decode (&|and) check/i.test(t) && /Live log/i.test(t) && !/\bDiscovery\b/.test(t));
    const collapsed = await ins.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /Backends/i.test(x.innerText || '')); return d ? !d.open : null; });
    record('Inspector: Backends section starts collapsed', collapsed === true, collapsed === null ? 'section missing' : '');
    let since = api.length;
    const got = await clickBtn(ins, '^Get an ID-JAG$');
    await waitFor(async () => lastStatus('/issued-check', since) !== undefined, 30);
    await sleep(2500); t = await bodyText(ins);
    const fails = (t.match(/\bFail\b/g) || []).length; const passes = (t.match(/\bPass\b/g) || []).length;
    record('Inspector: Get an ID-JAG, checks run', got && lastStatus('/issued-check', since) === 200 && /Detected:\s*ID-JAG/i.test(t) && fails === 0 && passes > 0, `status ${lastStatus('/issued-check', since)}, pass ${passes}, fail ${fails}`);
    record('Inspector: trusted-IdP row shows the issuer', /issuer:\s*trusted IdP\s*"/i.test(t));
    await shot(ins, 'inspector-1-checks');
    since = api.length;
    const shown = await clickBtn(ins, '^Show token$');
    await waitFor(async () => lastStatus('/issued-token', since) !== undefined, 20, 1000);
    await sleep(1500);
    const info = await ins.evaluate(() => {
      const ta = [...document.querySelectorAll('textarea')].find((x) => x.readOnly); if (!ta) return null;
      const v = ta.value || ''; let typ = null;
      try { typ = JSON.parse(atob(v.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).typ; } catch (e) { /* header not JSON */ }
      return { parts: v.split('.').length, typ };
    });
    record('Inspector: Show token reveals a 3-part ID-JAG', shown && lastStatus('/issued-token', since) === 200 && !!info && info.parts === 3 && info.typ === 'oauth-id-jag+jwt', info ? `parts ${info.parts}, typ ${info.typ}` : 'no read-only box');
    await clickBtn(ins, 'Hide token');
    await sleep(800);
    const hidden = await ins.evaluate(() => ![...document.querySelectorAll('textarea')].some((x) => x.readOnly && (x.value || '').startsWith('eyJ')));
    record('Inspector: Hide token clears it', hidden);
    await ins.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => /Backends/i.test(x.innerText || '')); if (d) d.open = true; });
    await waitFor(async () => lastStatus('/discovery', since0) !== undefined, 15, 1000);
    record('Inspector: Backends discovery loads', lastStatus('/discovery', since0) === 200, `status ${lastStatus('/discovery', since0)}`);
    await shot(ins, 'inspector-2-backends');
    await ins.close();
  }
  await finish(browser, ctx, launched, profile);
}

async function finish(browser, ctx, launched, profile) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: ${OUT}`);
  if (launched) { await ctx.close().catch(() => {}); if (profile) fs.rmSync(profile, { recursive: true, force: true }); } else { await browser.close().catch(() => {}); }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error('smoke test crashed:', e.message.slice(0, 300)); process.exit(2); });
