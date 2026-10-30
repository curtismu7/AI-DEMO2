'use strict';
/**
 * Login re-align: a user whose accounts belong to another vertical is switched
 * with a snapshot, never wiped.
 *
 * reseedIfVerticalMismatch runs on every login. It used to delete the user's
 * accounts and transactions and seed fresh ones whenever they did not match
 * the BFF's global vertical, so a presenter's built-up demo state (and a
 * readiness lane's banking accounts) were destroyed by the next sign-in under
 * a different global vertical. It now goes through switchUserVertical, as the
 * agent and /api/accounts/my do, so switching back restores the data.
 */

jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn(),
  accounts: new Map(),
  transactions: new Map(),
  persistAllData: jest.fn(),
  seedAccountsForUser: jest.fn(async () => ({ vertical: 'workforce' })),
}));
jest.mock('../../services/demoScenarioStore', () => ({ load: jest.fn(async () => ({})), save: jest.fn(async () => {}) }));
jest.mock('../../services/verticalAccountSnapshots', () => ({
  getCurrentVertical: jest.fn(async () => null),
  switchUserVertical: jest.fn(async () => ({ action: 'seeded' })),
}));

const dataStore = require('../../data/store');
const configStore = require('../../services/configStore');
const { verticalManifest } = require('../../services/verticalManifest');
const verticalAccountSnapshots = require('../../services/verticalAccountSnapshots');
const { reseedIfVerticalMismatch } = require('../../routes/oauthUser');

const PRIMARY = { banking: 'checking', workforce: 'PTO Balance', healthcare: 'policy' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(configStore, 'getEffective').mockImplementation((key) => (key === 'active_vertical' ? 'workforce' : undefined));
  jest.spyOn(verticalManifest.loader, 'get').mockImplementation((id) => (PRIMARY[id] ? { manifest: { terminology: { accountTypes: [PRIMARY[id]] } } } : null));
  jest.spyOn(verticalManifest.loader, 'list').mockImplementation(() => Object.keys(PRIMARY).map((id) => ({ id })));
});

test('a banking user signing in under workforce is switched with a snapshot, not wiped', async () => {
  dataStore.getAccountsByUserId.mockReturnValue([{ id: 'a1', userId: 'u1', accountType: 'checking', balance: 4700 }]);
  await reseedIfVerticalMismatch('u1', 'Pat', 'Doe');
  expect(verticalAccountSnapshots.switchUserVertical).toHaveBeenCalledWith('u1', 'workforce', { fromVertical: 'banking' });
  expect(dataStore.persistAllData).not.toHaveBeenCalled();
  expect(dataStore.seedAccountsForUser).not.toHaveBeenCalled();
});

test('the outgoing vertical comes from the accounts, even when the record says otherwise', async () => {
  verticalAccountSnapshots.getCurrentVertical.mockResolvedValue('workforce');
  dataStore.getAccountsByUserId.mockReturnValue([{ id: 'a1', userId: 'u1', accountType: 'CHECKING' }]);
  await reseedIfVerticalMismatch('u1', 'Pat', 'Doe');
  expect(verticalAccountSnapshots.switchUserVertical).toHaveBeenCalledWith('u1', 'workforce', { fromVertical: 'banking' });
});

test('an unrecognised account type falls back to the recorded vertical', async () => {
  verticalAccountSnapshots.getCurrentVertical.mockResolvedValue('retail');
  dataStore.getAccountsByUserId.mockReturnValue([{ id: 'a1', userId: 'u1', accountType: 'gift_card' }]);
  await reseedIfVerticalMismatch('u1', 'Pat', 'Doe');
  expect(verticalAccountSnapshots.switchUserVertical).toHaveBeenCalledWith('u1', 'workforce', { fromVertical: 'retail' });
});

test('matching accounts are left alone, and a user with none is seeded as before', async () => {
  dataStore.getAccountsByUserId.mockReturnValue([{ id: 'a1', userId: 'u1', accountType: 'pto balance' }]);
  await reseedIfVerticalMismatch('u1', 'Pat', 'Doe');
  expect(verticalAccountSnapshots.switchUserVertical).not.toHaveBeenCalled();

  dataStore.getAccountsByUserId.mockReturnValue([]);
  await reseedIfVerticalMismatch('u2', 'Sam', 'Lee');
  expect(dataStore.seedAccountsForUser).toHaveBeenCalledWith('u2');
  expect(verticalAccountSnapshots.switchUserVertical).not.toHaveBeenCalled();
});
