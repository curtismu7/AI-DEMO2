// Task 8 of docs/superpowers/plans/2026-09-08-privilege-first-gateway.md.
//
// With the PingOne Agent Privilege in front, the Authorization header on
// the backend hop belongs to Privilege: it stamps the Static Token configured
// on the Agentic App. The caller's own transaction token arrives in tx-token, which
// was measured surviving that hop unmodified (privilege/CURRENT-CONFIGURATION.md,
// "Backend hop", 2026-09-10).
//
// So this gateway has to recognise the bridge credential BEFORE
// validateInboundToken, which would otherwise reject it at JWKS key selection
// ("Token has no kid header and the JWKS exposes N keys" — measured live), and
// then run the whole pipeline on the SUBJECT token so introspection, RFC 8693
// exchange and P1AZ all see the real delegated user.
//
// The security property under test: the header is trusted ONLY when the bearer
// is the shared secret. From any other caller it is ignored outright.

import {
  isPrivilegeBridgeBearer,
  transactionTokenFromHeaders,
  transactionTokenHeaderState,
} from '../auth/privilegeBridge';

const SECRET = 'a'.repeat(64);

describe('isPrivilegeBridgeBearer', () => {
  test('matches the configured secret exactly', () => {
    expect(isPrivilegeBridgeBearer(SECRET, SECRET)).toBe(true);
  });

  test('rejects a different value of the same length (constant-time compare still says no)', () => {
    expect(isPrivilegeBridgeBearer('b'.repeat(64), SECRET)).toBe(false);
  });

  test('rejects a different length without throwing', () => {
    expect(isPrivilegeBridgeBearer('short', SECRET)).toBe(false);
  });

  test('is OFF when no secret is configured — an empty config must never match an empty bearer', () => {
    expect(isPrivilegeBridgeBearer('', '')).toBe(false);
    expect(isPrivilegeBridgeBearer(SECRET, '')).toBe(false);
  });
});

describe('transactionTokenFromHeaders', () => {
  test('reads the transaction token', () => {
    expect(transactionTokenFromHeaders({ 'tx-token': 'user.jwt.here' })).toBe('user.jwt.here');
  });

  test('absent header yields null', () => {
    expect(transactionTokenFromHeaders({})).toBeNull();
  });

  test('legacy subject-token header is not accepted', () => {
    expect(transactionTokenFromHeaders({ 'x-subject-token': 'legacy.jwt.here' })).toBeNull();
  });

  test('an array-valued header is refused rather than silently joined', () => {
    expect(transactionTokenFromHeaders({ 'tx-token': ['a', 'b'] })).toBeNull();
  });

  test('an oversized header is refused — a bearer slot is not a payload channel', () => {
    expect(transactionTokenFromHeaders({ 'tx-token': 'x'.repeat(9000) })).toBeNull();
  });

  test('whitespace-only is treated as absent', () => {
    expect(transactionTokenFromHeaders({ 'tx-token': '   ' })).toBeNull();
  });
});

describe('transactionTokenHeaderState', () => {
  test('distinguishes an absent header from an invalid present header', () => {
    expect(transactionTokenHeaderState({})).toEqual({ present: false, value: null });
    expect(transactionTokenHeaderState({ 'tx-token': '   ' })).toEqual({ present: true, value: null });
  });

  test('marks repeated and oversized headers invalid instead of treating them as absent', () => {
    expect(transactionTokenHeaderState({ 'tx-token': ['a', 'b'] })).toEqual({ present: true, value: null });
    expect(transactionTokenHeaderState({ 'tx-token': 'x'.repeat(9000) })).toEqual({ present: true, value: null });
  });
});
