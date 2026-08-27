'use strict';
/**
 * Regression (finding #40): a receipt whose bearer-token retry never
 * happened (abandoned retry, amount mismatch, or the transfer going through
 * the session-based hitlCredit.js path instead) was only ever cleaned up
 * reactively inside consume() -- never proactively -- so it sat in the
 * receipts Map for the life of the process.
 */
describe('cibaTransactionReceipt periodic sweep', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('evicts an expired, never-consumed receipt via its own sweep interval', () => {
    const svc = require('../../services/cibaTransactionReceipt');

    svc.record('user-1', 'create_transfer', 100);
    expect(svc._receiptCountForTests()).toBe(1);

    // Idle past the 5-minute TTL with no consume() call at all.
    jest.advanceTimersByTime(6 * 60 * 1000);

    expect(svc._receiptCountForTests()).toBe(0);
  });

  it('still consumes a fresh receipt normally', () => {
    const svc = require('../../services/cibaTransactionReceipt');

    svc.record('user-1', 'create_transfer', 100);
    expect(svc.consume('user-1', 'create_transfer', 100)).toBe(true);
    expect(svc._receiptCountForTests()).toBe(0);
  });
});
