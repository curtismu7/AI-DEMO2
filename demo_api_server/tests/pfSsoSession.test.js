'use strict';
const { withSessions, adapterPolicy } = require('../../scripts/pingfederate/provision-pf-sso-session');

test('withSessions flips only enableSessions', () => {
  const policy = { enableSessions: false, persistentSessions: false, idleTimeoutMins: 60 };
  expect(withSessions(policy, true)).toEqual({ ...policy, enableSessions: true });
  expect(policy.enableSessions).toBe(false);
});

test('the adapter policy targets the PF sign-in adapter with sessions on', () => {
  expect(adapterPolicy()).toMatchObject({
    authenticationSource: { type: 'IDP_ADAPTER', sourceRef: { id: 'aiDemoPfHtmlForm' } },
    enableSessions: true,
  });
});
