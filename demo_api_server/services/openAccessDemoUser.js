'use strict';
/**
 * openAccessDemoUser — resolves the demo user bound to sub-less worker tokens on
 * the open-access Privilege hop (MCP_AUTH_DISABLED).
 *
 * Why: banking DATA tools on that hop mint a client_credentials WORKER token
 * (PingOne has no ROPC grant), and its RFC 8693 Step 9 exchange yields a token
 * with no user subject (sub: undefined). The banking `/my` endpoints resolve
 * rows from req.user.id, so without a user the tools return empty. Binding those
 * requests to a real demo user lets get_my_transactions / get_balance return real
 * rows — the "fixed demo user (real data)" behavior chosen for this demo.
 *
 * Id source (in order):
 *   1. DEMO_SUBJECT_USER_ID env — explicit override.
 *   2. Auto-resolve: the seeded account owner with the most accounts+transactions
 *      (cached). Self-configuring across reseeds so the demo "just works".
 * Returns null if nothing resolves — the binding then no-ops and /my stays empty
 * (safe: no fabricated identity).
 */

let cachedId = null;
let resolved = false;

function resolveDemoUserId() {
  if (process.env.DEMO_SUBJECT_USER_ID) return process.env.DEMO_SUBJECT_USER_ID;
  if (resolved) return cachedId;
  resolved = true;
  try {
    const dataStore = require('../data/store');
    if (typeof dataStore.getAllAccounts !== 'function') {
      cachedId = null;
      return cachedId;
    }
    const acctCount = {};
    for (const a of dataStore.getAllAccounts() || []) {
      if (a && a.userId) acctCount[a.userId] = (acctCount[a.userId] || 0) + 1;
    }
    let best = null;
    let bestScore = -1;
    for (const [uid, acc] of Object.entries(acctCount)) {
      const tx = (dataStore.getTransactionsByUserId(uid) || []).length;
      const total = acc + tx;
      // Require at least one transaction so the bound user has visible history.
      if (tx > 0 && total > bestScore) {
        best = uid;
        bestScore = total;
      }
    }
    cachedId = best;
  } catch {
    cachedId = null;
  }
  return cachedId;
}

/**
 * Resolve the demo user as an object with display fields, so the binding can set
 * a real name/email on req.user (otherwise the banking page shows the raw UUID as
 * the account holder). Returns { id, username, email, firstName, lastName, name }
 * or null. Names are best-effort — id is the only required field.
 */
function resolveDemoUser() {
  const id = resolveDemoUserId();
  if (!id) return null;
  let u = null;
  try {
    const dataStore = require('../data/store');
    const users = typeof dataStore.getAllUsers === 'function' ? dataStore.getAllUsers() : [];
    u = users.find((x) => x && (x.id === id || x.oauthId === id)) || null;
  } catch {
    u = null;
  }
  const first = u?.firstName || u?.given_name || null;
  const last = u?.lastName || u?.family_name || null;
  return {
    id,
    username: u?.username || u?.email || id,
    email: u?.email || null,
    firstName: first,
    lastName: last,
    name: u?.name || [first, last].filter(Boolean).join(' ') || u?.email || null,
  };
}

// Test hook — clear the memoized resolution.
function _reset() {
  cachedId = null;
  resolved = false;
}

module.exports = { resolveDemoUserId, resolveDemoUser, _reset };
