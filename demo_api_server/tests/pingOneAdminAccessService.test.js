'use strict';

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(),
  listUserGroupNamesForVertical: jest.fn(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
});

test('permits a live pingone-admin member', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'PERMIT' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: true,
    status: 200,
    requiredGroup: 'pingone-admin',
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'user-1',
      requiredGroup: 'pingone-admin',
      inRequiredGroup: true,
      verticalId: 'pingone-admin',
    }),
  );
});

test('denies a user outside the live pingone-admin group', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({ inRequiredGroup: false }),
  );
});

test('fails closed on an INDETERMINATE PingOne Authorize decision', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'INDETERMINATE' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed with 503 when PingOne Authorize is unreachable', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockRejectedValue(
    new Error('PingOne Authorize decision endpoint evaluation failed (503): timeout'),
  );

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
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
