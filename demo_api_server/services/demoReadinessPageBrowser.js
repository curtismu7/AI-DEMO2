'use strict';

/**
 * Loads one UI page in a headless browser as the lane's signed-in identity.
 *
 * The browser is a Playwright server in its own container (readiness-browser
 * in docker-compose.readiness.yml); this module only connects to it. The page
 * is the React build the lane BFF itself serves, so its API calls go to that
 * BFF with the lane session's cookies. Everything reported is something the
 * page actually did: nothing is inferred from the route table.
 */

const fs = require('node:fs');
const path = require('node:path');

const NAVIGATION_TIMEOUT_MS = 30000;
// Most pages poll and never go network-idle; each is judged on what it had
// rendered and called by then. Kept short: every page step pays it in full.
const SETTLE_TIMEOUT_MS = 5000;
const ERROR_BOUNDARY = '.error-boundary-fallback';

/**
 * Newest modification time under a directory, in ms.
 * @param {string} dir
 */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * Whether the UI build the BFFs serve is at least as new as the UI source, so
 * a page is never judged on code that is no longer in the checkout.
 * @param {string} uiRoot the demo_api_ui directory
 * @returns {{ current: boolean, reason?: string }}
 */
function uiBuildFreshness(uiRoot) {
  let builtAt;
  try { builtAt = fs.statSync(path.join(uiRoot, 'build', 'index.html')).mtimeMs; }
  catch { return { current: false, reason: 'no UI build is present (run: cd demo_api_ui && npm run build)' }; }
  let changedAt;
  try { changedAt = newestMtime(path.join(uiRoot, 'src')); }
  catch { return { current: false, reason: 'UI source is not readable by this worker' }; }
  return changedAt > builtAt
    ? { current: false, reason: 'UI build is older than the UI source (run: cd demo_api_ui && npm run build)' }
    : { current: true };
}

/**
 * @param {{ wsEndpoint: string, origin: string, cookies: Array<{name: string, value: string}>,
 *   path: string, chromium?: object }} options
 * @returns {Promise<{ status: number|null, finalPathname: string|null, rendered: boolean,
 *   errorBoundary: boolean, pageErrors: string[], failedApiCalls: string[],
 *   session: { authenticated: boolean, oauthIssuer: string|null } }>}
 */
async function loadPage({ wsEndpoint, origin, cookies, path: pagePath, chromium = require('playwright-core').chromium }) {
  const browser = await chromium.connect(wsEndpoint, { timeout: NAVIGATION_TIMEOUT_MS });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: origin })));
    const page = await context.newPage();
    const pageErrors = [];
    const failedApiCalls = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error).slice(0, 300)));
    page.on('response', (response) => {
      let url;
      try { url = new URL(response.url()); } catch { return; }
      if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 500) {
        failedApiCalls.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
      }
    });
    const navigation = await page.goto(new URL(pagePath, origin).href, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    const observed = await page.evaluate(async (boundary) => {
      const root = document.getElementById('root');
      let session = { authenticated: false, oauthIssuer: null };
      try {
        const status = await (await fetch('/api/auth/oauth/user/status', { credentials: 'same-origin' })).json();
        session = { authenticated: status?.authenticated === true, oauthIssuer: status?.oauthIssuer || null };
      } catch { /* left unauthenticated */ }
      return {
        rendered: Boolean(root && root.childElementCount > 0 && root.innerText.trim().length > 0),
        errorBoundary: Boolean(document.querySelector(boundary)),
        session,
      };
    }, ERROR_BOUNDARY);
    return {
      status: navigation ? navigation.status() : null,
      finalPathname: new URL(page.url()).pathname,
      ...observed,
      pageErrors,
      failedApiCalls,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { loadPage, uiBuildFreshness };
