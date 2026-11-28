'use strict';

/**
 * Reset every banking demo user's accounts to the default balances when the server starts.
 *
 * Why: dataStore persists accounts and the saved account snapshot survives a restart, so money
 * spent in one demo (transfers, step-up amounts) is still gone at the start of the next, and the
 * demo runs out of money part-way through. The reset itself is the existing provisioning used by
 * POST /accounts/reset-demo (default balances, fresh sample history, snapshot rewritten).
 *
 * A user is reset only when the live data is banking: the saved vertical is banking or unknown AND every
 * account has a banking type. (A vertical lookup that fails also reads as "unknown", so the account types
 * are the second check; healthcare/retail accounts are never replaced by the banking set.)
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

function isEnabled(env = process.env) {
  const v = String(env.DEMO_RESET_BALANCES_ON_START ?? '').trim().toLowerCase();
  if (OFF.has(v)) return false;
  if (ON.has(v)) return true;
  return !env.KUBERNETES_SERVICE_HOST;
}

/**
 * @param {{ dataStore: object, provision: (userId: string) => Promise<unknown>,
 *           getVertical: (userId: string) => Promise<string|null>, env?: object, log?: object }} deps
 * @returns {Promise<{ enabled: boolean, reset: number, skipped: number, failed: number }>}
 */
async function resetBalancesOnStart({ dataStore, provision, getVertical, env = process.env, log = console }) {
  if (!isEnabled(env)) {
    log.log('[reset-balances] off (DEMO_RESET_BALANCES_ON_START)');
    return { enabled: false, reset: 0, skipped: 0, failed: 0 };
  }
  let reset = 0, skipped = 0, failed = 0;
  for (const user of dataStore.getAllUsers() || []) {
    try {
      const accounts = dataStore.getAccountsByUserId(user.id) || [];
      if (!accounts.length || !accounts.every((a) => BANKING_TYPES.has(a.accountType))) { skipped += 1; continue; }
      const vertical = await getVertical(user.id);
      if (vertical && vertical !== 'banking') { skipped += 1; continue; }
      await provision(user.id);
      reset += 1;
    } catch (e) {
      failed += 1;
      log.warn(`[reset-balances] user ${user.id} failed: ${e.message}`);
    }
  }
  log.log(`[reset-balances] reset ${reset}, skipped ${skipped}, failed ${failed}`);
  return { enabled: true, reset, skipped, failed };
}

module.exports = { resetBalancesOnStart, isEnabled, BANKING_TYPES };
