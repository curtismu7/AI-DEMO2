/**
 * @file realLogin.js
 * @description Real PingOne login helpers for Playwright E2E tests.
 *
 * These helpers perform an actual browser-driven OAuth login against PingOne
 * instead of mocking the /api/auth/oauth/user/status response.
 *
 * Required env variables (set in .env.e2e or shell — never commit values):
 *
 *   E2E_BASE_URL          Base URL of the running app
 *                         e.g. https://ai-demo.ping-devops.com  (AWS deployment)
 *                         or   http://localhost:3000               (local)
 *
 *   E2E_CUSTOMER_USERNAME PingOne username of the test customer account
 *   E2E_CUSTOMER_PASSWORD Password for the test customer account
 *
 *   E2E_ADMIN_USERNAME    PingOne username of the test admin account
 *   E2E_ADMIN_PASSWORD    Password for the test admin account
 *
 * Optional:
 *   E2E_PINGONE_LOGIN_TIMEOUT  ms to wait for PingOne login page (default 20000)
 *   E2E_POST_LOGIN_TIMEOUT     ms to wait for dashboard after callback (default 30000)
 *
 * Usage:
 *   const { loginAsCustomer, loginAsAdmin, requireRealLoginEnv } = require('./realLogin');
 *
 *   test.describe('Real login tests', () => {
 *     test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME not set');
 *
 *     test('customer can open agent', async ({ page }) => {
 *       await loginAsCustomer(page);
 *       // page is now on /dashboard, fully authenticated
 *     });
 *   });
 *
 * Authentication strategy:
 *   1. Navigate to /api/auth/oauth/user/login  (or /api/auth/oauth/login for admin)
 *   2. PingOne redirects browser to its hosted login page
 *   3. Fill username + password, submit
 *   4. PingOne redirects back via OAuth callback → app stores session
 *   5. App redirects to /dashboard (customer) or /admin (admin)
 *   6. Wait for the dashboard page to settle before returning
 *
 * Session storage:
 *   Playwright storageState can be used to cache a logged-in session so
 *   subsequent tests in the same file skip the full login flow.
 *   See saveCustomerSession() / reuseCustomerSession() below.
 */

const path = require('path');
const fs   = require('fs');
const { mainCheckoutPath } = require('./repoRoots');

const LOGIN_TIMEOUT      = Number(process.env.E2E_PINGONE_LOGIN_TIMEOUT)  || 20_000;
const POST_LOGIN_TIMEOUT = Number(process.env.E2E_POST_LOGIN_TIMEOUT)     || 30_000;

/** Ensure a filled value stuck (PingOne sometimes ignores the first fill). */
async function expectFilled(locator, value) {
  const got = await locator.inputValue().catch(() => '');
  if (got === value) return;
  await locator.fill('');
  await locator.fill(value);
  const again = await locator.inputValue().catch(() => '');
  if (again !== value) {
    throw new Error(`PingOne password/username fill failed (len got=${again.length} want=${value.length})`);
  }
}

// ─── Env guard helpers ────────────────────────────────────────────────────────

/**
 * Returns true when all required customer login env vars are present.
 * Use this in test.skip() to avoid failing in CI that doesn't have credentials.
 */
function requireRealLoginEnv() {
  return !!(
    process.env.E2E_CUSTOMER_USERNAME &&
    process.env.E2E_CUSTOMER_PASSWORD
  );
}

/**
 * Returns true when admin login env vars are present.
 */
function requireAdminLoginEnv() {
  return !!(
    process.env.E2E_ADMIN_USERNAME &&
    process.env.E2E_ADMIN_PASSWORD
  );
}

/** Base URL for real-login specs (playwright.real.config.js default). */
function getE2eBaseUrl() {
  return (
    process.env.E2E_BASE_URL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    'https://ai-demo.ping-devops.com'
  );
}

/**
 * Poll until the SPA responds (CRA compile after ./run.sh start).
 * @param {import('@playwright/test').APIRequestContext} [request]
 * @param {{ timeoutMs?: number }} [options]
 */
