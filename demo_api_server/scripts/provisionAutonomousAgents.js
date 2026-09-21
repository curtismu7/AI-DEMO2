#!/usr/bin/env node
'use strict';

const configStore = require('../services/configStore');
const { PingOneProvisionService } = require('../services/pingoneProvisionService');
const { planAutonomousAgentProvisioning, provisionAutonomousAgents } = require('../services/autonomousAgentProvisionService');

const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log('Usage: npm run pingone:provision-autonomous-agents [--apply]');
  console.log('Default is a dry-run. --apply creates/reads the two dedicated autonomous-agent registrations and stores their credentials.');
  process.exit(0);
}

async function main() {
  const dryRun = !args.has('--apply');
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, ...planAutonomousAgentProvisioning() }, null, 2));
    return;
  }

  const required = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required provisioning variables: ${missing.join(', ')}`);

  const service = new PingOneProvisionService();
  await service.initialize(
    process.env.PINGONE_ENVIRONMENT_ID,
    process.env.PINGONE_WORKER_CLIENT_ID,
    process.env.PINGONE_WORKER_CLIENT_SECRET,
    process.env.PINGONE_REGION || 'com',
  );
  const result = await provisionAutonomousAgents({ dryRun: false, service, configStore });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
