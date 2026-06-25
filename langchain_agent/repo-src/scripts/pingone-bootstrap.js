#!/usr/bin/env node
// scripts/pingone-bootstrap.js
// Load demo_api_server/.env for probe; print planned steps from manifest.
// Legacy plan/preview path — the full provisioner is `npm run pingone:bootstrap`
// (demo_api_server/scripts/bootstrapPingOne.js).
//
// Usage:
//   npm run pingone:bootstrap:legacy-manifest
//   npm run pingone:bootstrap:probe
//   node scripts/pingone-bootstrap.js --manifest=/path/to/manifest.json

'use strict';

const path = require('path');
const fs = require('fs');

// Load API server .env via demo_api_server's dotenv (root package has no dotenv dependency).
try {
  require(path.join(__dirname, '../demo_api_server/node_modules/dotenv')).config({
    path: path.join(__dirname, '../demo_api_server/.env'),
  });
} catch (_) {
  /* optional — probe relies on shell env if dotenv missing */
}

const configStore = require('../demo_api_server/services/configStore');
const {
  planStepsFromManifest,
  probeManagementApiAccess,
  getExampleManifestPath,
} = require('../demo_api_server/services/pingoneBootstrapService');

async function main() {
  const args = process.argv.slice(2);
  const manifestArg = args.find((a) => a.startsWith('--manifest='));
  const manifestPath = manifestArg
    ? path.resolve(manifestArg.slice('--manifest='.length))
    : getExampleManifestPath();

  if (!fs.existsSync(manifestPath)) {
    console.error('Manifest not found:', manifestPath);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const steps = planStepsFromManifest(manifest);

  console.log(`Manifest: ${manifestPath}\n`);
  steps.forEach((s, i) => {
    console.log(`${String(i + 1).padStart(2, ' ')}. ${s}`);
  });

  if (args.includes('--probe')) {
    await configStore.ensureInitialized();
    const result = await probeManagementApiAccess();
    console.log('\nManagement API probe:', JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
