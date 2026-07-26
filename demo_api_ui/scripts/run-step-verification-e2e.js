// demo_api_ui/scripts/run-step-verification-e2e.js
// Load E2E creds from the main checkout .env and spawn Playwright (no shell eval).
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// Derived, not hardcoded. The old absolute path named user `curtismuir`; the
// real account is `cmuir`, so dotenv loaded nothing — and because dotenv reports
// "injected env (0)" instead of throwing, every spec this script launched ran
// without E2E creds and silently test.skip()'d.
const { mainCheckoutPath } = require('../tests/e2e/helpers/repoRoots');

const envPath = mainCheckoutPath('demo_api_server', '.env');
if (!envPath) {
  console.error('[run-step-verification-e2e] could not locate the main checkout — no .env loaded');
} else {
  require('dotenv').config({ path: envPath });
}

const env = {
  ...process.env,
  E2E_CUSTOMER_USERNAME:
    process.env.E2E_CUSTOMER_USERNAME || process.env.DEMO_USER_USERNAME || '',
  E2E_CUSTOMER_PASSWORD:
    process.env.E2E_CUSTOMER_PASSWORD || process.env.DEMO_USER_PASSWORD || '',
  E2E_BASE_URL:
    process.env.E2E_BASE_URL || 'https://local.ping-devops.com:4000',
  E2E_POST_LOGIN_TIMEOUT: process.env.E2E_POST_LOGIN_TIMEOUT || '90000',
};

if (!env.E2E_CUSTOMER_USERNAME || !env.E2E_CUSTOMER_PASSWORD) {
  console.error('Missing E2E_CUSTOMER_USERNAME / E2E_CUSTOMER_PASSWORD (or DEMO_USER_*)');
  process.exit(2);
}

const args = process.argv.slice(2);
const r = spawnSync(
  'npx',
  [
    'playwright',
    'test',
    'tests/e2e/stepVerification.banking.real.spec.js',
    '--config=playwright.real.config.js',
    ...args,
  ],
  { env, stdio: 'inherit', cwd: path.resolve(__dirname, '..') },
);
process.exit(r.status == null ? 1 : r.status);
