'use strict';

/**
 * syncPrivilegeUsers.js — copy the demo sign-in accounts into Privilege's PingOne env.
 *
 * PingOne Privilege only knows the users of its own PingOne environment
 * (PRIVILEGE_CONSOLE_ENV_ID, else PRIVILEGE_SSO_ENV_ID) who are members of the
 * group PrivilegeAdmins. Demo users live in PINGONE_ENVIRONMENT_ID, so a demo
 * user missing from Privilege's env is refused by every Privilege door.
 *
 * Accounts: the three the bootstrap creates (DEMO_*_USERNAME) plus
 * PRIVILEGE_SYNC_ACCOUNTS (comma-separated usernames or emails). For each one
 * that exists in the demo env: create it in Privilege's env (same email,
 * username, name; default population, no password) if missing, then add it to
 * PrivilegeAdmins. Idempotent.
 *
 * The demo worker (PINGONE_WORKER_CLIENT_ID/_SECRET) needs Identity Data Admin
 * on Privilege's env; without it PingOne returns empty user lists there rather
 * than a 403. If the role is missing the script assigns it to the worker, which
 * only works when the worker already holds that role somewhere it may delegate
 * from (e.g. Environment/Organization Admin). Skips (exit 0) when Privilege's
 * env is not configured or is the demo env itself.
 *
 * Run standalone: node scripts/syncPrivilegeUsers.js [--dry-run]
 * Called automatically by bootstrapPingOne.js post-provisioning.
 */

const GROUP_NAME = 'PrivilegeAdmins';

const ROLE_NAME = 'Identity Data Admin';

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

  const workerHeaders = async () => {
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
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  };
  let H = await workerHeaders();
  const api = (e) => `https://api.pingone.${region}/v1/environments/${e}`;
  const get = async (url) => {
    const r = await fetchImpl(url, { headers: H });
    const j = await r.json();
    if (!r.ok) throw new Error(`GET ${url.replace(/\?.*/, '')} → ${r.status} ${j.code || ''}`);
    return j;
  };
  const users = async (e, filter) =>
    (await get(`${api(e)}/users?filter=${encodeURIComponent(filter)}`))._embedded?.users || [];

  // A worker's client id is its application id in PingOne.
  const role = ((await get(`https://api.pingone.${region}/v1/roles`))._embedded?.roles || []).find((r) => r.name === ROLE_NAME);
  const assignUrl = `${api(src)}/applications/${clientId}/roleAssignments`;
  const hasRole = ((await get(assignUrl))._embedded?.roleAssignments || []).some(
    (a) => a.role?.id === role?.id && a.scope?.type === 'ENVIRONMENT' && a.scope?.id === dst,
  );
  if (!hasRole) {
    const manual = `grant the worker app ${ROLE_NAME} on environment ${dst} (PingOne → env ${src} → Applications → worker → Roles), then re-run`;
    if (dryRun || !role) {
      log(`[syncPrivilegeUsers] Worker lacks ${ROLE_NAME} on Privilege env — ${dryRun ? 'would assign it' : manual}`);
      return { skipped: true };
    }
    const r = await fetchImpl(assignUrl, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ role: { id: role.id }, scope: { id: dst, type: 'ENVIRONMENT' } }),
    });
    if (!r.ok) {
      log(`[syncPrivilegeUsers] ⚠️  Could not assign ${ROLE_NAME} on Privilege env (HTTP ${r.status}) — ${manual}`);
      return { skipped: true };
    }
    log(`[syncPrivilegeUsers] ✅ Assigned ${ROLE_NAME} on Privilege env to the worker`);
    H = await workerHeaders(); // new role reaches a fresh token only
  }

  const groups = (await get(`${api(dst)}/groups?filter=${encodeURIComponent(`name eq "${GROUP_NAME}"`)}`))._embedded?.groups || [];
  if (!groups[0]) {
    log(`[syncPrivilegeUsers] No ${GROUP_NAME} group in Privilege env — skipping`);
    return { skipped: true };
  }
  const groupId = groups[0].id;
  const pops = (await get(`${api(dst)}/populations`))._embedded?.populations || [];
  const pop = pops.find((p) => p.default) || pops[0];

  const accounts = [...new Set([env.DEMO_USER_USERNAME, env.DEMO_ADMIN_USERNAME, env.DEMO_DELEGATE_USERNAME, ...(env.PRIVILEGE_SYNC_ACCOUNTS || '').split(',').map((a) => a.trim())].filter(Boolean))];
  const result = { created: [], added: [], ok: [], skipped: [] };

  for (const account of accounts) {
    const source = (await users(src, `username eq "${account}" or email eq "${account}"`))[0];
    if (!source) continue; // not a sign-in account on this tenant
    const label = `${source.username} <${source.email}>`;

    let target = (await users(dst, `email eq "${source.email}"`))[0];
    if (!target) {
      const holder = (await users(dst, `username eq "${source.username}"`))[0];
      // Same username with no email (hand-made) is the same account; use it.
      if (holder && !holder.email) target = holder;
      else if (holder) {
        // PingOne usernames are case-insensitive: another person already owns this one.
        log(`[syncPrivilegeUsers] ⚠️  ${label}: username taken in Privilege env by another user — not created, not added to ${GROUP_NAME}`);
        result.skipped.push(source.email);
        continue;
      }
    }
    if (!target) {
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
  require('./loadDemoEnv').loadDemoEnv();
  syncPrivilegeUsers({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error('[syncPrivilegeUsers] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { syncPrivilegeUsers };
