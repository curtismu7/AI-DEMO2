'use strict';

// NOT { virtual: true } — see tests/nrSegments.test.js for why. newrelic is a
// real dependency; the virtual flag makes the mock miss requires that
// originate inside middleware/nrTransactionMiddleware.js.
jest.mock('newrelic', () => ({
  setTransactionName: jest.fn(),
}));

let newrelic;
let nrContext;
let nrTransactionMiddleware;

beforeEach(() => {
  jest.resetModules();
  jest.mock('newrelic', () => ({ setTransactionName: jest.fn() }));
  newrelic = require('newrelic');
  nrContext = require('../services/nrContext');
  ({ nrTransactionMiddleware } = require('../middleware/nrTransactionMiddleware'));
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
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC14-AttackSim');
  });

  test('sets transaction name for UC1 from body', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC1' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC1-ChipLogin');
  });

  test('uses query param when body missing useCaseId', async () => {
    await runMiddleware(makeReq({}, { useCaseId: 'UC17' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC17-HITL');
  });

  test('uses x-use-case-id header as fallback', async () => {
    await runMiddleware(makeReq({}, {}, { 'x-use-case-id': 'UC2' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC2-SensitiveTransfer');
  });

  test('falls back to UC-<id> for unknown useCaseId', async () => {
    await runMiddleware(makeReq({ useCaseId: 'UC99' }));
    expect(newrelic.setTransactionName).toHaveBeenCalledWith('/BankingDemo/UC-UC99');
  });

  test('does not call setTransactionName when no useCaseId', async () => {
    await runMiddleware(makeReq());
    expect(newrelic.setTransactionName).not.toHaveBeenCalled();
  });

  test('calls next() even when newrelic throws', async () => {
    newrelic.setTransactionName.mockImplementationOnce(() => { throw new Error('agent gone'); });
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
