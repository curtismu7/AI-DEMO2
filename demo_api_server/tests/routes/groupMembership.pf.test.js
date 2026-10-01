'use strict';

// The group panel under a PingFederate sign-in. The session subject is a
// PingFederate username, which PingOne's directory does not know as a user id:
// the read fell back to the manifest ("Source: manifest (not live)") and the
// toggle wrote to /users/<username>/memberOfGroups. Both must use the PingOne
// account with the same username.

const express = require('express');
const request = require('supertest');

jest.mock('../../services/configStore', () => ({ ensureInitialized: jest.fn(async () => {}) }));
jest.mock('../../services/groupPolicy', () => ({
  groupsForUserSync: jest.fn(() => ['from-manifest']),
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
  isEnabled: jest.fn(() => true),
  resolveUserTier: jest.fn(() => null),
}));
jest.mock('../../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  listUserGroupNamesForVertical: jest.fn(async () => ['pingone-admin']),
  setUserGroupMembership: jest.fn(async () => ({ changed: true })),
}));
jest.mock('../../services/pingOneAuthorizeService', () => ({}));
jest.mock('../../services/agentMcpTokenService', () => ({}));
jest.mock('../../services/a2aDelegationService', () => ({}));
jest.mock('../../services/scopeTopology', () => ({}));
jest.mock('../../services/pingOneGroupProvisionService', () => ({ provisionVerticalGroups: jest.fn() }));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    init: jest.fn(),
    resolver: { activeIdFor: jest.fn(() => 'pingone-admin'), resolve: jest.fn(() => ({ identity: {}, groups: { categories: {} } })) },
  },
}));
jest.mock('../../middleware/auth', () => ({ requireSession: (req, res, next) => next() }));
jest.mock('../../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));

const membershipService = require('../../services/pingOneGroupMembershipService');
const { fetchPingOneUserByUsername } = require('../../services/pingOneUserLookupService');
const groupMembershipRoutes = require('../../routes/groupMembership');

function buildApp(session) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/groups', groupMembershipRoutes);
  return app;
}

const pfSession = { oauthProvider: 'pingfederate', user: { username: 'demoadmin', oauthId: 'demoadmin' } };

beforeEach(() => {
  jest.clearAllMocks();
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-uuid', username: 'demoAdmin' }, error: null });
});

test('reads membership live from the PingOne account with the same username', async () => {
  const res = await request(buildApp(pfSession)).get('/api/groups/membership').expect(200);

  expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demoadmin');
  expect(membershipService.listUserGroupNamesForVertical).toHaveBeenCalledWith('p1-uuid', 'pingone-admin');
  expect(res.body).toMatchObject({ source: 'pingone', pingOneUserId: 'p1-uuid', groups: ['pingone-admin'] });
});

test('says manifest, and asks PingOne nothing by username-as-id, when no PingOne account matches', async () => {
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });

  const res = await request(buildApp(pfSession)).get('/api/groups/membership').expect(200);

  expect(membershipService.listUserGroupNamesForVertical).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ source: 'manifest', pingOneUserId: null });
});

test('toggles the PingOne account, under its own username', async () => {
  await request(buildApp(pfSession)).post('/api/groups/membership/toggle').send({ inGroup: true }).expect(200);

  expect(membershipService.setUserGroupMembership).toHaveBeenCalledWith({
    username: 'demoAdmin', pingOneUserId: 'p1-uuid', groupName: 'pingone-admin', inGroup: true,
  });
});

test('a PingOne session uses its own subject and never searches by username', async () => {
  const p1Session = { oauthProvider: 'pingone', user: { username: 'demoAdmin', oauthId: 'p1-sub' } };

  const res = await request(buildApp(p1Session)).get('/api/groups/membership').expect(200);

  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
  expect(res.body).toMatchObject({ source: 'pingone', pingOneUserId: 'p1-sub' });
});
