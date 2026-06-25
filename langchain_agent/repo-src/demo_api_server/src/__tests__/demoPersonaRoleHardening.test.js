/**
 * demoPersonaRoleHardening.test.js
 * Boot-time hardening that ensures demoUser/demoAdmin/demoDelegate carry the
 * demo admin role assignments. Looks up users via pingOneUserService.listUsers
 * (worker token), then ensureAdminRoleAssignments. Replaces mayActHardening —
 * the per-user mayAct attribute write was removed with the may_act demo controls.
 */
'use strict';

jest.mock('../../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  ensureAdminRoleAssignments: jest.fn(),
  listUsers: jest.fn(),
}));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const configStore = require('../../services/configStore');
const pingOneUserService = require('../../services/pingOneUserService');
const { ensureDemoPersonaRoles } = require('../../services/demoPersonaRoleHardening');

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.ensureAdminRoleAssignments.mockResolvedValue({ assigned: [], failed: [] });
  // listUsers returns <username>-id derived from the SCIM filter.
  pingOneUserService.listUsers.mockImplementation((opts) => {
    const m = /username eq "([^"]+)"/.exec((opts && opts.filter) || '');
    const uname = m ? m[1] : 'x';
    return Promise.resolve({ _embedded: { users: [{ id: `${uname}-id` }] } });
  });
});

test('ensures admin roles on demoUser, demoAdmin, and demoDelegate', async () => {
  configStore.getEffective.mockImplementation((k) =>
    (k === 'pingone_worker_client_id' ? 'worker-id' : null)); // mayact_harden_on_startup unset → defaults enabled

  const r = await ensureDemoPersonaRoles();

  expect(pingOneUserService.ensureAdminRoleAssignments).toHaveBeenCalledWith('demoUser-id');
  expect(pingOneUserService.ensureAdminRoleAssignments).toHaveBeenCalledWith('demoAdmin-id');
  expect(pingOneUserService.ensureAdminRoleAssignments).toHaveBeenCalledWith('demoDelegate-id');
  expect(r.status).toBe('ok');
  expect(r.updated).toEqual(['demoUser', 'demoAdmin', 'demoDelegate']);
});

test('looks users up via listUsers (worker token), not getManagementToken', async () => {
  configStore.getEffective.mockImplementation((k) =>
    (k === 'pingone_worker_client_id' ? 'worker-id' : null));
  await ensureDemoPersonaRoles();
  expect(pingOneUserService.listUsers).toHaveBeenCalledWith({ filter: 'username eq "demoUser"', limit: 1 });
});

test('skips a user not found (no role write) but continues', async () => {
  configStore.getEffective.mockImplementation((k) =>
    (k === 'pingone_worker_client_id' ? 'worker-id' : null));
  pingOneUserService.listUsers.mockResolvedValue({ _embedded: { users: [] } });
  const r = await ensureDemoPersonaRoles();
  expect(pingOneUserService.ensureAdminRoleAssignments).not.toHaveBeenCalled();
  expect(r.updated).toEqual([]);
});

test('skips when disabled via persona_role_harden_on_startup=false', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'persona_role_harden_on_startup' ? 'false' : null));
  const r = await ensureDemoPersonaRoles();
  expect(r.status).toBe('skipped');
  expect(pingOneUserService.ensureAdminRoleAssignments).not.toHaveBeenCalled();
});

test('skips when disabled via the legacy mayact_harden_on_startup=false', async () => {
  configStore.getEffective.mockImplementation((k) => (k === 'mayact_harden_on_startup' ? 'false' : null));
  const r = await ensureDemoPersonaRoles();
  expect(r.status).toBe('skipped');
  expect(pingOneUserService.ensureAdminRoleAssignments).not.toHaveBeenCalled();
});

test('skips when no worker credentials', async () => {
  configStore.getEffective.mockImplementation(() => null);
  const r = await ensureDemoPersonaRoles();
  expect(r.status).toBe('skipped');
  expect(pingOneUserService.ensureAdminRoleAssignments).not.toHaveBeenCalled();
});

test('a per-user role failure does not abort the loop', async () => {
  configStore.getEffective.mockImplementation((k) =>
    (k === 'pingone_worker_client_id' ? 'worker-id' : null));
  pingOneUserService.ensureAdminRoleAssignments
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ assigned: ['Environment Admin'], failed: [] });
  const r = await ensureDemoPersonaRoles();
  expect(r.status).toBe('ok');
  // demoUser failed, the other two still processed
  expect(r.updated).toEqual(['demoAdmin', 'demoDelegate']);
});
