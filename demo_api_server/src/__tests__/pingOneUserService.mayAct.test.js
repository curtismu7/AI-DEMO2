/**
 * pingOneUserService.mayAct.test.js
 * Pins the proven flat top-level shape for mayAct (NOT JSON-Patch /custom/mayAct).
 */
'use strict';

const svc = require('../../services/pingOneUserService'); // singleton instance
const configStore = require('../../services/configStore');

describe('pingOneUserService mayAct shape', () => {
  beforeEach(() => jest.spyOn(configStore, 'getEffective').mockImplementation((k) => (k === 'ff_may_act_seed' ? 'true' : undefined)));
  afterEach(() => jest.restoreAllMocks());

  test('setMayActAttribute is a no-op while ff_may_act_seed is OFF', async () => {
    configStore.getEffective.mockReturnValue('false');
    const spy = jest.spyOn(svc, 'makeRequest').mockResolvedValue({});
    await svc.setMayActAttribute('user-9', { sub: 'agent-uuid' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('setMayActAttribute PATCHes a flat top-level { mayAct } body', async () => {
    const spy = jest.spyOn(svc, 'makeRequest').mockResolvedValue({});
    await svc.setMayActAttribute('user-9', { sub: 'agent-uuid' });
    expect(spy).toHaveBeenCalledWith('PATCH', '/users/user-9', { mayAct: { sub: 'agent-uuid' } });
  });

  test('setMayActAttribute(userId, null) clears via flat { mayAct: null }', async () => {
    const spy = jest.spyOn(svc, 'makeRequest').mockResolvedValue({});
    await svc.setMayActAttribute('user-9', null);
    expect(spy).toHaveBeenCalledWith('PATCH', '/users/user-9', { mayAct: null });
  });

});

describe('pingOneUserService delegatedTo shape', () => {
  afterEach(() => jest.restoreAllMocks());

  test('setDelegatedToAttribute PATCHes a flat top-level { delegatedTo: [subs] } body', async () => {
    const spy = jest.spyOn(svc, 'makeRequest').mockResolvedValue({});
    await svc.setDelegatedToAttribute('user-9', ['del-1', 'del-2']);
    expect(spy).toHaveBeenCalledWith('PATCH', '/users/user-9', { delegatedTo: ['del-1', 'del-2'] });
  });

  test('setDelegatedToAttribute clears to null when the list is empty', async () => {
    const spy = jest.spyOn(svc, 'makeRequest').mockResolvedValue({});
    await svc.setDelegatedToAttribute('user-9', []);
    expect(spy).toHaveBeenCalledWith('PATCH', '/users/user-9', { delegatedTo: null });
  });
});
