'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));

const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { emitHop } = require('../../services/transactionHop');
const { runWithCorrelation } = require('../../utils/correlationContext');

describe('emitHop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('resolves the correlation id from AsyncLocalStorage', () => {
    runWithCorrelation('c-als', () => {
      emitHop({ phase: 'ui.request' });
    });
    expect(ledger.appendHop).toHaveBeenCalledWith('c-als', expect.objectContaining({
      phase: 'ui.request',
      service: 'demo-api-server',
    }));
  });

  test('an explicit correlationId overrides the ALS value', () => {
    runWithCorrelation('c-als', () => {
      emitHop({ correlationId: 'c-explicit', phase: 'response' });
    });
    expect(ledger.appendHop).toHaveBeenCalledWith('c-explicit', expect.anything());
  });

  test('no-ops outside a correlation scope rather than inventing an id', () => {
    emitHop({ phase: 'ui.request' });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('a caller-supplied service is preserved', () => {
    runWithCorrelation('c1', () => emitHop({ phase: 'mcp.tool', service: 'other' }));
    expect(ledger.appendHop).toHaveBeenCalledWith('c1', expect.objectContaining({ service: 'other' }));
  });

  test('swallows a store failure — emission is fail-open', () => {
    ledger.appendHop.mockImplementation(() => { throw new Error('lmdb down'); });
    expect(() => runWithCorrelation('c1', () => emitHop({ phase: 'ui.request' }))).not.toThrow();
  });
});
