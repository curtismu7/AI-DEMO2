// Task 8 of docs/superpowers/plans/2026-09-08-privilege-first-gateway.md.
//
// With the PingOne Privilege AI Gateway in front, the Authorization header on
// the backend hop belongs to Privilege: it stamps the Static Token configured
// on the Agentic App. The caller's own token arrives in X-Subject-Token, which
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

import { isPrivilegeBridgeBearer, subjectTokenFromHeaders } from '../auth/privilegeBridge';

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

describe('subjectTokenFromHeaders', () => {
  test('reads the subject token', () => {
    expect(subjectTokenFromHeaders({ 'x-subject-token': 'user.jwt.here' })).toBe('user.jwt.here');
  });

  test('absent header yields null', () => {
    expect(subjectTokenFromHeaders({})).toBeNull();
  });

  test('an array-valued header is refused rather than silently joined', () => {
    expect(subjectTokenFromHeaders({ 'x-subject-token': ['a', 'b'] })).toBeNull();
  });

  test('an oversized header is refused — a bearer slot is not a payload channel', () => {
    expect(subjectTokenFromHeaders({ 'x-subject-token': 'x'.repeat(9000) })).toBeNull();
  });

  test('whitespace-only is treated as absent', () => {
    expect(subjectTokenFromHeaders({ 'x-subject-token': '   ' })).toBeNull();
  });
});
