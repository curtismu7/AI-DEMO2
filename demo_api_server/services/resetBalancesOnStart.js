'use strict';

/**
 * Reset every banking demo user's accounts to the default balances when the server starts.
 *
 * Why: dataStore persists accounts and the saved account snapshot survives a restart, so money
 * spent in one demo (transfers, step-up amounts) is still gone at the start of the next, and the
 * demo runs out of money part-way through. The reset itself is the existing provisioning used by
 * POST /accounts/reset-demo (default balances, fresh sample history, snapshot rewritten).
 *
 * Skipped for a user whose live data belongs to another vertical (healthcare, retail, ...), because
 * the provisioning builds the banking set. DEMO_RESET_BALANCES_ON_START=0|false|off|no turns it off.
 * One user failing is logged and never stops the server or the other users.
 */

const OFF = new Set(['0', 'false', 'off', 'no']);

function isEnabled(env = process.env) {
  const v = env.DEMO_RESET_BALANCES_ON_START;
  return v === undefined || v === '' || !OFF.has(String(v).trim().toLowerCase());
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
      if (!(dataStore.getAccountsByUserId(user.id) || []).length) { skipped += 1; continue; }
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

module.exports = { resetBalancesOnStart, isEnabled };
