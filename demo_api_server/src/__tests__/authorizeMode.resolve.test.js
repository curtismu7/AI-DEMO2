/**
 * @file authorizeMode.resolve.test.js
 *
 * Unit contract for simulatedAuthorizeService.resolveAuthorizeMode() — the
 * single source of truth that maps the `authorize_mode` configStore key (and
 * the legacy ff_authorize_simulated / authorize_failover_mode fallback) to
 * { mode, useSimulated, failoverMode }.
 */

'use strict';

const { resolveAuthorizeMode, AUTHORIZE_MODES } = require('../../services/simulatedAuthorizeService');
const { FIELD_DEFS } = require('../../services/configStore');

// Minimal configStore double: getEffective reads the provided map (env-aware
// production parity); get is the raw fallback. Returns '' for missing keys,
// matching the real getEffective contract.
function mkStore(map = {}) {
  return {
    getEffective: (k) => (k in map ? map[k] : ''),
    get: (k) => (k in map ? map[k] : null),
  };
}

describe('resolveAuthorizeMode — explicit authorize_mode', () => {
  test('pingone → P1 only, fail-closed deny', () => {
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'pingone' }))).toEqual({
      mode: 'pingone', useSimulated: false, failoverMode: 'deny',
    });
  });

  test('simulated → demo engine', () => {
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'simulated' }))).toEqual({
      mode: 'simulated', useSimulated: true, failoverMode: 'fallback_simulated',
    });
  });

  test('pingone_fallback_simulated → P1 with demo fallback', () => {
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'pingone_fallback_simulated' }))).toEqual({
      mode: 'pingone_fallback_simulated', useSimulated: false, failoverMode: 'fallback_simulated',
    });
  });

  test('legacy ff_authorize_fail_open=true overrides failover to permit', () => {
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'pingone', ff_authorize_fail_open: 'true' })))
      .toEqual({ mode: 'pingone', useSimulated: false, failoverMode: 'permit' });
  });

  test('ff_authorize_simulated=true overrides authorize_mode=pingone default (no split brain)', () => {
    // QuickFlagsPill sets ff_authorize_simulated; it must win for the BFF path
    // too so the transaction engine and the PingGateway header agree.
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'pingone', ff_authorize_simulated: 'true' })))
      .toEqual({ mode: 'simulated', useSimulated: true, failoverMode: 'fallback_simulated' });
  });
});

describe('resolveAuthorizeMode — legacy fallback (authorize_mode unset)', () => {
  test('ff_authorize_simulated=true → simulated', () => {
    expect(resolveAuthorizeMode(mkStore({ ff_authorize_simulated: 'true' }))).toEqual({
      mode: 'simulated', useSimulated: true, failoverMode: 'fallback_simulated',
    });
  });

  test('ff_authorize_simulated=false + failover fallback_simulated → pingone_fallback_simulated', () => {
    expect(resolveAuthorizeMode(mkStore({ ff_authorize_simulated: 'false', authorize_failover_mode: 'fallback_simulated' })))
      .toEqual({ mode: 'pingone_fallback_simulated', useSimulated: false, failoverMode: 'fallback_simulated' });
  });

  test('ff_authorize_simulated=false + failover deny → pingone', () => {
    expect(resolveAuthorizeMode(mkStore({ ff_authorize_simulated: 'false', authorize_failover_mode: 'deny' })))
      .toEqual({ mode: 'pingone', useSimulated: false, failoverMode: 'deny' });
  });

  test('invalid authorize_mode falls through to legacy derivation', () => {
    expect(resolveAuthorizeMode(mkStore({ authorize_mode: 'bogus', ff_authorize_simulated: 'false', authorize_failover_mode: 'deny' })))
      .toEqual({ mode: 'pingone', useSimulated: false, failoverMode: 'deny' });
  });
});

describe('resolveAuthorizeMode — robustness', () => {
  test('AUTHORIZE_MODES is the canonical 3-mode list', () => {
    expect(AUTHORIZE_MODES).toEqual(['pingone', 'simulated', 'pingone_fallback_simulated']);
  });

  test('falls back to get() when getEffective is absent', () => {
    const store = { get: (k) => (k === 'authorize_mode' ? 'pingone' : null) };
    expect(resolveAuthorizeMode(store).mode).toBe('pingone');
  });
});

describe('authorize_mode default (FIELD_DEFS source of truth)', () => {
  // Regression guard: the baked-in default is what makes a fresh/empty configStore,
  // a missing .env, a restart, or a rebuild resolve to real PingOne with simulated
  // FALLBACK (demo-reliability decision 2026-07-11 — a live P1AZ outage falls back
  // to the in-process engine + operator modal instead of 503-blocking the demo;
  // docs/superpowers/specs/2026-07-11-p1az-reliability-design.md §3). Strict
  // fail-closed is still available by explicitly storing authorize_mode='pingone'.
  // The resolver tests above use store doubles that bypass FIELD_DEFS, so this
  // pins the default itself.
  test("defaults to 'pingone_fallback_simulated'", () => {
    expect(FIELD_DEFS.authorize_mode.default).toBe('pingone_fallback_simulated');
  });

  test('a store reflecting only the FIELD_DEFS default resolves to real PingOne with simulated fallback', () => {
    const store = mkStore({ authorize_mode: FIELD_DEFS.authorize_mode.default });
    expect(resolveAuthorizeMode(store)).toEqual({
      mode: 'pingone_fallback_simulated', useSimulated: false, failoverMode: 'fallback_simulated',
    });
  });

  test("explicit authorize_mode='pingone' still resolves strict fail-closed", () => {
    const store = mkStore({ authorize_mode: 'pingone' });
    expect(resolveAuthorizeMode(store)).toEqual({
      mode: 'pingone', useSimulated: false, failoverMode: 'deny',
    });
  });
});
