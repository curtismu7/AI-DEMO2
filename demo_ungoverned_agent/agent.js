/**
 * Ungoverned Agent — demo prop.
 *
 * A headless Chromium that rides a logged-in bank session and moves money
 * through the demo's own UI — the containerized, reproducible analog of an
 * agent driving your logged-in desktop Chrome (e.g. OpenCLI). It carries NO
 * agent identity, delegated token, scope, or consent: it reuses the human's
 * own session, so the demo records the transfer as an ordinary user session
 * (clientType='enduser'), indistinguishable from the human — which is the whole
 * point of the "Ungoverned Agent" contrast page.
 *
 * This is a demo prop, not an attack tool: it acts as the demo customer and
 * moves money between that user's own accounts.
 *
 * AUTH — the bank's APIs require a real PingOne customer session, so supply one:
 *   • SESSION_COOKIE  (recommended, most faithful): the value of the `connect.sid`
 *       cookie copied from a signed-in customer's browser. The headless browser
 *       loads it and drives the real transfer form — literally riding the human's
 *       logged-in session. This is the sharpest telling of the anti-pattern.
 *   • ACCESS_TOKEN: a customer OAuth bearer token; the transfer is issued with an
 *       Authorization header (API-style, no UI session).
 *   • ALLOW_LOCAL_LOGIN=true + DEMO_USER/DEMO_PASS: local password login. Only
 *       works on deployments that accept local sessions for banking APIs; the
 *       default PingOne-gated stack does NOT, so this is a dev-only convenience.
 *
 * Flow: authenticate → read /api/accounts/my → drive the transfer (UI form when
 * riding a browser session; Authorization header in token mode) → verify how the
 * demo tagged it.
 */
const { chromium } = require('playwright');

