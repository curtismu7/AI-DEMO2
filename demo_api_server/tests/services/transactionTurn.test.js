'use strict';
/**
 * Unit tests for resolveActingIdentity() (middleware/transactionTurn.js) —
 * the identity-resolution helper shared by the transaction-ledger write side
 * (transactionTurn.js, stamps `hop.identity.sub`) and the read side
 * (routes/transactionTrace.js `_isOwnRecord`).
 *
 * No dedicated tests/middleware/ directory exists in this repo, and this
 * file's `--testPathIgnorePatterns` sweep target for the task is
 * `tests/services/`, so the helper's unit tests live here rather than
 * introducing a new, unswept directory. See
 * tests/routes/transactionTrace.test.js for the write/read agreement
 * integration test that exercises the helper against the read route.
 */
const { resolveActingIdentity } = require('../../middleware/transactionTurn');

describe('resolveActingIdentity', () => {
  test('resolves from the real BFF session-user shape ({id, username, email, role} — no sub)', () => {
    const req = {
      session: {
        user: {
          id: '5',
          username: 'demoUser',
          email: 'demoUser@api.ping.demo',
          firstName: 'Demo',
          lastName: 'User',
          role: 'customer',
        },
      },
    };
    expect(resolveActingIdentity(req)).toBe('5');
  });

  test('resolves from req.user (authenticateToken shape: {id, sub, ...}) when there is no session', () => {
    const req = { user: { id: 'abc-123', sub: 'abc-123', role: 'customer' } };
    expect(resolveActingIdentity(req)).toBe('abc-123');
  });

  test('prefers req.user over req.session.user when both are present', () => {
    const req = {
      user: { id: 'from-req-user' },
      session: { user: { id: 'from-session' } },
    };
    expect(resolveActingIdentity(req)).toBe('from-req-user');
  });

  test('returns null (not undefined, not the string "undefined") when neither source carries an identity', () => {
    expect(resolveActingIdentity({})).toBeNull();
    expect(resolveActingIdentity({ session: {} })).toBeNull();
    expect(resolveActingIdentity({ session: { user: {} } })).toBeNull();
    expect(resolveActingIdentity({ user: {} })).toBeNull();
  });
});
