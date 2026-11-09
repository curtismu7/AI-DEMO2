#!/usr/bin/env node
'use strict';

/**
 * set-airline-member-tier.js - owner-run: set the airline member tier on ONE PingOne user.
 *
 * PingOne Authorize reads the tier for Rule B ("only premium members can book over $750") from the
 * PingOne user's custom attribute `airlineMemberTier` (user schema, STRING). This script:
 *   1. makes sure that user-schema attribute exists (creates it only when missing), and
 *   2. PATCHes one user, found by username, to the tier you give.
 *
 *   node scripts/set-airline-member-tier.js <username> <tier>            dry run (default): reads only, writes nothing
 *   node scripts/set-airline-member-tier.js <username> <tier> --apply    writes
 *
 * Examples (the premium set is premiumTiers in demo_mcp_resource_server/seed/airline-booking-policy-data.json):
 *   node scripts/set-airline-member-tier.js demouser "Premier Silver"          # standard: Rule B fires over $750
 *   node scripts/set-airline-member-tier.js demouser "Premier Gold" --apply    # premium: Rule B passes
 *
 * Credentials: the worker app in demo_api_server/.env (PINGONE_ENVIRONMENT_ID, PINGONE_REGION,
 * PINGONE_WORKER_CLIENT_ID, PINGONE_WORKER_CLIENT_SECRET), loaded and decrypted by the repo's
 * loadDemoEnv. The worker needs a role that can edit the user schema and users (for example
 * Identity Data Admin). Nothing is hard-coded; no token, secret or id of your tenant is printed
 * beyond the user's PingOne id and the schema id of the user schema.
 *
 * Exit codes: 0 ok (dry run or applied), 1 failure or bad usage.
 */

const ATTRIBUTE_NAME = 'airlineMemberTier';
const HOSTS = {
  NA: { auth: 'auth.pingone.com', api: 'api.pingone.com' },
  COM: { auth: 'auth.pingone.com', api: 'api.pingone.com' },
  EU: { auth: 'auth.pingone.eu', api: 'api.pingone.eu' },
  AP: { auth: 'auth.pingone.asia', api: 'api.pingone.asia' },
  ASIA: { auth: 'auth.pingone.asia', api: 'api.pingone.asia' },
  CA: { auth: 'auth.pingone.ca', api: 'api.pingone.ca' },
};

class UsageError extends Error {}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--apply');
  if (unknown.length) throw new UsageError(`unknown option ${unknown[0]} (only --apply is accepted)`);
  if (positional.length !== 2) throw new UsageError('usage: node scripts/set-airline-member-tier.js <username> <tier> [--apply]');
  const [username, tier] = positional.map((s) => s.trim());
  if (!username) throw new UsageError('username must not be empty');
  if (!tier) throw new UsageError('tier must not be empty (an empty tier would just make the user non-premium; pass a real tier name)');
  if (tier.length > 100) throw new UsageError('tier is longer than 100 characters');
  return { apply, username, tier };
}