const CFG = {
  uiUrl:      (process.env.UI_URL || 'https://ui:4000').replace(/\/+$/, ''),
  apiUrl:     (process.env.API_URL || process.env.UI_URL || 'https://ui:4000').replace(/\/+$/, ''),
  sessionCookie: process.env.SESSION_COOKIE || '',
  accessToken:   process.env.ACCESS_TOKEN || '',
  allowLocalLogin: process.env.ALLOW_LOCAL_LOGIN === 'true',
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
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function shot(page, name) {
  if (!page) return;
  try {
    const path = `${CFG.screenshotDir}/ungoverned-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    log('screenshot:', path);
  } catch (e) {
    log('screenshot failed:', e.message);
  }
}

// Cookie value copied from a browser is URL-encoded (e.g. "s%3A..."); Playwright
// wants it as-is. Derive the cookie domain from the UI origin.
function cookieForContext() {
  const host = new URL(CFG.uiUrl).hostname;
  return {
    name: 'connect.sid',
    value: CFG.sessionCookie,
    domain: host,
    path: '/',
    httpOnly: true,
    secure: CFG.uiUrl.startsWith('https'),
    sameSite: 'Lax',
  };
}

async function main() {
  const mode = CFG.accessToken ? 'token' : CFG.sessionCookie ? 'cookie'
    : CFG.allowLocalLogin ? 'local' : null;
  if (!mode) {
    log('ERROR: no session supplied. Set SESSION_COOKIE (recommended) or ACCESS_TOKEN,');
    log('       or ALLOW_LOCAL_LOGIN=true for dev deployments. See the runbook.');
    process.exit(2);
  }
  log(`target UI=${CFG.uiUrl} API=${CFG.apiUrl} auth=${mode} amount=$${CFG.amount}`);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: CFG.uiUrl,
    extraHTTPHeaders: mode === 'token' ? { Authorization: `Bearer ${CFG.accessToken}` } : {},
  });
  const page = await context.newPage();

  try {
    // 1. Establish the session on the browser context.
    if (mode === 'cookie') {
      await context.addCookies([cookieForContext()]);
      log('loaded customer session cookie into the browser');
    } else if (mode === 'local') {
      const login = await context.request.post(`${CFG.apiUrl}/api/auth/login`, {
        data: { username: CFG.user, password: CFG.pass },
      });
      if (!login.ok()) throw new Error(`local login failed: ${login.status()} ${await login.text()}`);
      log('local login OK for', CFG.user, '(dev mode)');
    } else {
      log('using ACCESS_TOKEN bearer for API calls');
    }

    // 2. Resolve from/to accounts (proves the session is actually valid).
    const acctRes = await context.request.get(`${CFG.apiUrl}/api/accounts/my`);
    if (acctRes.status() === 401 || acctRes.status() === 403) {
      throw new Error(
        `session rejected by /api/accounts/my (${acctRes.status()}). The bank APIs require a valid ` +
        `PingOne customer session — supply a fresh SESSION_COOKIE or ACCESS_TOKEN from a signed-in customer.`
      );
    }
    if (!acctRes.ok()) throw new Error(`accounts/my failed: ${acctRes.status()}`);
    const acctBody = await acctRes.json();
    const accounts = acctBody.accounts || acctBody || [];
    const from = accounts.find((a) => typeOf(a) === CFG.fromType) || accounts[0];
    const to = accounts.find((a) => typeOf(a) === CFG.toType && a.id !== from?.id)
      || accounts.find((a) => a.id !== from?.id);
    if (!from || !to) throw new Error('could not resolve two distinct accounts to transfer between');
    log(`transfer $${CFG.amount}: ${typeOf(from)} (${from.accountNumber}) -> ${typeOf(to)} (${to.accountNumber})`);

    const payload = {
      type: 'transfer', amount: CFG.amount,
      fromAccountId: from.id, toAccountId: to.id, description: CFG.description,
    };

    // 3. Perform the transfer.
    if (mode === 'token') {
      // API-style: a headless client wielding a stolen bearer token.
      const r = await context.request.post(`${CFG.apiUrl}/api/transactions`, {
        headers: JSON_HEADERS, data: payload,
      });
      if (r.status() === 428) {
        // The transfer tripped a policy-driven human-in-the-loop consent (a control
        // tied to the user, requiring genuine step-up the rider can't fake). Fall
        // back to a lower-friction write to still demonstrate the clientType point:
        // even this proceeds with full user power and no agent attribution.
        log('transfer required human consent (428 HITL) — a real control; falling back to a deposit to show the clientType');
        const d = await context.request.post(`${CFG.apiUrl}/api/transactions`, {
          headers: JSON_HEADERS,
          data: { type: 'deposit', amount: CFG.amount, toAccountId: to.id, description: `${CFG.description} (deposit)` },
        });
        if (d.status() >= 400) throw new Error(`deposit failed: ${d.status()} ${await d.text()}`);
        log('deposit submitted via bearer token (API mode)');
      } else if (r.status() >= 400) {
        throw new Error(`transfer failed: ${r.status()} ${await r.text()}`);
      } else {
        log('transfer submitted via bearer token (API mode)');
      }
    } else {
      // Session-riding: drive the real dashboard UI with the human's cookie.
      await page.goto(`${CFG.uiUrl}/dashboard`, { waitUntil: 'networkidle' });
      await shot(page, 'dashboard');
      try {
        const last4 = String(from.accountNumber || '').slice(-4);
        let fromCard = page.locator(`.account-card--${CFG.fromType}`).first();
        if (!(await fromCard.count()) && last4) {
          fromCard = page.locator('.account-card', { hasText: last4 }).first();
        }
        await fromCard.locator('.select-account-btn').click({ timeout: 8000 });
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
        // Fallback: issue from the page context — same browser, cookie, and origin
        // the SPA uses. Still the logged-in browser, not an external script.
        log('UI form drive did not complete (', uiErr.message, ') — falling back to page-context request');
        const result = await page.evaluate(async ({ apiUrl, payload }) => {
          const r = await fetch(`${apiUrl}/api/transactions`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          });
          return { status: r.status, body: await r.text() };
        }, { apiUrl: CFG.apiUrl, payload });
        if (result.status >= 400) throw new Error(`transfer failed: ${result.status} ${result.body}`);
        log('transfer submitted via page-context fetch');
      }
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
      await shot(page, 'after');
    }

    // 4. Verify + report how the demo tagged it.
    const verify = await context.request.get(`${CFG.apiUrl}/api/transactions/my`);
    const vBody = await verify.json();
    const latest = (vBody.transactions || [])
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    const clientType = latest?.clientType || 'unknown';
    log(`done. Newest transaction clientType='${clientType}'`);
    log(clientType === 'ai_agent'
      ? 'UNEXPECTED: recorded as an agent — the ungoverned path should look like a plain user session.'
      : "As expected: recorded as a DIRECT USER SESSION — indistinguishable from the human. No agent identity, scope, consent, or audit.");

    await browser.close();
    process.exit(0);
  } catch (err) {
    log('ERROR:', err.message);
    await shot(page, 'error');
    await browser.close();
    process.exit(1);
  }
}

main();
