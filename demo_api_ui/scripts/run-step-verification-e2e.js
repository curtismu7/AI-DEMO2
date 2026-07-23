// demo_api_ui/scripts/run-step-verification-e2e.js
// Load E2E creds from the main checkout .env and spawn Playwright (no shell eval).
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: '/Users/curtismuir/Development/AI-DEMO2/demo_api_server/.env' });

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
