'use strict';
const { withSessions } = require('../../scripts/pingfederate/provision-pf-sso-session');

test('withSessions flips only enableSessions', () => {
  const policy = { enableSessions: false, persistentSessions: false, idleTimeoutMins: 60 };
  expect(withSessions(policy, true)).toEqual({ ...policy, enableSessions: true });
  expect(policy.enableSessions).toBe(false);
});
