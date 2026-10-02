'use strict';

// Which PingOne user a PingOne per-user call should target for the signed-in
// user. Under PingFederate the session subject is a username PingOne does not
// know as an id; sending it made step-up MFA 502 and group lookups fall back
// silently to the manifest.

jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn(),
}));

const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const { pingOneUserIdFor } = require('../services/pingOneSessionUser');

beforeEach(() => {
  jest.clearAllMocks();
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid', username: 'demoUser' }, error: null });
});

test('a PingOne session gets back exactly the id the caller already used, with no lookup', async () => {
  const req = { session: { oauthProvider: 'pingone', user: { username: 'demoUser', oauthId: 'p1-sub' } } };

  await expect(pingOneUserIdFor(req, 'p1-sub')).resolves.toBe('p1-sub');
  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
  expect(req.session.user.pingOneUserId).toBeUndefined();
});

test('no session at all (bearer-only caller) keeps the caller\'s id', async () => {
  await expect(pingOneUserIdFor({}, 'token-sub')).resolves.toBe('token-sub');
  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
});

test('a PingFederate session resolves the PingOne account by username, once', async () => {
  const req = { session: { oauthProvider: 'pingfederate', user: { username: 'demouser', oauthId: 'demouser' } } };

  await expect(pingOneUserIdFor(req, 'demouser')).resolves.toBe('p1-uuid');
  await expect(pingOneUserIdFor(req, 'demouser')).resolves.toBe('p1-uuid');

  expect(fetchPingOneUserByUsername).toHaveBeenCalledTimes(1);
  expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demouser');
});

test('reads the provider from the session, where the admin sign-in records it', async () => {
  // The admin sign-in stores 'pingone_sso' on the user record under either provider.
  const req = { session: { oauthProvider: 'pingfederate', user: { username: 'demoadmin', oauthProvider: 'pingone_sso' } } };

  await expect(pingOneUserIdFor(req, 'demoadmin')).resolves.toBe('p1-uuid');
});

test('a PingFederate user with no PingOne account gets null, never the PingFederate subject', async () => {
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
  const req = { session: { oauthProvider: 'pingfederate', user: { username: 'pf-only', oauthId: 'pf-only' } } };

  await expect(pingOneUserIdFor(req, 'pf-only')).resolves.toBeNull();
  // Not remembered, so an account created later is picked up.
  expect(req.session.user.pingOneUserId).toBeUndefined();
});
