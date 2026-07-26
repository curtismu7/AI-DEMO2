// demo_api_server/tests/checks/residentRecover.test.js
'use strict';

const { recoverDeadResidents } = require('../../../demo_llm_proxy/residentRecover');

describe('recoverDeadResidents', () => {
  test('no-op when all residents healthy', async () => {
    const ensureFn = jest.fn();
    const r = await recoverDeadResidents({
      residentCsv: '8091,8096',
      ensureFn,
      probeFn: async () => true,
    });
    expect(r.recovered).toBe(false);
    expect(ensureFn).not.toHaveBeenCalled();
  });

  test('calls ensure once when a resident is down', async () => {
    const ensureFn = jest.fn().mockResolvedValue('ok');
    const r = await recoverDeadResidents({
      residentCsv: '8091,8096',
      ensureFn,
      probeFn: async (port) => String(port) !== '8091',
    });
    expect(r.recovered).toBe(true);
    expect(r.dead).toEqual(['8091']);
    expect(ensureFn).toHaveBeenCalledTimes(1);
    expect(ensureFn).toHaveBeenCalledWith('8091');
  });

  test('skips while busy', async () => {
    const ensureFn = jest.fn();
    const r = await recoverDeadResidents({
      residentCsv: '8091,8096',
      ensureFn,
      probeFn: async () => false,
      isBusy: () => true,
    });
    expect(r.recovered).toBe(false);
    expect(ensureFn).not.toHaveBeenCalled();
  });
});
