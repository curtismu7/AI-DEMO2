'use strict';

/**
 * Reset every banking demo user's accounts to the default balances when the server starts.
 *
 * Why: dataStore persists accounts and the saved account snapshot survives a restart, so money
 * spent in one demo (transfers, step-up amounts) is still gone at the start of the next, and the
 * demo runs out of money part-way through. The reset itself is the existing provisioning used by
 * POST /accounts/reset-demo (default balances, fresh sample history, snapshot rewritten).
 *
 * The vertical of a user's live data is read from the account types (banking, healthcare, retail, workforce,
 * sporting-goods each seed their own). A banking user goes through the banking provisioning; a user on another
 * vertical is reseeded for that same vertical (the same wipe-and-seed the vertical switch uses), so they stay on it. Those
 * verticals seed a balance in a range, so "default" there means a fresh seed, not one fixed number. A user is skipped
 * when their account types mix verticals or are unknown, or when a saved vertical that has its own seed disagrees with the
 * types. A saved label without a seed (university, airlines, ...) is a skin over the banking seed and does not block the
 * reset (a failed vertical lookup reads as "unknown", so the types are the check that matters).
 * One user failing is logged and never stops the server or the other users.
 *
 * Switch: DEMO_RESET_BALANCES_ON_START=1|true|on|yes forces it on, 0|false|off|no forces it off. Unset: on for a
 * local or standalone run, OFF inside a Kubernetes pod (KUBERNETES_SERVICE_HOST set), so a rollout or a crash-restart
 * on a shared hosted deployment never wipes a colleague's mid-demo accounts. A hosted deployment opts in explicitly.
 *
 * It runs after the server is listening (a request in the first moments can still see old balances); provisioning is
 * single-flight per user, so an overlapping /accounts/my joins it rather than duplicating accounts.
 */

const OFF = new Set(['0', 'false', 'off', 'no']);
const ON = new Set(['1', 'true', 'on', 'yes']);
const BANKING_TYPES = new Set(['checking', 'savings', 'loan', 'credit_card', 'investment', 'money_market']);
// Account types each non-banking vertical seeds (data/seeds/*.js), lower-cased.
const VERTICAL_TYPES = {
  healthcare: ['primary care', 'hsa'],
  retail: ['rewards points', 'store credit'],
  workforce: ['pto balance', 'sick leave'],
  'sporting-goods': ['pro member', 'elite member'],
};
const SEEDED = new Set(['banking', ...Object.keys(VERTICAL_TYPES)]);
const VERTICAL_BY_TYPE = new Map(Object.entries(VERTICAL_TYPES).flatMap(([v, types]) => types.map((t) => [t, v])));

/** The one vertical a user's accounts belong to, or null when empty, mixed or unknown. */
function verticalOf(accounts) {
  const found = new Set(accounts.map((a) => {
    const t = String(a.accountType || '').trim().toLowerCase();
    return BANKING_TYPES.has(t) ? 'banking' : (VERTICAL_BY_TYPE.get(t) || null);
  }));
  return found.size === 1 && !found.has(null) ? [...found][0] : null;
}

function isEnabled(env = process.env) {
  const v = String(env.DEMO_RESET_BALANCES_ON_START ?? '').trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (ON.has(v)) return true;
  return !env.KUBERNETES_SERVICE_HOST;
}

/**
 * @param {{ dataStore: object, provision: (userId: string) => Promise<unknown>,
 *           reseed: (userId: string, vertical: string) => Promise<unknown>,
 *           getVertical: (userId: string) => Promise<string|null>, env?: object, log?: object }} deps
 * @returns {Promise<{ enabled: boolean, reset: number, skipped: number, failed: number }>}
 */
async function resetBalancesOnStart({ dataStore, provision, reseed, getVertical, env = process.env, log = console }) {
  if (!isEnabled(env)) {
    log.log('[reset-balances] off (DEMO_RESET_BALANCES_ON_START)');
    return { enabled: false, reset: 0, skipped: 0, failed: 0 };
  }
  let reset = 0, skipped = 0, failed = 0;
  for (const user of dataStore.getAllUsers() || []) {
    try {
      const accounts = dataStore.getAccountsByUserId(user.id) || [];
      const live = verticalOf(accounts);
      if (!live) { skipped += 1; continue; }
      const saved = await getVertical(user.id);
      // Only a saved vertical that has its own seed can disagree with the live data. Other labels (university, airlines,
      // ...) are skins over the banking seed, so the account types decide and those users are reset too.
      if (saved && SEEDED.has(saved) && saved !== live) { skipped += 1; continue; }
      if (live === 'banking') await provision(user.id);
      else await reseed(user.id, live);
      reset += 1;
    } catch (e) {
      failed += 1;
      log.warn(`[reset-balances] user ${user.id} failed: ${e.message}`);
    }
  }
  log.log(`[reset-balances] reset ${reset}, skipped ${skipped}, failed ${failed}`);
  return { enabled: true, reset, skipped, failed };
}

/**
 * The reseed callback server.js wires in: wipe-and-seed the user for their own vertical (this also clears their old
 * transactions and seeds the vertical's sample ones), then rewrite the cold-start snapshot so a later restore cannot
 * bring the spent balances back (the same thing /accounts/reset-demo does for banking). demoScenarioStore.save merges.
 */
function makeReseed({ dataStore, demoScenarioStore }) {
  return async (userId, vertical) => {
    await dataStore.reseedUserForVertical(userId, vertical);
    await demoScenarioStore.save(userId, {
      accountSnapshot: dataStore.getAccountsByUserId(userId).map((a) => ({
        id: a.id, accountType: a.accountType, accountNumber: a.accountNumber, name: a.name || '',
        balance: a.balance, currency: a.currency || 'USD', isActive: a.isActive !== false,
      })),
    });
  };
}

module.exports = { resetBalancesOnStart, isEnabled, verticalOf, makeReseed, BANKING_TYPES, VERTICAL_TYPES };
