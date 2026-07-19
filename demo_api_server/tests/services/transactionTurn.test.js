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

  // Regression guard for a real, live defect. The write path (/api/demo-agent)
  // has no authenticateToken, so only the session is available there; the read
  // path has both. req.user.id is the PingOne `sub` (a UUID) while
  // session.user.id is an app-internal id like "5" — two different identity
  // spaces. Preferring req.user stored the session id on write and compared a
  // UUID on read, so nothing ever matched and the feature was invisible to
  // every non-admin. The session wins because it is present on BOTH paths.
  test('prefers req.session.user over req.user so write and read resolve the SAME identity', () => {
    const req = {
      user: { id: 'pingone-sub-uuid' },
      session: { user: { id: 'from-session' } },
    };
    expect(resolveActingIdentity(req)).toBe('from-session');
  });

  test('returns null (not undefined, not the string "undefined") when neither source carries an identity', () => {
    expect(resolveActingIdentity({})).toBeNull();
    expect(resolveActingIdentity({ session: {} })).toBeNull();
    expect(resolveActingIdentity({ session: { user: {} } })).toBeNull();
    expect(resolveActingIdentity({ user: {} })).toBeNull();
  });
});
