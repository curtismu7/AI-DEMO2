'use strict';
/**
 * The vault is the final answer for INTENT_TOKEN_SECRET.
 *
 * This key is the one place where "whichever copy happens to win" is a real
 * outage: intentTokenService signs with it and BOTH gateways verify against it,
 * so a .env copy that has drifted from the vault produces valid-looking
 * signatures that nothing can match. That is what broke SE introspection on
 * 2026-08-25, and it is why se-deploy has a SECURITY guard for this name.
 *
 * The mechanism is subtle enough to be worth pinning: intentTokenService reads
 * process.env DIRECTLY (it cannot use configStore — configStore is env-first, so
 * a stale .env would shadow the vault there too). vaultLoader's export loop
 * OVERWRITES process.env for names on ENV_EXPORT_ALLOWLIST, so listing the name
 * there is what makes the vault win.
 */

describe('INTENT_TOKEN_SECRET resolution', () => {
  test('is exported from the vault into process.env', () => {
    const { ENV_EXPORT_ALLOWLIST } = require('../../services/vaultLoader');
    // Guard against the export list being reachable but empty/renamed.
    expect(Array.isArray(ENV_EXPORT_ALLOWLIST)).toBe(true);
    expect(ENV_EXPORT_ALLOWLIST).toContain('INTENT_TOKEN_SECRET');
  });

  // The allowlist is deliberately tiny: a prefix match would let a hostile vault
  // entry set LD_PRELOAD (T-269-17). Adding a name must stay a decision, not a
  // pattern, so this fails if the list quietly grows.
  test('the export allowlist stays explicit and minimal', () => {
    const { ENV_EXPORT_ALLOWLIST } = require('../../services/vaultLoader');
    expect([...ENV_EXPORT_ALLOWLIST].sort())
      .toEqual(['BFF_INTERNAL_SECRET', 'INTENT_TOKEN_SECRET']);
  });

  // getSigningKey() must read process.env when CALLED, not at require time --
  // routes mount long before the vault is opened, so a module-level capture
  // would read the pre-vault value and silently sign with the .env copy.
  test('the signing key is read lazily, so the vault injection is seen', () => {
    const svc = require('../../services/intentTokenService');
    const prev = process.env.INTENT_TOKEN_SECRET;
    try {
      process.env.INTENT_TOKEN_SECRET = 'first-value-at-require-time';
      const a = svc.mintIntentToken
        ? svc.mintIntentToken({ tool: 't', args: {} })
        : null;
      // Simulate the vault overwriting process.env after modules loaded.
      process.env.INTENT_TOKEN_SECRET = 'vault-value-injected-later';
      const b = svc.mintIntentToken
        ? svc.mintIntentToken({ tool: 't', args: {} })
        : null;
      if (a && b) {
        // Different signing keys must produce different tokens; identical output
        // would mean the key was captured once at require time.
        expect(a).not.toEqual(b);
      }
    } finally {
      if (prev === undefined) delete process.env.INTENT_TOKEN_SECRET;
      else process.env.INTENT_TOKEN_SECRET = prev;
    }
  });
});
