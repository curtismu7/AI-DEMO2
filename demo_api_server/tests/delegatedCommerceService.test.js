'use strict';

jest.mock('../services/configStore', () => ({}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/pingOneClientService', () => ({
  deleteApplication: jest.fn(),
}));
jest.mock('../services/scopeTopology', () => ({}));
jest.mock('../services/lmdb/delegatedCommerceStore.lmdb', () => ({
  get: jest.fn(),
  remove: jest.fn(),
}));
jest.mock('../services/delegatedCommerceRuntime', () => ({
  removeCredentials: jest.fn(),
}));
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({
  findActiveByActorAndGrantor: jest.fn(),
}));
jest.mock('../services/delegationService', () => ({
  revokeDelegation: jest.fn(),
}));
jest.mock('../services/pingOneUserService', () => ({
  initialize: jest.fn(),
  setMayActAttribute: jest.fn(),
  clearMayActIfMatches: jest.fn(),
}));

const delegatedCommerceService = require('../services/delegatedCommerceService');
const store = require('../services/lmdb/delegatedCommerceStore.lmdb');
const pingOneClientService = require('../services/pingOneClientService');
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const delegationService = require('../services/delegationService');
const pingOneUserService = require('../services/pingOneUserService');

beforeEach(() => {
  jest.clearAllMocks();
  pingOneUserService.clearMayActIfMatches.mockResolvedValue(true);
});

it('clears customer authorization before deleting a claimed demo application', async () => {
  store.get.mockReturnValue({
    id: 'reg-1',
    applicationId: 'agent-new',
    marker: 'A&F delegated-commerce demo',
    creatorUserId: 'admin-1',
    claimedByUserId: 'user-1',
  });
  delegationStore.findActiveByActorAndGrantor
    .mockReturnValueOnce({ id: 'delegation-1' })
    .mockReturnValueOnce(null);

  await delegatedCommerceService.cleanup('reg-1', 'admin-1');

  expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('user-1', 'agent-new');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalledWith('user-1', null);
  expect(delegationService.revokeDelegation).toHaveBeenCalledWith('delegation-1', 'user-1');
  expect(pingOneClientService.deleteApplication).toHaveBeenCalledWith('agent-new');
  expect(store.remove).toHaveBeenCalledWith('reg-1');
});

it('does not wipe mayAct when cleanup targets an older registration than the current agent', async () => {
  store.get.mockReturnValue({
    id: 'reg-old',
    applicationId: 'agent-old',
    marker: 'A&F delegated-commerce demo',
    creatorUserId: 'admin-1',
    claimedByUserId: 'user-1',
  });
  pingOneUserService.clearMayActIfMatches.mockResolvedValue(false);
  delegationStore.findActiveByActorAndGrantor.mockReturnValue(null);

  await delegatedCommerceService.cleanup('reg-old', 'admin-1');

  expect(pingOneUserService.clearMayActIfMatches).toHaveBeenCalledWith('user-1', 'agent-old');
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
  expect(pingOneClientService.deleteApplication).toHaveBeenCalledWith('agent-old');
});
