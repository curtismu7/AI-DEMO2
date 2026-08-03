'use strict';

jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  makeRequest: jest.fn(),
}));

const pingOneUserService = require('../../services/pingOneUserService');
const groupPolicy = require('../../services/groupPolicy');
const { verticalManifest } = require('../../services/verticalManifest');
const membershipService = require('../../services/pingOneGroupMembershipService');

describe('pingOneGroupMembershipService', () => {
  beforeAll(() => {
    verticalManifest.init();
  });

  beforeEach(() => {
    membershipService._resetCache();
    groupPolicy._reset();
    jest.clearAllMocks();
    pingOneUserService.initialize.mockImplementation(() => {});
  });

  it('isReady returns true when pingOneUserService initializes', () => {
    expect(membershipService.isReady()).toBe(true);
  });

  it('isReady returns false when worker creds are missing', () => {
    pingOneUserService.initialize.mockImplementation(() => {
      throw new Error('missing creds');
    });
    expect(membershipService.isReady()).toBe(false);
  });

  /**
   * ⚠️ THE REAL PINGONE SHAPE — captured live 2026-08-03 from env 01d89b06.
   * pingOneUserService.makeRequest resolves to the parsed BODY (no `data`
   * envelope), and the collection key is `groupMemberships` — not `groups`, and
   * not `memberOfGroups` (the endpoint's own name).
   *
   * These fixtures used to say `{ data: { _embedded: { groups } } }`, which got
   * BOTH wrong, so the parser was verified against a shape PingOne never sends
   * and the bug was invisible. In production `embedded` was always [], a user in
   * 15 groups resolved to ZERO, and this returned [] from a SUCCESSFUL call —
   * which groupPolicy lets BEAT the manifest. Every group-gated tool denied every
   * user the moment ff_authorize_group_policy went on.
   *
   * Keep these fixtures byte-shaped like the real response. A mock that encodes
   * the wrong contract proves only that the code parses fiction.
   */
  it('filters live groups to the active vertical manifest names', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: {
        groupMemberships: [
          { name: 'AI_Demo_Privileged' },
          { name: 'Banking_PremiumTier' },
          { name: 'SomeOtherGroup' },
        ],
      },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'banking');
    expect(names).toEqual(['AI_Demo_Privileged', 'Banking_PremiumTier']);
    expect(pingOneUserService.makeRequest).toHaveBeenCalledWith(
      'GET',
      '/users/user-1/memberOfGroups',
    );
  });

  it('reads the group name from _embedded.group when ?expand=group is used', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: {
        groupMemberships: [
          { id: 'm1', _embedded: { group: { name: 'AI_Demo_Privileged' } } },
          { id: 'm2', _embedded: { group: { name: 'SomeOtherGroup' } } },
        ],
      },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'banking');
    expect(names).toEqual(['AI_Demo_Privileged']);
  });

  it('does NOT silently return [] for a user who is in groups', async () => {
    // The regression, stated as the consequence rather than the parse. An empty
    // array here is indistinguishable from "member of nothing" and outranks the
    // manifest, so this is the assertion that keeps demoUser out of a total deny.
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groupMemberships: [{ name: 'AI_Demo_Privileged' }] },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'government');
    expect(names).not.toEqual([]);
    expect(names).toContain('AI_Demo_Privileged');
  });

  it('returns cached results within TTL', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groupMemberships: [{ name: 'AI_Demo_Privileged' }] },
    });

    await membershipService.listUserGroupNamesForVertical('user-1', 'banking');
    await membershipService.listUserGroupNamesForVertical('user-1', 'banking');

    expect(pingOneUserService.makeRequest).toHaveBeenCalledTimes(1);
  });

  it('returns null on API failure so caller can fall back to manifest', async () => {
    pingOneUserService.makeRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'banking');
    expect(names).toBeNull();
  });

  it('returns empty array when vertical has no declared groups', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groupMemberships: [{ name: 'AI_Demo_Privileged' }] },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'oauth-teaching');
    expect(names).toEqual([]);
  });
});
