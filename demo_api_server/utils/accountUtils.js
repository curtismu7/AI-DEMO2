'use strict';

/**
 * Resolve a value that may be an account type name ('checking', 'savings') or a
 * prefixed/UUID ID to the actual account ID in the user's provisioned accounts.
 *
 * Resolution order:
 *   1. If the value looks like a real ID (chk-*, sav-*, UUID) AND exists in accounts → return it.
 *   2. If it looks like an ID but is NOT in accounts (stale/fake, e.g. 'chk-5') → fall back to
 *      type-based resolution by prefix so that tool calls still work.
 *   3. Otherwise treat the value as a type/name string and match by accountType or account name.
 *
 * Returns null if idOrType is falsy; returns the original value if no match is found (lets the
 * caller decide how to handle "account not found").
 */
function resolveAccountId(idOrType, accounts) {
  if (!idOrType) return null;
  const s = String(idOrType).trim();

  if (/^(chk-|sav-)/i.test(s) || /^[0-9a-f]{8}-/i.test(s)) {
    if (accounts.some(a => a.id === s)) return s;
    if (/^chk-/i.test(s)) {
      const byType = accounts.find(a => String(a.accountType || '').toLowerCase() === 'checking');
      if (byType) return byType.id;
    }
    if (/^sav-/i.test(s)) {
      const byType = accounts.find(a => String(a.accountType || '').toLowerCase() === 'savings');
      if (byType) return byType.id;
    }
    return s;
  }

  const lower = s.toLowerCase().replace(/^(my|the|primary|main)\s+/, '');
  const byType = accounts.find(a => String(a.accountType || '').toLowerCase() === lower);
  if (byType) return byType.id;
  const byName = accounts.find(a =>
    String(a.name || '').toLowerCase().includes(lower) ||
    String(a.accountType || '').toLowerCase().includes(lower)
  );
  return byName ? byName.id : s;
}

module.exports = { resolveAccountId };
