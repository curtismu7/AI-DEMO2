// demo_api_ui/tests/e2e/helpers/restoreBankingVertical.js
// Playwright globalTeardown: put the live stack's process-global vertical
// back on banking after *.real.spec.js runs (CareConnect / retail suites).
'use strict';

const path = require('path');
const https = require('https');

async function restoreBankingVertical() {
  try {
    require('dotenv').config({
      path: path.resolve(__dirname, '../../../../../demo_api_server/.env'),
    });
  } catch (_) { /* optional */ }

  // Prefer main-checkout .env when running from a worktree.
  try {
    require('dotenv').config({
      path: '/Users/curtismuir/Development/AI-DEMO2/demo_api_server/.env',
    });
  } catch (_) { /* optional */ }

  process.env.DEMO_ADMIN_USERNAME =
    process.env.DEMO_ADMIN_USERNAME || process.env.E2E_ADMIN_USERNAME;
  process.env.DEMO_ADMIN_PASSWORD =
    process.env.DEMO_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD;

  const sessionPathCandidates = [
    path.resolve(__dirname, '../../../../../demo_api_server/tests/real/helpers/session.js'),
    '/Users/curtismuir/Development/AI-DEMO2/demo_api_server/tests/real/helpers/session.js',
  ];
  const sessionPath = sessionPathCandidates.find((p) => {
    try { return require('fs').existsSync(p); } catch (_) { return false; }
  });
  if (!sessionPath) {
    console.warn('[restoreBankingVertical] session helper not found — skip');
    return;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { resolveSession } = require(sessionPath);
  const cookie = await resolveSession('admin').catch(() => null);
  if (!cookie) {
    console.warn('[restoreBankingVertical] no admin session — skip');
    return;
  }

  const axios = require('axios');
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const base = process.env.E2E_API_BASE || 'https://api.ping.demo:3001';
  const r = await axios.post(
    `${base}/api/verticals/active`,
    { id: 'banking' },
    { httpsAgent, headers: { Cookie: cookie }, validateStatus: () => true },
  );
  console.log(`[restoreBankingVertical] POST banking → HTTP ${r.status}`);
}

module.exports = async function globalTeardown() {
  await restoreBankingVertical().catch((e) => {
    console.warn('[restoreBankingVertical] failed:', e.message);
  });
};
