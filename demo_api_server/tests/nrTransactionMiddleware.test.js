'use strict';

const mockSetTransactionName = jest.fn();
jest.mock('newrelic', () => ({
  setTransactionName: mockSetTransactionName,
}), { virtual: true });

const nrContext = require('../services/nrContext');
const { nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware');

beforeEach(() => {
  mockSetTransactionName.mockClear();
});

function makeReq(body = {}, query = {}, headers = {}) {
  return { body, query, headers };
}

function runMiddleware(req) {
  return new Promise((resolve, reject) => {
    nrTransactionMiddleware(req, {}, (err) => (err ? reject(err) : resolve()));
  });
}

describe('nrTransactionMiddleware', () => {
  test('sets transaction name for known useCaseId from body', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC14' }));
    expect(mockSetTransactionName).toHaveBeenCalledWith('/BankingDemo/UC14-AttackSim');
  });

  test('sets transaction name for UC1 from body', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC1' }));
    expect(mockSetTransactionName).toHaveBeenCalledWith('/BankingDemo/UC1-ChipLogin');
  });

  test('uses query param when body missing useCaseId', async () => {
    await runMiddleware(makeReq({}, { useCaseId: 'UC17' }));
    expect(mockSetTransactionName).toHaveBeenCalledWith('/BankingDemo/UC17-HITL');
  });

  test('uses x-use-case-id header as fallback', async () => {
    await runMiddleware(makeReq({}, {}, { 'x-use-case-id': 'UC2' }));
    expect(mockSetTransactionName).toHaveBeenCalledWith('/BankingDemo/UC2-SensitiveTransfer');
  });

  test('falls back to UC-<id> for unknown useCaseId', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC99' }));
    expect(mockSetTransactionName).toHaveBeenCalledWith('/BankingDemo/UC-UC99');
  });

  test('does not call setTransactionName when no useCaseId', async () => {
    await runMiddleware(makeReq());
    expect(mockSetTransactionName).not.toHaveBeenCalled();
  });

  test('calls next() even when newrelic throws', async () => {
    mockSetTransactionName.mockImplementationOnce(() => { throw new Error('agent gone'); });
    await expect(runMiddleware(makeReq({ useCaseId: 'UC14' }))).resolves.toBeUndefined();
  });

  test('getCorrelationId() is non-null inside the middleware run() scope', async () => {
    let captured = null;
    const req = makeReq({ useCaseId: 'UC14' });
    await new Promise((resolve) => {
      const next = () => {
        captured = nrContext.getCorrelationId();
        resolve();
      };
      nrTransactionMiddleware(req, {}, next);
    });
    expect(captured).not.toBeNull();
    expect(typeof captured).toBe('string');
  });
});
