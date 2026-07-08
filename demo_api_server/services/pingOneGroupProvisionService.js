'use strict';

/**
 * pingOneGroupProvisionService.js — create vertical PingOne groups via Management API.
 *
 * Uses worker credentials from .env / configStore. Does not require full bootstrap.
 * The hosted PingOne MCP server has no group tools — this is the supported path.
 */

const configStore = require('./configStore');
const groupPolicy = require('./groupPolicy');
const { PingOneProvisionService } = require('./pingoneProvisionService');

const DEMO_USERNAMES = ['demoUser', 'demoAdmin', 'demoDelegate'];

/** Resolve Management API worker credentials from env + configStore. */
function resolveWorkerConfig() {
  const envId = (
    process.env.PINGONE_ENVIRONMENT_ID
    || configStore.getEffective('pingone_environment_id')
    || ''
  ).trim();
  const region = (
    process.env.PINGONE_REGION
    || configStore.getEffective('PINGONE_REGION')
    || 'com'
  ).trim();
  const workerClientId = (
    process.env.PINGONE_WORKER_CLIENT_ID
    || process.env.PINGONE_WORKER_TOKEN_CLIENT_ID
    || configStore.getEffective('pingone_worker_token_client_id')
    || configStore.getEffective('pingone_worker_client_id')
    || ''
  ).trim();
  const workerClientSecret = (
    process.env.PINGONE_WORKER_CLIENT_SECRET
    || process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET
    || configStore.getEffective('pingone_worker_token_client_secret')
    || configStore.getEffective('pingone_worker_client_secret')
    || ''
  ).trim();

  if (!envId || !workerClientId || !workerClientSecret) {
    throw new Error(
      'Missing PingOne worker credentials. Set PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, '
      + 'and PINGONE_WORKER_CLIENT_SECRET in demo_api_server/.env (or configStore).',
    );
  }

  return { envId, region, workerClientId, workerClientSecret };
}

/**
 * Create groups + demo user memberships from vertical manifest `groups` blocks.
 * @param {{ verticalId?: string|null }} opts — omit to provision all verticals
 */
async function provisionVerticalGroups({ verticalId = null } = {}) {
  await configStore.ensureInitialized();

  const config = resolveWorkerConfig();
  const svc = new PingOneProvisionService();
  await svc.initialize(
    config.envId,
    config.workerClientId,
    config.workerClientSecret,
    config.region,
  );

  const demoUsersByUsername = {};
  const missingUsers = [];
  for (const username of DEMO_USERNAMES) {
    const user = await svc.findUserByUsername(username);
    if (user) {
      demoUsersByUsername[username] = user;
    } else {
      missingUsers.push(username);
    }
  }

  const steps = [];
  await svc.provisionVerticalGroupsFromManifest(demoUsersByUsername, steps, {
    verticalId,
  });

  const created = steps.filter((s) => s.icon === '✅' && String(s.step || '').includes('-group'));
  const warnings = steps.filter((s) => s.icon === '⚠️');

  return {
    ok: warnings.length === 0,
    verticalId: verticalId || 'all',
    steps,
    summary: {
      groupsEnsured: created.length,
      warnings: warnings.length,
      missingUsers,
    },
    transport: 'management-api',
    note: 'PingOne MCP server has no group tools; groups are created via Management API.',
  };
}

module.exports = {
  resolveWorkerConfig,
  provisionVerticalGroups,
  DEMO_USERNAMES,
};
