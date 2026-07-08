#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Provision vertical-scoped PingOne groups via Management API (no full bootstrap).
 *
 * Usage:
 *   node scripts/provisionVerticalGroups.js
 *   node scripts/provisionVerticalGroups.js --vertical healthcare
 *   npm run pingone:provision-groups
 *
 * Requires PingOne worker creds (demo_api_server/.env or main checkout fallback via loadDemoEnv):
 *   PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, PINGONE_WORKER_CLIENT_SECRET
 *   PINGONE_REGION (optional, default com)
 */

const { loadDemoEnv } = require('./loadDemoEnv');
loadDemoEnv();

const { provisionVerticalGroups } = require('../services/pingOneGroupProvisionService');

function parseArgs(argv) {
  const verticalIdx = argv.indexOf('--vertical');
  if (verticalIdx >= 0 && argv[verticalIdx + 1]) {
    return { verticalId: argv[verticalIdx + 1] };
  }
  return {};
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('Provisioning vertical PingOne groups via Management API…');
  if (opts.verticalId) console.log(`  vertical: ${opts.verticalId}`);

  const result = await provisionVerticalGroups(opts);

  for (const step of result.steps) {
    const msg = step.message || step.step || '';
    console.log(`  ${step.icon || '•'} ${msg}`);
  }

  if (result.summary.missingUsers.length) {
    console.warn(`  ⚠️  Users not found (skipped membership): ${result.summary.missingUsers.join(', ')}`);
  }

  console.log(`\nDone — ${result.summary.groupsEnsured} group step(s), ${result.summary.warnings} warning(s).`);
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error('Group provision failed:', err.message);
  process.exit(1);
});
