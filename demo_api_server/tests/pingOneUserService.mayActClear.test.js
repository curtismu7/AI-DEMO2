'use strict';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  LOG_CATEGORIES: { USER_MANAGEMENT: 'USER_MANAGEMENT' },
}));

const pingOneUserService = require('../services/pingOneUserService');

beforeEach(() => {
  jest.restoreAllMocks();
});

it('clearMayActIfMatches clears only when mayAct.sub matches the agent', async () => {
  jest.spyOn(pingOneUserService, 'getMayActAttribute').mockResolvedValue({ sub: 'agent-a' });
  jest.spyOn(pingOneUserService, 'setMayActAttribute').mockResolvedValue(undefined);

  await expect(pingOneUserService.clearMayActIfMatches('user-1', 'agent-a')).resolves.toBe(true);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-1', null);
});

it('clearMayActIfMatches leaves mayAct alone when it names a different agent', async () => {
  jest.spyOn(pingOneUserService, 'getMayActAttribute').mockResolvedValue({ sub: 'agent-b' });
  jest.spyOn(pingOneUserService, 'setMayActAttribute').mockResolvedValue(undefined);

  await expect(pingOneUserService.clearMayActIfMatches('user-1', 'agent-a')).resolves.toBe(false);
  expect(pingOneUserService.setMayActAttribute).not.toHaveBeenCalled();
});
