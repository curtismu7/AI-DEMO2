// @ts-check
/**
 * Playwright E2E Test Configuration
 *
 * Prerequisites:
 *   npm install   (installs @playwright/test)
 *   npx playwright install chromium   (downloads browser binary)
 *
 * Run tests:
 *   npm run test:unit             # Jest (CRA), non-interactive
 *   npm run test:e2e              # all Playwright browser specs under tests/e2e
 *   npm run test:e2e:ci           # CI=true; starts CRA or reuses http://127.0.0.1:BANKING_UI_PORT
 *   npm run test:e2e:ci:reuse     # CI=true + PLAYWRIGHT_SKIP_WEBSERVER=1 (never spawn npm start)
 *   npm run test:e2e:ci:vercel    # CI=true + PLAYWRIGHT_BASE_URL=demo (no webServer; override URL if needed)
 *   npm run test:e2e:ui           # interactive UI mode
 *   npm run test:e2e:api          # API-only (health + banking-operations); needs API server
 *   npm run test:e2e:admin        # admin-dashboard.spec.js only
 *   npm run test:e2e:security     # security-settings.spec.js only
 *   npm run test:e2e:agent        # banking-agent.spec.js only
 *   npm run test:e2e:customer     # customer-dashboard.spec.js (UserDashboard mocks)
 *   npm run test:e2e:landing      # landing-marketing.spec.js (unauthenticated marketing)
 *   npm run test:e2e:ui:smoke    # customer + landing (fast UI smoke)
 *
 * Remote UI (e.g. Vercel):
 *   CI=true PLAYWRIGHT_BASE_URL=https://your-app.vercel.app npm run test:e2e:ci
 *   (webServer is omitted for non-localhost URLs; no npm start.)
 *
 * Port layouts:
 *   Standard (start.sh)  → UI :3000, API :3001
 *   run-demo.sh          → UI :4000, API :3002
 *
 * The UI port is controlled by BANKING_UI_PORT (default 3000).
 * The API port is controlled by BANKING_API_BASE env var inside each spec.
 */

const { defineConfig, devices } = require('@playwright/test');

const UI_PORT = process.env.BANKING_UI_PORT || '3000';
/** Use 127.0.0.1 so webServer health checks match CRA bind (avoids ::1 vs IPv4 mismatch). */
const LOCAL_UI_BASE = `http://127.0.0.1:${UI_PORT}`;

/** Base URL for tests (Vercel/preview or local CRA). */
const UI_BASE =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.BASE_URL ||
  LOCAL_UI_BASE;

/** Omit webServer when targeting a deployed URL or when explicitly skipping (UI already running). */
function shouldOmitWebServer() {
  if (
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1' ||
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true'
  ) {
    return true;
  }
  try {
    const host = new URL(UI_BASE).hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

const omitWebServer = shouldOmitWebServer();

module.exports = defineConfig({
  testDir: './tests/e2e',

  // API-only specs use playwright.api.config.js (BANKING_API_BASE). Do not run them here or
  // requests would go to the UI baseURL (e.g. Vercel) instead of banking_api_server.
  testIgnore: ['**/banking-operations.spec.js', '**/health.spec.js', '**/session-regression.spec.js'],

  // Fail fast on CI; allow retries locally
  retries: process.env.CI ? 2 : 0,

  // Run tests in parallel (safe since all API calls are mocked via page.route)
  workers: process.env.CI ? 1 : 2,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: UI_BASE,

    // Capture screenshots and traces on failure for debugging
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',

    // Trust mkcert local certs (api.ping.demo uses self-signed cert for local HTTPS)
    ignoreHTTPSErrors: true,

    // API requests that hit the backend directly
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start CRA only for local base URL, unless PLAYWRIGHT_SKIP_WEBSERVER is set.
  // reuseExistingServer: true — if localhost:PORT already responds, do not spawn npm start
  // (Playwright defaults reuseExistingServer to false when CI is set unless we pass true).
  ...(omitWebServer
    ? {}
    : {
        webServer: {
          command: 'npm start',
          url: LOCAL_UI_BASE,
          reuseExistingServer: true,
          timeout: 180_000,
          // CRA treats CI=true as "fail on ESLint warnings"; Playwright sets CI for retries.
          // Unset CI for the dev server child so webpack can compile with warnings.
          // Force PORT/HOST so a shell PORT=4000 (e.g. run-bank) does not break localhost:3000 tests.
          env: (() => {
            const e = { ...process.env, BROWSER: 'none' };
            delete e.CI;
            e.PORT = UI_PORT;
            e.HOST = '127.0.0.1';
            // .env may set HTTPS=true and PORT=4000 for run-bank; E2E needs plain HTTP on BANKING_UI_PORT.
            e.HTTPS = 'false';
            delete e.SSL_CRT_FILE;
            delete e.SSL_KEY_FILE;
            return e;
          })(),
        },
      }),
});
