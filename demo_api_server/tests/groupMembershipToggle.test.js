'use strict';

/**
 * setUserGroupMembership — the demo's live in-group/out-of-group toggle.
 *
 * Fixtures use the REAL PingOne response shape: makeRequest resolves to the
 * parsed BODY (no `data` envelope) and collections come back under
 * `_embedded.groups` / `_embedded.groupMemberships`. A fixture that gets this
 * wrong proves only that the code parses fiction — that is exactly how the
 * membership read shipped broken (#1323).
 */

jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  makeRequest: jest.fn(),
}));

const pingOneUserService = require('../services/pingOneUserService');
const membershipService = require('../services/pingOneGroupMembershipService');
const { verticalManifest } = require('../services/verticalManifest');
const groupPolicy = require('../services/groupPolicy');

const GROUP = 'AI_Demo_Privileged';
const GROUP_ID = 'ccb673eb-fdd2-4805-9fab-bd54c91ae13d';
const USER_ID = '1aee74ae-3d09-4bcf-a69f-7e1bc225b761';

/** Route GETs to the group lookup, everything else to a caller-supplied handler. */
function mockPingOne({ groupExists = true, onWrite = () => ({}) } = {}) {
  pingOneUserService.makeRequest.mockImplementation(async (method, path, body) => {
    if (method === 'GET' && path.startsWith('/groups?')) {
      return { _embedded: { groups: groupExists ? [{ id: GROUP_ID, name: GROUP }] : [] } };
    }
    return onWrite(method, path, body);
  });
}

describe('setUserGroupMembership', () => {
  beforeAll(() => { verticalManifest.init(); });

  beforeEach(() => {
    jest.clearAllMocks();
    membershipService._resetCache();
    groupPolicy._reset();
    pingOneUserService.initialize.mockImplementation(() => {});
  });

  it('adds the user to the group with a POST', async () => {
    const calls = [];
    mockPingOne({ onWrite: (method, path) => { calls.push([method, path]); return {}; } });

    const r = await membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: true,
    });

    expect(r).toMatchObject({ changed: true, inGroup: true, groupId: GROUP_ID });
    expect(calls).toEqual([['POST', `/users/${USER_ID}/memberOfGroups`]]);
  });

  it('removes the user from the group with a DELETE naming the group id', async () => {
    const calls = [];
    mockPingOne({ onWrite: (method, path) => { calls.push([method, path]); return {}; } });

    const r = await membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: false,
    });

    expect(r).toMatchObject({ changed: true, inGroup: false });
    expect(calls).toEqual([['DELETE', `/users/${USER_ID}/memberOfGroups/${GROUP_ID}`]]);
  });

  it('treats "already a member" as the desired end state, not an error', async () => {
    mockPingOne({
      onWrite: () => { const e = new Error('User is already a member'); throw e; },
    });

    const r = await membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: true,
    });
    expect(r).toMatchObject({ changed: false, inGroup: true });
  });

  it('treats "not a member" on removal as the desired end state', async () => {
    mockPingOne({
      onWrite: () => { const e = new Error('not found'); e.pingone = { status: 404 }; throw e; },
    });

    const r = await membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: false,
    });
    expect(r).toMatchObject({ changed: false, inGroup: false });
  });

  it('re-throws a real write failure instead of reporting success', async () => {
    mockPingOne({ onWrite: () => { throw new Error('500 upstream exploded'); } });

    await expect(membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: true,
    })).rejects.toThrow(/upstream exploded/);
  });

  describe('blast radius', () => {
    it('REFUSES a username outside the demo allowlist', async () => {
      // A demo control that can reassign an arbitrary user's groups is a
      // privilege-escalation primitive reachable from a browser. The refusal
      // must happen before any PingOne call.
      mockPingOne();

      await expect(membershipService.setUserGroupMembership({
        username: 'realCustomer', pingOneUserId: USER_ID, groupName: GROUP, inGroup: true,
      })).rejects.toMatchObject({ code: 'user_not_toggleable' });

      expect(pingOneUserService.makeRequest).not.toHaveBeenCalled();
    });

    it('allows exactly the three seeded demo accounts', () => {
      expect([...membershipService.TOGGLEABLE_USERNAMES].sort())
        .toEqual(['demoAdmin', 'demoDelegate', 'demoUser']);
    });

    it('fails closed when the group does not exist rather than silently no-opping', async () => {
      mockPingOne({ groupExists: false });

      await expect(membershipService.setUserGroupMembership({
        username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: true,
      })).rejects.toMatchObject({ code: 'group_not_found' });
    });

    it('requires a PingOne user id', async () => {
      mockPingOne();
      await expect(membershipService.setUserGroupMembership({
        username: 'demoUser', pingOneUserId: null, groupName: GROUP, inGroup: true,
      })).rejects.toMatchObject({ code: 'missing_user_id' });
    });
  });

  it('busts the 60s membership cache so the next decision sees the change', async () => {
    // Without this the demo shows the PREVIOUS answer for up to a minute, which
    // is indistinguishable from the policy ignoring the toggle entirely.
    pingOneUserService.makeRequest.mockImplementation(async (method, path) => {
      if (method === 'GET' && path.startsWith('/groups?')) {
        return { _embedded: { groups: [{ id: GROUP_ID, name: GROUP }] } };
      }
      if (method === 'GET') {
        return { _embedded: { groupMemberships: [{ name: GROUP }] } };
      }
      return {};
    });

    // Warm the cache, then toggle, then read again.
    await membershipService.listUserGroupNamesForVertical(USER_ID, 'banking');
    const readsBefore = pingOneUserService.makeRequest.mock.calls
      .filter(([m, p]) => m === 'GET' && p.includes('memberOfGroups')).length;

    await membershipService.setUserGroupMembership({
      username: 'demoUser', pingOneUserId: USER_ID, groupName: GROUP, inGroup: false,
    });
    await membershipService.listUserGroupNamesForVertical(USER_ID, 'banking');

    const readsAfter = pingOneUserService.makeRequest.mock.calls
      .filter(([m, p]) => m === 'GET' && p.includes('memberOfGroups')).length;

    expect(readsAfter).toBeGreaterThan(readsBefore);
  });
});
