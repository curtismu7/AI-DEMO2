/**
 * pingOneUserService.mayAct.test.js
 * Pins the proven flat top-level shape for mayAct (NOT JSON-Patch /custom/mayAct).
 */
'use strict';

const svc = require('../../services/pingOneUserService'); // singleton instance

describe('pingOneUserService mayAct shape', () => {
  afterEach(() => jest.restoreAllMocks());

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
