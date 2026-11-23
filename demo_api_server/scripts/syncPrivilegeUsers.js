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
 * than a 403. If the role is missing the script tries to assign it to the
 * worker (works only when the worker may delegate it, e.g. holds Organization
 * Admin); if it can't, it warns and syncs anyway. Skips (exit 0) when
 * Privilege's env is not configured or is the demo env itself, unless the
 * demo env is the Privilege env (one-environment setup): when no separate
 * env is set (or it equals the demo env) and the demo env has a
 * "PingOne Privilege" app, the group PrivilegeAdmins is ensured there and the
 * demo accounts are added to it, with nothing to copy.
 *
 * Run standalone: node scripts/syncPrivilegeUsers.js [--dry-run]
 * Called automatically by bootstrapPingOne.js post-provisioning.
 */

const GROUP_NAME = 'PrivilegeAdmins';

const ROLE_NAME = 'Identity Data Admin';

const PRIVILEGE_APP_NAME = 'PingOne Privilege';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncPrivilegeUsers({ env = process.env, fetchImpl = fetch, log = console.log, dryRun = false, retryDelayMs = 1000 } = {}) {
  const src = env.PINGONE_ENVIRONMENT_ID;
  let dst = env.PRIVILEGE_CONSOLE_ENV_ID || env.PRIVILEGE_SSO_ENV_ID;
  const oneEnv = !dst || dst === src;
  const clientId = env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = env.PINGONE_WORKER_CLIENT_SECRET;
  const region = env.PINGONE_REGION || 'com';

  const noSeparateEnv = () => {
    log('[syncPrivilegeUsers] No separate Privilege env (PRIVILEGE_CONSOLE_ENV_ID / PRIVILEGE_SSO_ENV_ID) — skipping');
    return { skipped: true };
  };
  if (oneEnv && (!src || !clientId || !clientSecret)) return noSeparateEnv();
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
  let H;
  try {
    H = await workerHeaders();
  } catch (err) {
    if (!oneEnv) throw err;
    // Most demo installs have no Privilege at all: a failed token must not turn into a bootstrap warning.
    log(`[syncPrivilegeUsers] ⚠️  Could not get a worker token (${err.message}) — skipping`);
    return noSeparateEnv();
  }
  const api = (e) => `https://api.pingone.${region}/v1/environments/${e}`;
  const get = async (url) => {
    const r = await fetchImpl(url, { headers: H });
    const j = await r.json();
    if (!r.ok) throw new Error(`GET ${url.replace(/\?.*/, '')} → ${r.status} ${j.code || ''}`);
    return j;
  };
  const users = async (e, filter) =>
    (await get(`${api(e)}/users?filter=${encodeURIComponent(filter)}`))._embedded?.users || [];

  if (oneEnv) {
    // One-environment setup: Privilege was added to the demo env itself. Without its app there is nothing to sync.
    let found = false;
    try {
      let url = `${api(src)}/applications?limit=200`;
      for (let page = 0; url && !found && page < 20; page++) {
        const j = await get(url);
        found = (j._embedded?.applications || []).some((a) => a.name === PRIVILEGE_APP_NAME);
        url = j._links?.next?.href;
      }
    } catch (err) {
      log(`[syncPrivilegeUsers] ⚠️  Could not list the demo env's applications (${err.message}) — skipping`);
    }
    if (!found) return noSeparateEnv();
    dst = src;
    log(`[syncPrivilegeUsers] One-environment setup: ${PRIVILEGE_APP_NAME} is in the demo env — adding the demo accounts to ${GROUP_NAME} there`);
  }

  // Best effort: make sure the worker holds the role, but never let this
  // check stop a sync that would work anyway. A worker's client id is its
  // application id in PingOne.
  const manual = `grant the worker app ${ROLE_NAME} on environment ${dst} (PingOne → env ${src} → Applications → worker → Roles)`;
  try {
    const role = ((await get(`https://api.pingone.${region}/v1/roles`))._embedded?.roles || []).find((r) => r.name === ROLE_NAME);
    const assignUrl = `${api(src)}/applications/${clientId}/roleAssignments`;
    const hasRole = ((await get(assignUrl))._embedded?.roleAssignments || []).some(
      (a) => a.role?.id === role?.id && (a.scope?.type === 'ORGANIZATION' || (a.scope?.type === 'ENVIRONMENT' && a.scope?.id === dst)),
    );
    if (!hasRole && !role) {
      log(`[syncPrivilegeUsers] ⚠️  Role ${ROLE_NAME} not found; if users are missed, ${manual}`);
    } else if (!hasRole && dryRun) {
      log(`[syncPrivilegeUsers] would assign the worker ${ROLE_NAME} on Privilege env`);
    } else if (!hasRole) {
      const r = await fetchImpl(assignUrl, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ role: { id: role.id }, scope: { id: dst, type: 'ENVIRONMENT' } }),
      });
      if (r.ok) {
        log(`[syncPrivilegeUsers] ✅ Assigned ${ROLE_NAME} on Privilege env to the worker`);
        await sleep(retryDelayMs * 2); // let the assignment settle
        H = await workerHeaders(); // a new role reaches a fresh token only
      } else {
        log(`[syncPrivilegeUsers] ⚠️  Could not assign ${ROLE_NAME} on Privilege env (HTTP ${r.status}); if users are missed, ${manual}`);
      }
    }
  } catch (err) {
    log(`[syncPrivilegeUsers] ⚠️  Could not check the worker's roles (${err.message}); continuing`);
  }

  const groups = (await get(`${api(dst)}/groups?filter=${encodeURIComponent(`name eq "${GROUP_NAME}"`)}`))._embedded?.groups || [];
  let groupId = groups[0]?.id;
  if (!groupId) {
    if (!oneEnv) {
      log(`[syncPrivilegeUsers] No ${GROUP_NAME} group in Privilege env — skipping`);
      return { skipped: true };
    }
    if (dryRun) log(`[syncPrivilegeUsers] would create group ${GROUP_NAME}`);
    else {
      const r = await fetchImpl(`${api(dst)}/groups`, { method: 'POST', headers: H, body: JSON.stringify({ name: GROUP_NAME, description: 'Admins allowed into PingOne Privilege' }) });
      const g = await r.json().catch(() => ({}));
      groupId = r.ok ? g.id : undefined;
      if (!groupId) {
        // A parallel run may have created it a moment ago: look again before giving up.
        groupId = ((await get(`${api(dst)}/groups?filter=${encodeURIComponent(`name eq "${GROUP_NAME}"`)}`))._embedded?.groups || [])[0]?.id;
        if (!groupId) throw new Error(`could not create group ${GROUP_NAME} (HTTP ${r.status} ${g.code || ''})`);
      } else log(`[syncPrivilegeUsers] ✅ Created group ${GROUP_NAME}`);
    }
  }
  const pops = (await get(`${api(dst)}/populations`))._embedded?.populations || [];
  const pop = pops.find((p) => p.default) || pops[0];

  const accounts = [...new Set([env.DEMO_USER_USERNAME, env.DEMO_ADMIN_USERNAME, env.DEMO_DELEGATE_USERNAME, ...(env.PRIVILEGE_SYNC_ACCOUNTS || '').split(',').map((a) => a.trim())].filter(Boolean))];
  const result = { created: [], added: [], ok: [], skipped: [] };

  for (const account of accounts) {
    const source = (await users(src, `username eq "${account}" or email eq "${account}"`))[0];
    if (!source) continue; // not a sign-in account on this tenant
    const label = `${source.username} <${source.email}>`;

    // One environment: the demo account IS the Privilege account (a duplicate email must not pick someone else).
    let target = oneEnv ? source : (await users(dst, `email eq "${source.email}"`))[0];
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
