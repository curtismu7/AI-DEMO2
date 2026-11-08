'use strict';

/**
 * syncPrivilegeUsers.js — copy the demo sign-in accounts into Privilege's PingOne env.
 *
 * PingOne Privilege only knows the users of its own PingOne environment
 * (PRIVILEGE_CONSOLE_ENV_ID, else PRIVILEGE_SSO_ENV_ID) who are members of the
 * group PrivilegeAdmins. Demo users live in PINGONE_ENVIRONMENT_ID, so a demo
 * user missing from Privilege's env is refused by every Privilege door.
 *
 * For each account below that exists in the demo env: create it in Privilege's
 * env (same email, username, name; default population, no password) if
 * missing, then add it to PrivilegeAdmins. Idempotent.
 *
 * Needs the demo worker (PINGONE_WORKER_CLIENT_ID/_SECRET) to hold Identity
 * Data Admin on Privilege's env. Skips (exit 0) when Privilege's env is not
 * configured or is the demo env itself.
 *
 * Run standalone: node scripts/syncPrivilegeUsers.js [--dry-run]
 * Called automatically by bootstrapPingOne.js post-provisioning.
 */

const path = require('node:path');

const GROUP_NAME = 'PrivilegeAdmins';

// Demo sign-in accounts besides the three the bootstrap creates (DEMO_*_USERNAME).
// Accounts not found in the demo env are skipped, so other tenants are unaffected.
const EXTRA_ACCOUNTS = [
  'cmuir+demouser@pingone.com',
  'cmuir+AgentAdmin@pingone.com',
  'cmuir+AgentEnduser@pingone.com',
  'cmuir+p1privilege@pingone.com',
  'cmuir+jordan@pingone.com',
  'cmuir.idjag@pingone.com',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncPrivilegeUsers({ env = process.env, fetchImpl = fetch, log = console.log, dryRun = false, retryDelayMs = 1000 } = {}) {
  const src = env.PINGONE_ENVIRONMENT_ID;
  const dst = env.PRIVILEGE_CONSOLE_ENV_ID || env.PRIVILEGE_SSO_ENV_ID;
  const clientId = env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = env.PINGONE_WORKER_CLIENT_SECRET;
  const region = env.PINGONE_REGION || 'com';

  if (!dst || dst === src) {
    log('[syncPrivilegeUsers] No separate Privilege env (PRIVILEGE_CONSOLE_ENV_ID / PRIVILEGE_SSO_ENV_ID) — skipping');
    return { skipped: true };
  }
  if (!src || !clientId || !clientSecret) {
    log('[syncPrivilegeUsers] Missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET — skipping');
    return { skipped: true };
  }

  const tokenRes = await fetchImpl(`https://auth.pingone.${region}/${src}/as/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  const token = (await tokenRes.json()).access_token;
  if (!token) throw new Error(`worker token refused (HTTP ${tokenRes.status})`);

  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const api = (e) => `https://api.pingone.${region}/v1/environments/${e}`;
  const get = async (url) => {
    const r = await fetchImpl(url, { headers: H });
    const j = await r.json();
    if (!r.ok) throw new Error(`GET ${url.replace(/\?.*/, '')} → ${r.status} ${j.code || ''}`);
    return j;
  };
  const users = async (e, filter) =>
    (await get(`${api(e)}/users?filter=${encodeURIComponent(filter)}`))._embedded?.users || [];

  const groups = (await get(`${api(dst)}/groups?filter=${encodeURIComponent(`name eq "${GROUP_NAME}"`)}`))._embedded?.groups || [];
  if (!groups[0]) {
    log(`[syncPrivilegeUsers] No ${GROUP_NAME} group in Privilege env — skipping`);
    return { skipped: true };
  }
  const groupId = groups[0].id;
  const pops = (await get(`${api(dst)}/populations`))._embedded?.populations || [];
  const pop = pops.find((p) => p.default) || pops[0];

  const accounts = [...new Set([env.DEMO_USER_USERNAME, env.DEMO_ADMIN_USERNAME, env.DEMO_DELEGATE_USERNAME, ...EXTRA_ACCOUNTS].filter(Boolean))];
  const result = { created: [], added: [], ok: [], skipped: [] };

  for (const account of accounts) {
    const source = (await users(src, `username eq "${account}" or email eq "${account}"`))[0];
    if (!source) continue; // not a sign-in account on this tenant
    const label = `${source.username} <${source.email}>`;

    let target = (await users(dst, `email eq "${source.email}"`))[0];
    if (!target) {
      const holder = (await users(dst, `username eq "${source.username}"`))[0];
      if (holder) {
        // PingOne usernames are case-insensitive: another person already owns this one.
        log(`[syncPrivilegeUsers] ⚠️  ${label}: username taken in Privilege env by ${holder.email} — skipped`);
        result.skipped.push(source.email);
        continue;
      }
      if (dryRun) {
        log(`[syncPrivilegeUsers] would create ${label} and add to ${GROUP_NAME}`);
        continue;
      }
      const r = await fetchImpl(`${api(dst)}/users`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ email: source.email, username: source.username, name: source.name, population: pop && { id: pop.id } }),
      });
      target = await r.json();
      if (!r.ok || !target.id) {
        log(`[syncPrivilegeUsers] ❌ ${label}: create failed ${r.status} ${target.code || ''}`);
        result.skipped.push(source.email);
        continue;
      }
      result.created.push(source.email);
    }

    const member = await get(`${api(dst)}/users/${target.id}/memberOfGroups?limit=200`);
    if ((member._embedded?.groupMemberships || []).some((g) => g.id === groupId)) {
      result.ok.push(source.email);
      continue;
    }
    if (dryRun) {
      log(`[syncPrivilegeUsers] would add ${label} to ${GROUP_NAME}`);
      continue;
    }
    // A user created a moment ago can 404 here until PingOne catches up.
    let status = 0;
    for (let i = 0; i < 3; i++) {
      status = (await fetchImpl(`${api(dst)}/users/${target.id}/memberOfGroups`, { method: 'POST', headers: H, body: JSON.stringify({ id: groupId }) })).status;
      if (status !== 404) break;
      await sleep(retryDelayMs);
    }
    if (status >= 200 && status < 300) result.added.push(source.email);
    else {
      log(`[syncPrivilegeUsers] ❌ ${label}: add to ${GROUP_NAME} failed ${status}`);
      result.skipped.push(source.email);
    }
  }

  log(`[syncPrivilegeUsers] ✅ Privilege env: ${result.created.length} created, ${result.added.length} added to ${GROUP_NAME}, ${result.ok.length} already in sync, ${result.skipped.length} skipped`);
  return result;
}

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
  syncPrivilegeUsers({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error('[syncPrivilegeUsers] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { syncPrivilegeUsers, EXTRA_ACCOUNTS };