/** Escape a value for a PingOne SCIM filter string literal. */
const filterLiteral = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function run({ argv, env, fetchImpl = fetch, log = console.log }) {
  const { apply, username, tier } = parseArgs(argv);

  const envId = env.PINGONE_ENVIRONMENT_ID;
  const clientId = env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = env.PINGONE_WORKER_CLIENT_SECRET;
  const hosts = HOSTS[String(env.PINGONE_REGION || 'NA').toUpperCase()];
  if (!envId || !clientId || !clientSecret) {
    throw new Error('missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET (demo_api_server/.env)');
  }
  if (!hosts) throw new Error(`unknown PINGONE_REGION "${env.PINGONE_REGION}"`);
  const base = `https://${hosts.api}/v1/environments/${envId}`;

  // Never include a response body that could echo a credential; report the HTTP status and PingOne's own code/message.
  const fail = async (what, res) => {
    const body = await res.json().catch(() => ({}));
    const detail = [body.code, body.message].filter(Boolean).join(': ').slice(0, 200);
    throw new Error(`${what} failed (HTTP ${res.status})${detail ? ` - ${detail}` : ''}`);
  };

  log(`mode: ${apply ? 'APPLY (will write)' : 'DRY RUN (reads only; pass --apply to write)'}`);

  const tokenRes = await fetchImpl(`https://${hosts.auth}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) await fail('worker token request', tokenRes);
  const token = (await tokenRes.json().catch(() => ({}))).access_token;
  if (!token) throw new Error('worker token request returned no access_token');
  const auth = { Authorization: `Bearer ${token}` };
  const json = { ...auth, 'Content-Type': 'application/json' };

  // 1. The user schema and its attribute.
  const schemasRes = await fetchImpl(`${base}/schemas`, { headers: auth });
  if (!schemasRes.ok) await fail('listing schemas', schemasRes);
  const schemas = (await schemasRes.json())._embedded?.schemas || [];
  const userSchema = schemas.find((s) => s.name === 'User') || schemas[0];
  if (!userSchema) throw new Error('no user schema found in the environment');

  const attrsRes = await fetchImpl(`${base}/schemas/${userSchema.id}/attributes`, { headers: auth });
  if (!attrsRes.ok) await fail('listing user schema attributes', attrsRes);
  const attrs = (await attrsRes.json())._embedded?.attributes || [];
  const existing = attrs.find((a) => a.name === ATTRIBUTE_NAME);
  if (existing && existing.type && existing.type !== 'STRING') {
    throw new Error(`user schema attribute ${ATTRIBUTE_NAME} exists but is ${existing.type}, not STRING - refusing to touch it`);
  }
  if (existing) {
    log(`user schema attribute ${ATTRIBUTE_NAME}: exists (STRING)`);
  } else if (!apply) {
    log(`user schema attribute ${ATTRIBUTE_NAME}: MISSING - would create it (STRING, optional)`);
  } else {
    const createRes = await fetchImpl(`${base}/schemas/${userSchema.id}/attributes`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: ATTRIBUTE_NAME,
        displayName: 'Airline member tier',
        description: 'Airline loyalty tier. PingOne Authorize reads it for the premium-only booking rule.',
        enabled: true, type: 'STRING', unique: false, required: false,
      }),
    });
    if (!createRes.ok) await fail(`creating user schema attribute ${ATTRIBUTE_NAME}`, createRes);
    log(`user schema attribute ${ATTRIBUTE_NAME}: created (STRING, optional)`);
  }

  // 2. The user.
  const usersRes = await fetchImpl(`${base}/users?filter=${encodeURIComponent(`username eq ${filterLiteral(username)}`)}`, { headers: auth });
  if (!usersRes.ok) await fail('looking up the user', usersRes);
  const users = (await usersRes.json())._embedded?.users || [];
  if (users.length === 0) throw new Error(`no PingOne user with username "${username}"`);
  if (users.length > 1) throw new Error(`${users.length} users match username "${username}" - refusing to guess`);
  const user = users[0];
  const current = user[ATTRIBUTE_NAME];
  log(`user "${username}" (id ${user.id}): ${ATTRIBUTE_NAME} is ${current === undefined ? '(not set)' : JSON.stringify(current)}`);

  if (current === tier) {
    log(`already "${tier}" - nothing to write`);
    return { changed: false };
  }
  if (!apply) {
    log(`would set ${ATTRIBUTE_NAME} = ${JSON.stringify(tier)} on that user. Re-run with --apply to write.`);
    return { changed: false, dryRun: true };
  }
  const patchRes = await fetchImpl(`${base}/users/${user.id}`, {
    method: 'PATCH', headers: json, body: JSON.stringify({ [ATTRIBUTE_NAME]: tier }),
  });
  if (!patchRes.ok) await fail('updating the user', patchRes);
  log(`set ${ATTRIBUTE_NAME} = ${JSON.stringify(tier)} on user "${username}"`);
  return { changed: true };
}

if (require.main === module) {
  // Loaded only when run as a script, so the unit test needs neither dotenv nor a .env.
  require('../demo_api_server/scripts/loadDemoEnv').loadDemoEnv();
  run({ argv: process.argv.slice(2), env: process.env }).then(
    () => process.exit(0),
    (err) => {
      console.error(`set-airline-member-tier: ${err.message}`);
      process.exit(1);
    },
  );
}

module.exports = { run, parseArgs, filterLiteral, ATTRIBUTE_NAME, UsageError };
