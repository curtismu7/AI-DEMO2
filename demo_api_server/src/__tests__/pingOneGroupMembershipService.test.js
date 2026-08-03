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

  it('filters live groups to the active vertical manifest names', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      data: {
        _embedded: {
          groups: [
            { name: 'AI_Demo_Privileged' },
            { name: 'Banking_PremiumTier' },
            { name: 'SomeOtherGroup' },
          ],
        },
      },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'banking');
    expect(names).toEqual(['AI_Demo_Privileged', 'Banking_PremiumTier']);
    expect(pingOneUserService.makeRequest).toHaveBeenCalledWith(
      'GET',
      '/users/user-1/memberOfGroups',
    );
  });

  it('returns cached results within TTL', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({
      data: { _embedded: { groups: [{ name: 'Banking_Privileged' }] } },
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
      data: { _embedded: { groups: [{ name: 'Banking_Privileged' }] } },
    });

    const names = await membershipService.listUserGroupNamesForVertical('user-1', 'oauth-teaching');
    expect(names).toEqual([]);
  });
});
