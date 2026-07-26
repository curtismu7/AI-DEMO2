// demo_api_server/services/verticalAccountSnapshots.js
'use strict';

/**
 * Lossless vertical switching for a user's demo data.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `dataStore.reseedUserForVertical()` deletes every account AND every
 * transaction for a user, reseeds from the target vertical's profile, and
 * persists. That is how vertical switching works — you cannot show healthcare
 * with banking accounts — but it is also unconditional data loss: an SE who has
 * built up transfers, HITL approvals and step-ups mid-demo loses all of it the
 * moment anything touches accounts under a different vertical.
 *
 * It was irreversible too: `demoScenarioStore` kept a single `accountSnapshot`
 * slot per user, so switching overwrote the only copy.
 *
 * WHAT THIS DOES
 *
 * Before leaving a vertical, snapshot that vertical's accounts + transactions
 * under a per-vertical key. On arrival, restore the target vertical's snapshot
 * if one exists; only reseed when the user has genuinely never been there.
 * Switching back and forth is then lossless and repeatable.
 *
 * The legacy single-slot `accountSnapshot` is left untouched — cold-start
 * recovery (routes/accounts.js restoreAccountsFromSnapshot) still reads it.
 */

const dataStore = require('../data/store');
const demoScenarioStore = require('./demoScenarioStore');

/** demoScenarioStore field holding { [verticalId]: { accounts, transactions, savedAt } }. */
const SNAPSHOT_FIELD = 'verticalSnapshots';
/** demoScenarioStore field recording which vertical the live data belongs to. */
const CURRENT_FIELD = 'currentSeededVertical';

/**
 * Serialize a user's live accounts + transactions.
 * @param {string} userId
 * @returns {{ accounts: object[], transactions: object[] }}
 */
function captureLiveData(userId) {
  const accounts = (dataStore.getAccountsByUserId(userId) || []).map((a) => ({
    id: a.id,
    userId,
    accountType: a.accountType,
    accountNumber: a.accountNumber,
    name: a.name || '',
    balance: a.balance,
    currency: a.currency || 'USD',
    isActive: a.isActive !== false,
    createdAt: a.createdAt,
  }));
  const transactions = (dataStore.getTransactionsByUserId(userId) || []).map((t) => ({ ...t }));
  return { accounts, transactions };
}

/**
 * Which vertical the user's live data currently belongs to, if known.
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
async function getCurrentVertical(userId) {
  try {
    const scenario = await demoScenarioStore.load(userId);
    return scenario?.[CURRENT_FIELD] || null;
  } catch (_) {
    return null;
  }
}

/**
 * Save the user's live data under `vertical`. No-op when there is nothing to
 * save — an empty snapshot would otherwise mask a real one on the way back.
 * @param {string} userId
 * @param {string} vertical
 * @returns {Promise<boolean>} whether anything was stored
 */
async function snapshotVertical(userId, vertical) {
  if (!userId || !vertical) return false;
  const live = captureLiveData(userId);
  if (live.accounts.length === 0) return false;
  try {
    const scenario = await demoScenarioStore.load(userId);
    const all = { ...(scenario?.[SNAPSHOT_FIELD] || {}) };
    all[vertical] = { ...live, savedAt: new Date().toISOString() };
    await demoScenarioStore.save(userId, { [SNAPSHOT_FIELD]: all });
    return true;
  } catch (e) {
    console.warn(`[verticalSnapshots] snapshot ${vertical} failed:`, e.message);
    return false;
  }
}

/**
 * Restore a previously stored snapshot for `vertical`.
 *
 * Wipes the user's live rows first — restoring on top of another vertical's
 * data is what produced the mixed-vertical state this whole path exists to
 * avoid. Returns false (having changed nothing) when no snapshot exists, so the
 * caller can fall back to a reseed.
 *
 * @param {string} userId
 * @param {string} vertical
 * @returns {Promise<boolean>} whether a snapshot was restored
 */
async function restoreVertical(userId, vertical) {
  if (!userId || !vertical) return false;
  let snap;
  try {
    const scenario = await demoScenarioStore.load(userId);
    snap = scenario?.[SNAPSHOT_FIELD]?.[vertical];
  } catch (e) {
    console.warn(`[verticalSnapshots] load for ${vertical} failed:`, e.message);
    return false;
  }
  if (!snap || !Array.isArray(snap.accounts) || snap.accounts.length === 0) return false;

  try {
    dataStore.purgeUserFinancialData(userId);
    for (const a of snap.accounts) {
      await dataStore.createAccount({ ...a, userId, createdAt: a.createdAt || new Date() });
    }
    for (const t of Array.isArray(snap.transactions) ? snap.transactions : []) {
      await dataStore.createTransaction({ ...t, userId });
    }
    await demoScenarioStore.save(userId, { [CURRENT_FIELD]: vertical });
    return true;
  } catch (e) {
    console.warn(`[verticalSnapshots] restore ${vertical} failed:`, e.message);
    return false;
  }
}

/**
 * Move a user's demo data to `toVertical` without losing what they had.
 *
 * Snapshot out -> restore in -> reseed only if this vertical has never been
 * visited. Replaces a bare `reseedUserForVertical()` call at every site that
 * reacts to a vertical mismatch.
 *
 * @param {string} userId
 * @param {string} toVertical
 * @param {{ fromVertical?: string }} [opts] explicit outgoing vertical; inferred
 *   from the stored marker when omitted.
 * @returns {Promise<{ action: 'restored'|'seeded'|'noop', snapshotted: boolean, from: string|null }>}
 */
async function switchUserVertical(userId, toVertical, opts = {}) {
  if (!userId || !toVertical) return { action: 'noop', snapshotted: false, from: null };

  const from = opts.fromVertical || (await getCurrentVertical(userId));
  if (from === toVertical) return { action: 'noop', snapshotted: false, from };

  // Snapshot whatever is live now. `from` may be unknown on a cold session; in
  // that case the data is unattributable and deliberately not stored, rather
  // than filed under a vertical it may not belong to.
  const snapshotted = from ? await snapshotVertical(userId, from) : false;

  const restored = await restoreVertical(userId, toVertical);
  if (restored) return { action: 'restored', snapshotted, from };

  await dataStore.reseedUserForVertical(userId, toVertical);
  await demoScenarioStore.save(userId, { [CURRENT_FIELD]: toVertical });
  return { action: 'seeded', snapshotted, from };
}

module.exports = {
  SNAPSHOT_FIELD,
  CURRENT_FIELD,
  captureLiveData,
  getCurrentVertical,
  snapshotVertical,
  restoreVertical,
  switchUserVertical,
};
