/**
 * Ungoverned Agent — demo prop.
 *
 * A headless Chromium that rides a logged-in bank session and moves money
 * through the demo's own UI — the containerized, reproducible analog of an
 * agent driving your logged-in desktop Chrome (e.g. OpenCLI). It carries NO
 * agent identity, delegated token, scope, or consent: from the bank's side it
 * simply IS the user. The demo therefore records the transfer as an ordinary
 * user session (clientType='enduser'), indistinguishable from the human — which
 * is the whole point of the "Ungoverned Agent" contrast page.
 *
 * This is a demo prop, not an attack tool: it signs in as the seeded demo
 * customer and moves money between that user's own accounts.
 *
 * Flow:
 *   1. A real browser context authenticates via POST /api/auth/login, putting the
 *      connect.sid session cookie in the browser's own cookie jar — exactly the
 *      session a human gets after signing in.
 *   2. It reads /api/accounts/my to pick the from/to accounts.
 *   3. It navigates the browser to /dashboard (authenticated) and drives the real
 *      transfer form. If a selector has drifted, it falls back to a page-context
 *      fetch to the same /api/transactions endpoint the SPA itself calls — still
 *      the logged-in browser, same cookie, same origin.
 *   4. It verifies the transfer landed and reports how the demo tagged it.
 */
const { chromium } = require('playwright');

const CFG = {
  uiUrl:      (process.env.UI_URL || 'https://ui:4000').replace(/\/+$/, ''),
  // API defaults to the UI origin (same BFF behind the UI proxy) unless overridden.
  apiUrl:     (process.env.API_URL || process.env.UI_URL || 'https://ui:4000').replace(/\/+$/, ''),
  user:       process.env.DEMO_USER || 'john.doe',
  pass:       process.env.DEMO_PASS || 'password123',
  amount:     Number(process.env.AMOUNT || '50'),
  fromType:   (process.env.FROM_ACCOUNT_TYPE || 'checking').toLowerCase(),
  toType:     (process.env.TO_ACCOUNT_TYPE || 'savings').toLowerCase(),
  description: process.env.DESCRIPTION || 'Ungoverned agent transfer',
  screenshotDir: process.env.SCREENSHOT_DIR || '/tmp',
};

const log = (...a) => console.log('[ungoverned-agent]', ...a);

const typeOf = (a) => String(a.accountType || a.type || '').toLowerCase();

async function shot(page, name) {
  try {
    const path = `${CFG.screenshotDir}/ungoverned-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    log('screenshot:', path);
  } catch (e) {
    log('screenshot failed:', e.message);
  }
}

async function main() {
  log(`target UI=${CFG.uiUrl} API=${CFG.apiUrl} user=${CFG.user} amount=$${CFG.amount}`);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: CFG.uiUrl });
  const page = await context.newPage();

  try {
    // 1. Authenticate the browser context — the cookie lands in the shared jar.
    const login = await context.request.post(`${CFG.apiUrl}/api/auth/login`, {
      data: { username: CFG.user, password: CFG.pass },
    });
    if (!login.ok()) {
      throw new Error(`login failed: ${login.status()} ${await login.text()}`);
    }
    log('logged in as', CFG.user, '- session cookie acquired');

    // 2. Pick from/to accounts from the user's own accounts.
    const acctRes = await context.request.get(`${CFG.apiUrl}/api/accounts/my`);
    if (!acctRes.ok()) throw new Error(`accounts/my failed: ${acctRes.status()}`);
    const acctBody = await acctRes.json();
    const accounts = acctBody.accounts || acctBody || [];
    const from = accounts.find((a) => typeOf(a) === CFG.fromType) || accounts[0];
    const to = accounts.find((a) => typeOf(a) === CFG.toType && a.id !== from?.id)
      || accounts.find((a) => a.id !== from?.id);
    if (!from || !to) throw new Error('could not resolve two distinct accounts to transfer between');
    log(`transfer $${CFG.amount}: ${typeOf(from)} (${from.accountNumber}) -> ${typeOf(to)} (${to.accountNumber})`);

    // 3. Drive the real dashboard UI (best effort), then verify.
    await page.goto(`${CFG.uiUrl}/dashboard`, { waitUntil: 'networkidle' });
    await shot(page, 'dashboard');

    let drove = 'ui';
    try {
      // Select the FROM account by clicking the Transfer button in its card.
      // Cards carry an account-card--<type> class; the displayed number is masked,
      // so match on type (falling back to the last-4 of the account number).
      const last4 = String(from.accountNumber || '').slice(-4);
      let fromCard = page.locator(`.account-card--${CFG.fromType}`).first();
      if (!(await fromCard.count()) && last4) {
        fromCard = page.locator('.account-card', { hasText: last4 }).first();
      }
      await fromCard.locator('.select-account-btn').click({ timeout: 8000 });

      // The transfer form appears; fill it.
      const form = page.locator('.transfer-form');
      await form.locator('select').selectOption(String(to.id), { timeout: 8000 });
      await form.locator('input[type="number"]').fill(String(CFG.amount));
      await form.locator('input[type="text"]').first().fill(CFG.description);

      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/transactions') && r.request().method() === 'POST', { timeout: 15000 }),
        form.locator('.transfer-btn').click(),
      ]);
      if (!resp.ok()) throw new Error(`transfer POST returned ${resp.status()}`);
      log('transfer submitted via the dashboard UI form');
    } catch (uiErr) {
      // Fallback: issue the transfer from the page context (same browser + cookie
      // + origin the SPA uses). Still the logged-in browser — not an external script.
      log('UI form drive did not complete (', uiErr.message, ') — falling back to page-context request');
      drove = 'page-fetch';
      const result = await page.evaluate(async ({ apiUrl, payload }) => {
        const r = await fetch(`${apiUrl}/api/transactions`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { status: r.status, body: await r.text() };
      }, {
        apiUrl: CFG.apiUrl,
        payload: {
          type: 'transfer',
          amount: CFG.amount,
          fromAccountId: from.id,
          toAccountId: to.id,
          description: CFG.description,
        },
      });
      if (result.status >= 400) throw new Error(`transfer failed: ${result.status} ${result.body}`);
      log('transfer submitted via page-context fetch');
    }

    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await shot(page, 'after');

    // 4. Verify + report how the demo tagged it.
    const verify = await context.request.get(`${CFG.apiUrl}/api/transactions/my`);
    const vBody = await verify.json();
    const latest = (vBody.transactions || [])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    const clientType = latest?.clientType || 'unknown';
    log(`done (drove=${drove}). Newest transaction clientType='${clientType}'`);
    log(clientType === 'ai_agent'
      ? 'UNEXPECTED: recorded as an agent — the ungoverned path should look like a plain user session.'
      : "As expected: recorded as a DIRECT USER SESSION — indistinguishable from the human. No agent identity, scope, consent, or audit.");

    await browser.close();
    process.exit(0);
  } catch (err) {
    log('ERROR:', err.message);
    try { if (page) await shot(page, 'error'); } catch {}
    await browser.close();
    process.exit(1);
  }
}

main();
