'use strict';

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(),
  listUserGroupNamesForVertical: jest.fn(),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
});

test('permits a live pingone-admin member', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: true,
    status: 200,
    requiredGroup: 'pingone-admin',
  });
});

test('denies a user outside the live pingone-admin group', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed when live membership cannot be verified', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(null);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});
