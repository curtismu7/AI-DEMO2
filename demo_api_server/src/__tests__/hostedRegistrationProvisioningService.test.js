'use strict';

const { createHostedRegistrationProvisioningService } = require('../../services/hostedRegistrationProvisioningService');

test('approval creates a disabled PingOne user, assigns the group, then enables it', async () => {
  const calls = [];
  const management = {
    getUser: async () => null,
    createUser: async (input) => { calls.push(['create', input]); return { success: true, user: { id: 'p1-user' } }; },
    addUserToGroup: async (...args) => { calls.push(['group', ...args]); return { success: true }; },
    setUserCanAuthenticate: async (...args) => { calls.push(['auth', ...args]); return { success: true }; },
  };
  const service = createHostedRegistrationProvisioningService({ management });
  const result = await service.approve({ email: 'alice@pingidentity.com', firstName: 'Alice', lastName: 'Example' }, { groupId: 'group-1' });

  expect(result).toEqual({ pingOneUserId: 'p1-user', groups: ['group-1'] });
  expect(calls).toEqual([
    ['create', expect.objectContaining({ email: 'alice@pingidentity.com', canAuthenticate: false })],
    ['group', 'p1-user', 'group-1'],
    ['auth', 'p1-user', true],
  ]);
});

test('disable turns off PingOne authentication for an approved user', async () => {
  const calls = [];
  const service = createHostedRegistrationProvisioningService({
    management: { setUserCanAuthenticate: async (...args) => { calls.push(args); return { success: true }; } },
  });
  await service.disable({ pingOneUserId: 'p1-user' });
  expect(calls).toEqual([['p1-user', false]]);
});
