'use strict';
// stage() must tolerate the already-a-member outcome. The invite flow parks
// the invitee in the PARTIAL group at send-invite time; a later self-service
// registration (same email, LMDB dedupes) re-runs stage() against the SAME
// PingOne user — addUserToGroup then fails with the duplicate-membership
// outcome, and a strict throw would kill a registration that is actually fine.

jest.mock('../services/pingoneManagementService', () => ({
  managementService: {
    initialize: jest.fn(),
    getUser: jest.fn(),
    findUserByEmail: jest.fn(),
    createUser: jest.fn(),
    setUserMfaEnabled: jest.fn(),
    addUserToGroup: jest.fn(),
  },
}));
jest.mock('../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('worker-token-1'),
}));
jest.mock('../services/mfaService', () => ({
  enrollSmsDevice: jest.fn(),
}));

const { createHostedRegistrationProvisioningService } = require('../services/hostedRegistrationProvisioningService');
const { managementService } = require('../services/pingoneManagementService');

function makeSvc() {
  return createHostedRegistrationProvisioningService({ management: managementService });
}

describe('hostedRegistrationProvisioningService.stage — already-member tolerance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Real getUser returns the user object directly (null on 404), NOT
    // { success, user } — see pingoneManagementService.getUser.
    managementService.getUser.mockResolvedValue({ id: 'user-1' });
    managementService.setUserMfaEnabled.mockResolvedValue({ success: true });
  });

  test('409 duplicate-membership from addUserToGroup is treated as success', async () => {
    managementService.addUserToGroup.mockResolvedValue({ success: false, error: 'The user is already a member of the group', status: 409 });

    const staged = await makeSvc().stage({
      pingOneUserId: 'user-1',
      email: 'already@pingidentity.com',
      firstName: 'A', lastName: 'B', phone: '+14155550123',
    }, { partialGroupId: 'partial-1' });

    expect(staged).toEqual({ pingOneUserId: 'user-1', groups: ['partial-1'] });
    expect(managementService.addUserToGroup).toHaveBeenCalledWith('user-1', 'partial-1');
  });

  test('success=false with a non-member error still throws', async () => {
    managementService.addUserToGroup.mockResolvedValue({ success: false, error: 'PingOne down', status: 503 });

    await expect(makeSvc().stage({
      pingOneUserId: 'user-1',
      email: 'x@pingidentity.com',
    }, { partialGroupId: 'partial-1' })).rejects.toThrow('PingOne down');
  });

  test('addUserToGroup throw with duplicate-membership message is treated as success', async () => {
    managementService.addUserToGroup.mockRejectedValue(new Error('Multiple memberships: user is already a member of the group'));

    const staged = await makeSvc().stage({
      pingOneUserId: 'user-1',
      email: 'thrown@pingidentity.com',
    }, { partialGroupId: 'partial-1' });

    expect(staged.groups).toEqual(['partial-1']);
  });
});
