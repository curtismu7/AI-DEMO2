'use strict';

jest.mock('axios');
jest.mock('../../config/davinci', () => ({
  apiClientId: 'client-id', apiClientSecret: 'client-secret',
  transaction: { companyId: 'co-1', appId: 'app-1', flowId: 'flow-1' },
}));

const axios = require('axios');
const { invokeFlow } = require('../../services/davinciFlowClient');

describe('davinciFlowClient.invokeFlow', () => {
  beforeEach(() => axios.post.mockReset());

  test('PERMIT: posts to the flow start endpoint and returns the parsed decision', async () => {
    axios.post.mockResolvedValue({
      data: { decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 50, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result).toEqual({ decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false });
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/company/co-1/applications/app-1/flows/flow-1/start'),
      { Amount: 50, TransactionType: 'transfer', Username: 'demoUser' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }) }),
    );
  });

  test('STEP_UP: returns stepUpRequired true from the flow response', async () => {
    axios.post.mockResolvedValue({
      data: { decision: 'STEP_UP', stepUpRequired: true, stepUpCompleted: true },
    });

    const result = await invokeFlow('transactionAuthorization', {
      Amount: 15000, TransactionType: 'transfer', Username: 'demoUser',
    });

    expect(result.stepUpRequired).toBe(true);
  });

  test('unknown flowKey throws synchronously without calling axios', async () => {
    await expect(invokeFlow('notAFlow', {})).rejects.toThrow(/unknown flow/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('axios failure is normalized, never leaks raw error', async () => {
    const raw = new Error('connect ECONNREFUSED');
    raw.code = 'ECONNREFUSED';
    axios.post.mockRejectedValue(raw);

    await expect(invokeFlow('transactionAuthorization', { Amount: 1, TransactionType: 'transfer', Username: 'u' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_UNREACHABLE', httpStatus: 503 });
  });
});
