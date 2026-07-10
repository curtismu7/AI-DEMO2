// @ts-check
/**
 * Playwright config for REAL-LOGIN E2E tests (banking-agent.real.spec.js).
 *
 * Unlike playwright.config.js (all mocks, CI-safe), this config:
 *  - Only runs *.real.spec.js files
 *  - Requires E2E_CUSTOMER_USERNAME + E2E_CUSTOMER_PASSWORD to be set
 *  - Defaults to targeting Vercel production (set E2E_BASE_URL to override)
 *  - Never starts a local web server (real tests target running deployments)
 *  - Loads .env.e2e automatically if present (dotenv)
 *
 * Run:
 *   cd demo_api_ui && npm run test:e2e:real              # all *.real.spec.js
 *   cd demo_api_ui && npm run test:e2e:real:careconnect # CareConnect 3-chip matrix
 *   cd demo_api_ui && npm run test:e2e:real:local        # E2E_BASE_URL=http://localhost:3000
 *   E2E_BASE_URL=https://api.ping.demo:4000 npm run test:e2e:real:careconnect
 *
 * Credentials:
 *   cp tests/e2e/.env.e2e.example tests/e2e/.env.e2e
 *   # edit tests/e2e/.env.e2e with your PingOne test user credentials
 */

// Load .env.e2e if it exists (never commit the actual file)
const path = require('path');
const fs   = require('fs');
const envFile = path.join(__dirname, 'tests/e2e/.env.e2e');
if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
}

const { defineConfig, devices } = require('@playwright/test');

const BASE_URL =
  process.env.E2E_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'https://ai-demo.ping-devops.com';

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.real.spec.js'],

  // Real tests need more time — OAuth round-trip + PingOne latency
  timeout: 60_000,

  // No retries by default — flaky real tests hide real bugs
  retries: 0,

  // Run sequentially to avoid session conflicts on the same PingOne test account
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-real', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',   // keep full trace on failure for debugging OAuth flows
    video: 'retain-on-failure',

    // Allow the real OAuth redirect chain (PingOne → app callback → dashboard)
    // Playwright default is to throw on navigation to unexpected origins.
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: 'chromium-real',
      use: {
        ...devices['Desktop Chrome'],
        ignoreHTTPSErrors: true,
        launchOptions: {
          args: ['--host-resolver-rules=MAP api.ping.demo 127.0.0.1'],
        },
      },
    },
  ],

  // No webServer — always target a running deployment
});
