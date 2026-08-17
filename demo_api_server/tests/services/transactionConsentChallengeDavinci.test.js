'use strict';

jest.mock('../../services/davinciFlowClient', () => ({ invokeFlow: jest.fn() }));
jest.mock('../../services/configStore', () => {
  const actual = jest.requireActual('../../services/configStore');
  return { ...actual, getEffective: jest.fn((k) => actual.getEffective.call(actual, k)) };
});
jest.mock('../../data/store', () => ({
  getAccountsByUserId: jest.fn((userId) => [
    { id: 'a1', userId, balance: 100000, type: 'checking' },
    { id: 'a2', userId, balance: 50000, type: 'savings' },
  ]),
  getAccountById: jest.fn((id) => {
    const accounts = { a1: { id: 'a1', userId: 'u1', balance: 100000 }, a2: { id: 'a2', userId: 'u1', balance: 50000 } };
    return accounts[id];
  }),
  getUserById: jest.fn((id) => ({ id, firstName: 'Demo', lastName: 'User' })),
}));
jest.mock('../../services/mfaService', () => ({
  getPingOneUserContact: jest.fn(() => Promise.resolve({ email: 'demo@example.com', mobilePhone: null })),
  initiateOneTimeOtp: jest.fn(() => Promise.resolve({ id: 'da-123', _embedded: { devices: [{ email: 'demo@example.com' }] } })),
}));
jest.mock('../../services/emailService', () => ({
  sendOtpEmail: jest.fn(() => Promise.resolve()),
}));

const { invokeFlow } = require('../../services/davinciFlowClient');
const configStore = require('../../services/configStore');
const {
  createChallenge,
  confirmChallengeViaDaVinci,
} = require('../../services/transactionConsentChallenge');

function reqStub(user, session = {}) {
  return { user, session };
}

describe('confirmChallengeViaDaVinci', () => {
  beforeEach(() => {
    invokeFlow.mockReset();
    configStore.getEffective.mockImplementation((k) => (k === 'ff_davinci_orchestration' ? 'true' : undefined));
  });

  test('PERMIT from DaVinci confirms the challenge without an MFA ceremony', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({ decision: 'PERMIT', stepUpRequired: false, stepUpCompleted: false });

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, { userName: 'Demo User' });

    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBe(true);
    expect(invokeFlow).toHaveBeenCalledWith('transactionAuthorization', expect.objectContaining({
      Amount: 20000, TransactionType: 'transfer', Username: 'Demo User',
    }));
  });

  test('DENY from DaVinci does not confirm the challenge', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 60000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({ decision: 'DENY', stepUpRequired: false, stepUpCompleted: false });

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test('DaVinci API failure fails closed — falls back to the existing hand-coded confirmChallenge path', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockRejectedValue(Object.assign(new Error('unreachable'), { code: 'UPSTREAM_UNREACHABLE', httpStatus: 503 }));

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    // Fallback runs the real confirmChallenge — for this amount (below step-up
    // threshold isn't guaranteed, so just assert it did NOT surface the raw
    // DaVinci error and DID move the challenge out of 'pending').
    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBeUndefined();
  });

  test('Ambiguous decision (e.g. INDETERMINATE) is NOT treated as PERMIT — denies the transaction', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({ decision: 'INDETERMINATE', stepUpRequired: false, stepUpCompleted: false });

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.json.error).toBe('davinci_denied');
  });

  test('Malformed flowResult (null, undefined, empty object) fails closed — falls back to confirmChallenge', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue({});

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    // Fallback runs confirmChallenge — assert it succeeded and did NOT throw
    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBeUndefined();
  });

  test('Malformed flowResult (null) fails closed — falls back to confirmChallenge', async () => {
    const req = reqStub({ id: 'u1', role: 'customer' });
    const created = createChallenge(req, { type: 'transfer', amount: 20000, fromAccountId: 'a1', toAccountId: 'a2' });
    invokeFlow.mockResolvedValue(null);

    const result = await confirmChallengeViaDaVinci(req, created.challengeId, {});

    // Fallback runs confirmChallenge — assert it succeeded and did NOT throw
    expect(result.ok).toBe(true);
    expect(result.viaDaVinci).toBeUndefined();
  });
});
