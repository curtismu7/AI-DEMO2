jest.mock('../../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));
jest.mock('../../services/pingOneUserService', () => ({ initialize: jest.fn(), makeRequest: jest.fn() }));

const { fetchPingOneUserByUsername } = require('../../services/pingOneUserLookupService');
const pingOneUserService = require('../../services/pingOneUserService');
const { isPingOneAdminByUsername } = require('../../services/pingOneGroupMembershipService');

const ADMIN_GID = 'gid-admin';
function directory({ memberships = [ADMIN_GID] } = {}) {
  pingOneUserService.makeRequest.mockImplementation(async (_m, path) => {
    if (path.startsWith('/groups?')) return { _embedded: { groups: [{ id: ADMIN_GID, name: 'pingone-admin' }] } };
    if (path.endsWith('/memberOfGroups')) return { _embedded: { groupMemberships: memberships.map((id) => ({ id, name: id })) } };
    throw new Error(`unexpected ${path}`);
  });
}

describe('isPingOneAdminByUsername', () => {
  beforeEach(() => jest.clearAllMocks());

  test('member with matching username (case-insensitive) is admin', async () => {
    fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'u1', username: 'DemoAdmin', enabled: true } });
    directory();
    await expect(isPingOneAdminByUsername(' demoadmin ')).resolves.toBe(true);
  });

  test.each([
    ['not found', { user: null, error: 'not_found' }],
    ['lookup error', { user: null, error: 'request_failed' }],
    ['disabled', { user: { id: 'u1', username: 'demoAdmin', enabled: false } }],
    ['different username', { user: { id: 'u1', username: 'demoAdmin2', enabled: true } }],
  ])('%s → not admin', async (_label, lookup) => {
    fetchPingOneUserByUsername.mockResolvedValue(lookup);
    directory();
    await expect(isPingOneAdminByUsername('demoAdmin')).resolves.toBe(false);
  });

  test('non-member (similar group name only) → not admin', async () => {
    fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'u1', username: 'demoUser', enabled: true } });
    directory({ memberships: ['gid-other'] });
    await expect(isPingOneAdminByUsername('demoUser')).resolves.toBe(false);
  });

  test('group call throws → not admin', async () => {
    fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'u1', username: 'demoAdmin', enabled: true } });
    pingOneUserService.makeRequest.mockRejectedValue(new Error('500'));
    await expect(isPingOneAdminByUsername('demoAdmin')).resolves.toBe(false);
  });
});
