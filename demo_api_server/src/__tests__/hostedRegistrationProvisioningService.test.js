'use strict';

const { createHostedRegistrationProvisioningService } = require('../../services/hostedRegistrationProvisioningService');

test('approval creates a disabled PingOne user, assigns the group, then enables it', async () => {
  const calls = [];
  const management = {
    getUser: async () => null,
    createUser: async (input) => { calls.push(['create', input]); return { success: true, user: { id: 'p1-user' } }; },
    updateUserProfile: async (...args) => { calls.push(['profile', ...args]); return { success: true }; },
    addUserToGroup: async (...args) => { calls.push(['group', ...args]); return { success: true }; },
    setUserCanAuthenticate: async (...args) => { calls.push(['auth', ...args]); return { success: true }; },
  };
  const service = createHostedRegistrationProvisioningService({ management });
  const result = await service.approve({ email: 'alice@pingidentity.com', firstName: 'Alice', lastName: 'Example', phone: '+12145550123' }, { groupId: 'group-1' });

  expect(result).toEqual({ pingOneUserId: 'p1-user', groups: ['group-1'] });
  expect(calls).toEqual([
    ['create', expect.objectContaining({ email: 'alice@pingidentity.com', canAuthenticate: false })],
    ['profile', 'p1-user', expect.objectContaining({ firstName: 'Alice', lastName: 'Example', mobilePhone: '+12145550123' })],
    ['group', 'p1-user', 'group-1'],
    ['auth', 'p1-user', true],
  ]);
});

test('staging reuses an existing PingOne user matching the registration email', async () => {
  const calls = [];
  const management = {
    findUserByEmail: async () => ({ id: 'existing-user' }),
    addUserToGroup: async (...args) => { calls.push(['group', ...args]); return { success: true }; },
    setUserCanAuthenticate: async (...args) => { calls.push(['auth', ...args]); return { success: true }; },
  };
  const service = createHostedRegistrationProvisioningService({ management });

  const result = await service.stage({ email: 'cmuir@pingidentity.com' });

  expect(result).toEqual({ pingOneUserId: 'existing-user', groups: [process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID || undefined].filter(Boolean) });
  expect(calls.some(([op]) => op === 'create')).toBe(false);
});

test('disable turns off PingOne authentication for an approved user', async () => {
  const calls = [];
  const service = createHostedRegistrationProvisioningService({
    management: { setUserCanAuthenticate: async (...args) => { calls.push(args); return { success: true }; } },
  });
  await service.disable({ pingOneUserId: 'p1-user' });
  expect(calls).toEqual([['p1-user', false]]);
});