async function waitForE2eBaseUrl(request, options = {}) {
  const baseUrl = getE2eBaseUrl().replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unreachable';

  while (Date.now() < deadline) {
    try {
      const res = request
        ? await request.get(`${baseUrl}/`, { timeout: 5_000 })
        : null;
      if (res) {
        lastStatus = String(res.status());
        if (res.ok() || (res.status() >= 300 && res.status() < 500)) {
          return baseUrl;
        }
      }
    } catch (err) {
      lastStatus = err.message || 'error';
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  throw new Error(
    `E2E app not ready at ${baseUrl} within ${timeoutMs}ms (last: ${lastStatus}). ` +
      'Run ./run.sh start and wait until https://api.ping.demo:4000 returns 200.',
  );
}

// ─── Core login flow ──────────────────────────────────────────────────────────

/**
 * Drives a browser through a PingOne-hosted login page.
 *
 * PingOne form selectors work for the standard hosted DaVinci login page.
 * If your flow has MFA or a custom form, extend the `postSubmitSteps` option.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.loginInitUrl   - App route that triggers the OAuth redirect
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {string} [opts.expectedLandingPath] - URL pattern to wait for after login (default /dashboard)
 */
async function driveLogin(page, { loginInitUrl, username, password, expectedLandingPath = '/dashboard' }) {
  // Clear any leftover "logged out" flag
  await page.addInitScript(() => {
    try { localStorage.removeItem('userLoggedOut'); } catch (_) {}
  });

  // Trigger the OAuth redirect
  await page.goto(loginInitUrl);

  // Wait for PingOne to load its login form.
  // PingOne hosted pages use an <input> with id="username" and id="password".
  await page.waitForSelector('input[name="username"], input[id="username"], input[type="email"]', {
    timeout: LOGIN_TIMEOUT,
  });

  // Fill credentials — handle both id and name variants
  const usernameInput = page.locator('input[name="username"], input[id="username"], input[type="email"]').first();
  const passwordInput = page.locator('input[name="password"], input[id="password"], input[type="password"]').first();

  await usernameInput.fill(username);

  // Some PingOne flows ask for username first, then present password on the next screen.
  // Re-query after that navigation — a pre-step locator goes stale / is not the visible field.
  const passwordVisible = await passwordInput.isVisible().catch(() => false);
  if (!passwordVisible) {
    await page.locator('button[type="submit"], button:has-text("Next"), button:has-text("Sign On")').first().click();
    await page.getByRole('textbox', { name: /Password/i }).waitFor({ timeout: LOGIN_TIMEOUT });
  }
  const passwordField = page.getByRole('textbox', { name: /Password/i });
  await passwordField.click();
  await passwordField.fill(password);
  await expectFilled(passwordField, password);

  // Submit the login form (PingOne hosted page uses "Sign On")
  const signOn = page.getByRole('button', { name: /Sign On/i });
  if (await signOn.count()) {
    await signOn.first().click();
  } else {
    await page.locator('button[type="submit"]').first().click();
  }

  // Wait for the app to redirect back and settle on the expected page.
  // Uses a loose URL match so /dashboard?oauth=success also counts.
  await page.waitForURL(`**${expectedLandingPath}**`, { timeout: POST_LOGIN_TIMEOUT });

  // Wait for React to hydrate (status endpoint must have resolved)
  await page.waitForSelector('[class*="dashboard"], [class*="ba-subtitle"], .banking-agent-fab', {
    timeout: POST_LOGIN_TIMEOUT,
  }).catch(() => {
    // Non-fatal — some redirect paths don't have these selectors
  });
}

// ─── Public login helpers ─────────────────────────────────────────────────────

/**
 * Login as a customer via the real PingOne OAuth flow.
 * After this returns, `page` is on /dashboard and the session cookie is set.
 *
 * @param {import('@playwright/test').Page} page
 */
/**
 * Prefer headless BFF/PingOne login (API flow) and transplant connect.sid onto
 * the Playwright page origin. Falls back to browser-driven hosted login.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginAsCustomer(page) {
  const username = process.env.E2E_CUSTOMER_USERNAME;
  const password = process.env.E2E_CUSTOMER_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD must be set to use loginAsCustomer()'
    );
  }

  const viaApi = await loginAsCustomerViaApiCookie(page).catch((err) => {
    console.warn(`[realLogin] API cookie login failed: ${err.message} — falling back to browser`);
    return false;
  });
  if (viaApi) return;

  await driveLogin(page, {
    loginInitUrl: '/api/auth/oauth/user/login?force=true',
    username,
    password,
    expectedLandingPath: '/dashboard',
  });
}

/**
 * Headless usernamePassword.check against PingOne via the BFF login helpers,
 * then set connect.sid on the current page's origin.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} true when session cookie was applied
 */
async function loginAsCustomerViaApiCookie(page) {
  // Resolve from the main-checkout real helpers (shared LMDB / BFF).
  const sessionHelper = path.resolve(
    __dirname,
    '../../../../../demo_api_server/tests/real/helpers/session.js',
  );
  // Worktree path: demo_api_ui/tests/e2e/helpers → up 5 = repo root's parent when
  // in .worktrees/<name>; prefer relative-to-repo via env or sibling main checkout.
  const candidates = [
    sessionHelper,
    path.resolve(__dirname, '../../../../../../demo_api_server/tests/real/helpers/session.js'),
    // Derived, not hardcoded: the old absolute named a user that does not exist.
    mainCheckoutPath('demo_api_server', 'tests', 'real', 'helpers', 'session.js'),
  ].filter(Boolean);
  const sessionPath = candidates.find((p) => fs.existsSync(p));
  if (!sessionPath) throw new Error('session.js helper not found');

  // Ensure DEMO_USER_* are populated for resolveSession.
  process.env.DEMO_USER_USERNAME = process.env.DEMO_USER_USERNAME || process.env.E2E_CUSTOMER_USERNAME;
  process.env.DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD || process.env.E2E_CUSTOMER_PASSWORD;

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { resolveSession } = require(sessionPath);
  const cookiePair = await resolveSession('enduser');
  if (!cookiePair || !cookiePair.startsWith('connect.sid=')) {
    throw new Error('resolveSession did not return connect.sid');
  }
  const value = cookiePair.slice('connect.sid='.length);
  const base = getE2eBaseUrl();
  const u = new URL(base);
  await page.context().addCookies([{
    name: 'connect.sid',
    value: decodeURIComponent(value),
    domain: u.hostname,
    path: '/',
    secure: u.protocol === 'https:',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await page.goto(`${base.replace(/\/$/, '')}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[class*="dashboard"], [class*="ba-subtitle"], .banking-agent-fab', {
    timeout: POST_LOGIN_TIMEOUT,
  });
  return true;
}

/**
 * Login as an admin via the real PingOne OAuth flow.
 * After this returns, `page` is on /admin and the session cookie is set.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loginAsAdmin(page) {
  const username = process.env.E2E_ADMIN_USERNAME;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD must be set to use loginAsAdmin()'
    );
  }
  await driveLogin(page, {
    loginInitUrl: '/api/auth/oauth/login',
    username,
    password,
    expectedLandingPath: '/admin',
  });
}

// ─── Session caching (optional — speeds up multi-test suites) ─────────────────

const SESSION_DIR  = path.join(__dirname, '../.auth');
const CUSTOMER_SESSION_FILE = path.join(SESSION_DIR, 'customer.json');
const ADMIN_SESSION_FILE    = path.join(SESSION_DIR, 'admin.json');

/**
 * Perform a real login, then save the browser session to disk so subsequent
 * test files can skip the login step via reuseCustomerSession().
 *
 * Typical usage in a global setup file:
 *   const { saveCustomerSession } = require('./helpers/realLogin');
 *   module.exports = async ({ browser }) => { await saveCustomerSession(browser); };
 *
 * @param {import('@playwright/test').Browser} browser
 */
async function saveCustomerSession(browser) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsCustomer(page);
  await context.storageState({ path: CUSTOMER_SESSION_FILE });
  await context.close();
}

async function saveAdminSession(browser) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsAdmin(page);
  await context.storageState({ path: ADMIN_SESSION_FILE });
  await context.close();
}

/**
 * Returns Playwright storageState options that reuse a cached customer session.
 * Use as: `test.use({ storageState: reuseCustomerSession() })`.
 * Falls back to no storageState if the file doesn't exist (forces re-login).
 */
function reuseCustomerSession() {
  return fs.existsSync(CUSTOMER_SESSION_FILE) ? CUSTOMER_SESSION_FILE : undefined;
}

function reuseAdminSession() {
  return fs.existsSync(ADMIN_SESSION_FILE) ? ADMIN_SESSION_FILE : undefined;
}

module.exports = {
  requireRealLoginEnv,
  requireAdminLoginEnv,
  getE2eBaseUrl,
  waitForE2eBaseUrl,
  loginAsCustomer,
  loginAsAdmin,
  saveCustomerSession,
  saveAdminSession,
  reuseCustomerSession,
  reuseAdminSession,
};
