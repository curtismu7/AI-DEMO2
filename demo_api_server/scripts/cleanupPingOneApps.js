'use strict';

/**
 * cleanupPingOneApps.js
 *
 * Deletes all 'Demo *' apps and resource servers from a PingOne
 * environment so that bootstrapPingOne.js can re-create them from scratch.
 *
 * Usage:
 *   node scripts/cleanupPingOneApps.js            # dry-run (prints what would be deleted)
 *   node scripts/cleanupPingOneApps.js --execute  # actually deletes
 *
 * Requires in banking_api_server/.env:
 *   PINGONE_ENVIRONMENT_ID
 *   PINGONE_REGION          (e.g. com, eu, ca, ap)
 *   PINGONE_WORKER_CLIENT_ID
 *   PINGONE_WORKER_CLIENT_SECRET
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const https = require('https');

const DRY_RUN = !process.argv.includes('--execute');

const {
  PINGONE_ENVIRONMENT_ID,
  PINGONE_REGION = 'com',
  PINGONE_WORKER_CLIENT_ID,
  PINGONE_WORKER_CLIENT_SECRET,
} = process.env;

if (!PINGONE_ENVIRONMENT_ID || !PINGONE_WORKER_CLIENT_ID || !PINGONE_WORKER_CLIENT_SECRET) {
  console.error('ERROR: PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, and PINGONE_WORKER_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const API_BASE = `https://api.pingone.${PINGONE_REGION}/v1`;
const ENV_PATH = `/environments/${PINGONE_ENVIRONMENT_ID}`;

// Current provisioned names (Demo *) + legacy names (Super Banking *) for one-time migration
const DEMO_APP_NAMES = [
  'Demo Admin App',
  'Demo User App',
  'Demo MCP Server',
  'Demo Worker',
  'Demo MCP Exchanger',
  'Demo MCP Gateway',
  'Demo Agent',
  'Demo AI Agent',
  // Legacy names — present in PingOne envs provisioned before the rename
  'Super Banking Admin App',
  'Super Banking User App',
  'Super Banking MCP Server',
  'Super Banking Worker',
  'Super Banking MCP Exchanger',
  'Super Banking MCP Gateway',
  'Super Banking Agent',
  'Super Banking AI Agent',
  // NOTE: 'Super Banking Worker Token' is intentionally excluded — it is the
  // manually-created management worker app (Identity Data Admin role) that
  // bootstrap uses to authenticate. Deleting it breaks all provisioning.
  // Recreate manually in PingOne console if needed.
];

const DEMO_RESOURCE_NAMES = [
  'Demo API',
  'Demo MCP Server',
  'Demo MCP Gateway',
  'Demo Agent Gateway',
  // Legacy names
  'Super Banking API',
  'Super Banking MCP Server',
  'Super Banking MCP Gateway',
  'Super Banking Agent Gateway',
];

function httpsRequest(method, url, token, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getWorkerToken() {
  return new Promise((resolve, reject) => {
    const creds = Buffer.from(`${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}`).toString('base64');
    const body = 'grant_type=client_credentials';
    const options = {
      hostname: `auth.pingone.${PINGONE_REGION}`,
      path: `/${PINGONE_ENVIRONMENT_ID}/as/token`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (!parsed.access_token) {
          reject(new Error(`Token error: ${data}`));
        } else {
          resolve(parsed.access_token);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function listApps(token) {
  const res = await httpsRequest('GET', `${API_BASE}${ENV_PATH}/applications?limit=100`, token);
  return (res.body?._embedded?.applications || []);
}

async function listResources(token) {
  const res = await httpsRequest('GET', `${API_BASE}${ENV_PATH}/resources?limit=100`, token);
  return (res.body?._embedded?.resources || []);
}

async function deleteApp(token, app) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete app: "${app.name}" (${app.id})`);
    return;
  }
  console.log(`  Deleting app: "${app.name}" (${app.id})`);
  const res = await httpsRequest('DELETE', `${API_BASE}${ENV_PATH}/applications/${app.id}`, token);
  if (res.status === 204) {
    console.log('  Deleted');
  } else {
    console.error(`  Failed (${res.status}):`, res.body);
  }
}

async function deleteResource(token, resource) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete resource: "${resource.name}" (${resource.id})`);
    return;
  }
  console.log(`  Deleting resource: "${resource.name}" (${resource.id})`);
  const res = await httpsRequest('DELETE', `${API_BASE}${ENV_PATH}/resources/${resource.id}`, token);
  if (res.status === 204) {
    console.log('  Deleted');
  } else {
    console.error(`  Failed (${res.status}):`, res.body);
  }
}

async function main() {
  console.log(DRY_RUN
    ? '\n[DRY RUN] No changes will be made. Pass --execute to actually delete.\n'
    : '\n[EXECUTE] Deleting Demo apps and resource servers from PingOne...\n');

  const token = await getWorkerToken();

  // Delete apps first (they reference resource servers)
  console.log('--- Apps ---');
  const apps = await listApps(token);
  const targetApps = apps.filter((a) => DEMO_APP_NAMES.includes(a.name));
  if (targetApps.length === 0) {
    console.log('  No matching apps found.');
  }
  for (const app of targetApps) {
    await deleteApp(token, app);
  }

  // Delete resource servers
  console.log('\n--- Resource Servers ---');
  const resources = await listResources(token);
  const targetResources = resources.filter((r) => DEMO_RESOURCE_NAMES.includes(r.name));
  if (targetResources.length === 0) {
    console.log('  No matching resource servers found.');
  }
  for (const resource of targetResources) {
    await deleteResource(token, resource);
  }

  console.log(DRY_RUN
    ? '\n[DRY RUN complete] Re-run with --execute to apply.\n'
    : '\nCleanup complete. Run `npm run pingone:bootstrap` to re-provision with Demo names.\n');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
