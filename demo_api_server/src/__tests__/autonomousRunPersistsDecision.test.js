'use strict';
/**
 * A stored run must carry the POLICY's verdict, not just prose about it.
 *
 * The whole claim of this feature is that PingOne Authorize decides whether an
 * unattended agent may move money — not the job's own arithmetic. `decision`
 * (verdict + statement code) is the only field that evidences that. Without it
 * the run still reads correctly, because `summary` carries the human sentence,
 * so the omission is invisible: a live parked run showed "Policy said" blank on
 * the page while everything else looked right.
 *
 * Mocks are required inside each test — setup.js resets modules per test.
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true'), setRaw: jest.fn(async () => {}) }));
jest.mock('../../services/fraudWatchJob', () => ({ runFraudWatch: jest.fn(), AGENT: 'Super Banking Fraud Watch Agent' }));
jest.mock('../../services/balanceSweepJob', () => ({ runBalanceSweep: jest.fn(), AGENT: 'Super Banking Balance Sweep Agent' }));
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => ({ append: jest.fn((r) => ({ ...r, runId: 'aur-1' })) }));
jest.mock('../../services/agentLifecycleEvents', () => ({ emit: jest.fn() }));
jest.mock('node-cron', () => ({ validate: () => true, schedule: jest.fn(() => ({ stop: jest.fn() })) }));

function load() {
  return {
    sweep: require('../../services/balanceSweepJob'),
    store: require('../../services/lmdb/autonomousRunStore.lmdb'),
    scheduler: require('../../services/autonomousAgentScheduler'),
  };
}

const PARKED_RESULT = {
  status: 'parked',
  agent: 'Super Banking Balance Sweep Agent',
  tokenEvents: [],
  findings: [],
  proposal: { fromAccountId: 'chk-1', amount: 1000, fromName: 'Checking' },
  mandate: { maxAmount: 500, window: 'day', source: 'topology' },
  pending: { authReqId: 'sim-1', initiatedAt: Date.now(), expiresIn: 300, loginHint: 'u1' },
  decision: { decision: 'PERMIT', reason: 'CIBA_APPROVAL', code: 'ciba-approval-required' },
  summary: 'over the standing mandate',
};

test('a parked run persists the policy verdict and its statement code', async () => {
  const { sweep, store, scheduler } = load();
  sweep.runBalanceSweep.mockResolvedValue(PARKED_RESULT);

  await scheduler.runJobNow({ job: 'balance-sweep', trigger: 'manual' });

  expect(store.append).toHaveBeenCalledWith(expect.objectContaining({
    decision: { decision: 'PERMIT', reason: 'CIBA_APPROVAL', code: 'ciba-approval-required' },
  }));
});

test('a denied run persists its verdict too', async () => {
  const { sweep, store, scheduler } = load();
  sweep.runBalanceSweep.mockResolvedValue({
    ...PARKED_RESULT,
    status: 'denied',
    pending: undefined,
    decision: { decision: 'DENY', reason: 'amount_exceeds_ceiling', code: 'transaction-denied' },
  });

  await scheduler.runJobNow({ job: 'balance-sweep', trigger: 'manual' });

  expect(store.append).toHaveBeenCalledWith(expect.objectContaining({
    decision: expect.objectContaining({ decision: 'DENY', code: 'transaction-denied' }),
  }));
});

// A job with no policy call (fraud-watch reads only) must not gain an empty key.
test('a run with no policy decision stores no decision field', async () => {
  const { store, scheduler } = load();
  const fraud = require('../../services/fraudWatchJob');
  fraud.runFraudWatch.mockResolvedValue({
    status: 'completed', agent: 'Super Banking Fraud Watch Agent',
    findings: [], tokenEvents: [], scanned: 3,
  });

  await scheduler.runJobNow({ job: 'fraud-watch', trigger: 'manual' });

  expect(store.append).toHaveBeenCalledWith(expect.not.objectContaining({ decision: expect.anything() }));
});
