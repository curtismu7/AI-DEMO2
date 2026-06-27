/**
 * demoPersonaRoleHardening.js
 *
 * Startup hardening: ensure the demo personas (demoUser, demoAdmin, demoDelegate)
 * carry the demo admin role assignments (Environment Admin + Identity Data Admin) —
 * PingOne denies interactive Management-API logins for users with zero role
 * assignments.
 *
 * This replaces the former mayActHardening boot step. The per-user `mayAct`
 * attribute write was removed: the demo no longer provisions may_act, and the
 * boot self-heal silently re-authorized an agent the user had revoked via the
 * agent-authorization page. Role healing is kept because it is unrelated to
 * delegation and personas break without it.
 *
 * Fully non-blocking — never throws, never delays startup. Skips silently when
 * worker creds are not configured.
 *
 * Opt out with PERSONA_ROLE_HARDEN_ON_STARTUP=false (default: enabled).
 * The legacy MAYACT_HARDEN_ON_STARTUP name is honored as a fallback so
 * existing operator configs keep working.
 */
'use strict';

const configStore = require('./configStore');
const pingOneUserService = require('./pingOneUserService');

const TAG = '[persona-roles]';

/**
 * Ensure demoUser/demoAdmin/demoDelegate carry the demo admin role assignments.
 * @returns {Promise<{ status: string, updated?: string[], detail?: string }>} always resolves.
 */
async function ensureDemoPersonaRoles() {
  const enabled =
    configStore.getEffective('persona_role_harden_on_startup') ??
    process.env.PERSONA_ROLE_HARDEN_ON_STARTUP ??
    // Legacy name from the removed mayActHardening boot step.
    configStore.getEffective('mayact_harden_on_startup') ??
    process.env.MAYACT_HARDEN_ON_STARTUP ??
    'true';
  if (String(enabled).toLowerCase() === 'false') {
    return { status: 'skipped', detail: 'disabled (PERSONA_ROLE_HARDEN_ON_STARTUP=false)' };
  }

  const workerId =
    configStore.getEffective('pingone_worker_client_id') ||
    configStore.getEffective('pingone_mgmt_client_id') ||
    configStore.getEffective('pingone_management_client_id');
  if (!workerId) {
    return { status: 'skipped', detail: 'no management worker credentials' };
  }

  const usernames = [
    process.env.DEMO_USER_USERNAME || 'demoUser',
    process.env.DEMO_ADMIN_USERNAME || 'demoAdmin',
    process.env.DEMO_DELEGATE_USERNAME || 'demoDelegate',
  ];

  const updated = [];
  try {
    pingOneUserService.initialize();
    for (const username of usernames) {
      try {
        // Look up via pingOneUserService (worker app token = PINGONE_WORKER_CLIENT_ID,
        // client_credentials-enabled). NOT fetchPingOneUserByUsername, which uses
        // getManagementToken() / PINGONE_MGMT_CLIENT_ID — a client that may lack the
        // client_credentials grant (observed live: 400 "Unsupported grant type").
        const resp = await pingOneUserService.listUsers({ filter: `username eq "${username}"`, limit: 1 });
        const found = resp?._embedded?.users?.[0];
        if (!found?.id) {
          console.warn(`${TAG} ${username}: not found in PingOne — login will fail until the user is created.`);
          continue;
        }
        // Warn if the account is disabled or not in ACTIVE lifecycle state — role
        // assignments succeed but the user still cannot log in.
        if (found.enabled === false) {
          console.warn(`${TAG} ${username}: account is DISABLED in PingOne — login will fail. Enable the account at PingOne Admin → Users.`);
        }
        const lifecycle = found.lifecycle?.status;
        if (lifecycle && lifecycle !== 'ACTIVE') {
          console.warn(`${TAG} ${username}: lifecycle status is "${lifecycle}" (expected ACTIVE) — login may fail. Check PingOne Admin → Users → ${username}.`);
        }
        const roles = await pingOneUserService.ensureAdminRoleAssignments(found.id);
        updated.push(username);
        if (roles.assigned.length) {
          console.log(`${TAG} ${username}: admin roles assigned: ${roles.assigned.join(', ')}`);
        }
        if (roles.failed.length) {
          console.warn(`${TAG} ${username}: role assignment failures: ${roles.failed.map(f => f.role + ' (' + f.error + ')').join('; ')}`);
        }
      } catch (perUserErr) {
        console.warn(`${TAG} ${username}: could not ensure admin roles — ${perUserErr.message}`);
      }
    }
    console.log(`${TAG} ✅ Done — admin roles ensured for: ${updated.join(', ') || '(none)'}`);
    return { status: 'ok', updated };
  } catch (err) {
    console.warn(`${TAG} ⚠️  Skipped due to unexpected error: ${err.message}`);
    return { status: 'error', detail: err.message };
  }
}

module.exports = { ensureDemoPersonaRoles };
