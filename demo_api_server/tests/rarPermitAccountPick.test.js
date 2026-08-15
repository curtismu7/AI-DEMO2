'use strict';
const { __test } = require('../services/attackSimulatorService');
const { pickTransferAccounts } = __test;

/**
 * UC14b's PERMIT path executes a real transfer once the gateway and PingOne
 * Authorize permit it, so the source account has to be able to cover the amount.
 * Taking accounts[0] picked a loan (-12000) and the run ended in
 * 502 backend_execution_failed "Insufficient balance" after a clean PERMIT.
 */
describe('pickTransferAccounts', () => {
  test('funds the transfer from an account that covers the amount, not merely the first', () => {
    const accounts = [
      { id: 'loan-1', balance: -12000 },
      { id: 'cc-1', balance: -1850 },
      { id: 'chk-1', balance: 500 },
    ];
    expect(pickTransferAccounts(accounts, 80)).toEqual({ from: 'chk-1', to: 'loan-1' });
  });

  test('the target is never the source', () => {
    const { from, to } = pickTransferAccounts([{ id: 'chk-1', balance: 500 }, { id: 'sav-1', balance: 20 }], 80);
    expect(from).toBe('chk-1');
    expect(to).toBe('sav-1');
  });

  test('falls back to the first account when none can cover it, so the shortfall still surfaces', () => {
    const accounts = [{ id: 'loan-1', balance: -12000 }, { id: 'cc-1', balance: -1850 }];
    expect(pickTransferAccounts(accounts, 80)).toEqual({ from: 'loan-1', to: 'cc-1' });
  });

  test('a balance exactly equal to the amount counts as covering it', () => {
    expect(pickTransferAccounts([{ id: 'a', balance: -5 }, { id: 'b', balance: 80 }], 80).from).toBe('b');
  });

  test('no usable accounts leaves the caller on its sim ids', () => {
    expect(pickTransferAccounts([], 80)).toEqual({ from: null, to: null });
    expect(pickTransferAccounts(null, 80)).toEqual({ from: null, to: null });
    expect(pickTransferAccounts([{ balance: 900 }], 80)).toEqual({ from: null, to: null });
  });

  test('a single account has no distinct target', () => {
    expect(pickTransferAccounts([{ id: 'chk-1', balance: 900 }], 80)).toEqual({ from: 'chk-1', to: null });
  });
});
