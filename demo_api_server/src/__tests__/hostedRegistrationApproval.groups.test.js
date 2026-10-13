'use strict';
// Approval must move the user pending → complete. The invite flow (Task 1)
// adds users to the PARTIAL group; if approval's group move is a no-op or
// targets the wrong env var, an invited+approved user still cannot sign in.

jest.mock('../../services/lmdb/hostedRegistrationStore.lmdb', () => ({
  get: jest.fn(), put: jest.fn(), list: jest.fn(() => []), remove: jest.fn(),
}));
jest.mock('../../services/hostedRegistrationProvisioningService', () => ({
  createHostedRegistrationProvisioningService: () => ({
    approve: jest.fn(async (record, { groupId }) => ({
      pingOneUserId: record.pingOneUserId || 'user-1',
      groups: groupId ? [groupId] : [],
    })),
  }),
}));
jest.mock('../../services/emailService', () => ({ sendHostedRegistrationConfirmation: jest.fn().mockResolvedValue(true) }));

const process_ = process;
describe('hosted registration approval group wiring', () => {
  beforeEach(() => { process_.env.HOSTED_ACCESS_USER_GROUP_ID = 'complete-group'; });
  afterEach(() => {
    // M4: set in beforeEach with no restore — leaked into other suites.
    delete process_.env.HOSTED_ACCESS_USER_GROUP_ID;
  });

  test('approve passes HOSTED_ACCESS_USER_GROUP_ID as the target group', async () => {
    const { createHostedRegistrationAdminService } = require('../../services/hostedRegistrationAdminService');
    const svc = createHostedRegistrationAdminService();
    // store mock must return a pending record
    const store = require('../../services/lmdb/hostedRegistrationStore.lmdb');
    store.get.mockReturnValue({ id: 'reg-1', status: 'pending_approval', email: 'a@pingidentity.com', pingOneUserId: 'user-1' });
    const out = await svc.approve('reg-1', { role: 'user', adminId: 'admin-1' });
    expect(out.groups).toContain('complete-group');
  });
});
