'use strict';
/**
 * The safety property: with ff_autonomous_agents off, nothing schedules and
 * nothing runs. An agent that keeps acting after you switched it off is the
 * failure that matters for an unattended run.
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../services/fraudWatchJob', () => ({
  runFraudWatch: jest.fn(),
  AGENT: 'Super Banking Fraud Watch Agent',
}));
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => ({ append: jest.fn((r) => ({ ...r, runId: 'aur-test' })) }));

const configStore = require('../../services/configStore');
const { runFraudWatch } = require('../../services/fraudWatchJob');
const runStore = require('../../services/lmdb/autonomousRunStore.lmdb');
const scheduler = require('../../services/autonomousAgentScheduler');

const setFlag = (value) => configStore.getEffective.mockImplementation(
  (key) => (key === 'ff_autonomous_agents' ? value : undefined),
);

beforeEach(() => jest.clearAllMocks());

test('registers no scheduled task while the flag is off', () => {
  setFlag('false');
  expect(scheduler.startScheduler()).toBeNull();
});

test('runJobNow does nothing and stores nothing while the flag is off', async () => {
  setFlag('false');
  await expect(scheduler.runJobNow()).resolves.toBeNull();
  expect(runFraudWatch).not.toHaveBeenCalled();
  expect(runStore.append).not.toHaveBeenCalled();
});

// Absent is not enabled: a flag nobody has set must not start an agent.
test('treats an unset flag as off', async () => {
  setFlag(undefined);
  expect(scheduler.isEnabled()).toBe(false);
  await expect(scheduler.runJobNow()).resolves.toBeNull();
});

test('stores the run when enabled', async () => {
  setFlag('true');
  runFraudWatch.mockResolvedValue({
    status: 'completed',
    agent: 'Super Banking Fraud Watch Agent',
    findings: [{ transactionId: 't1' }],
    tokenEvents: [{ id: 'agent-actor-token', claims: { sub: 'agent' } }],
    scanned: 3,
    threshold: 1000,
  });

  const run = await scheduler.runJobNow({ trigger: 'manual' });

  expect(run.runId).toBe('aur-test');
  expect(runStore.append).toHaveBeenCalledWith(expect.objectContaining({
    job: 'fraud-watch',
    trigger: 'manual',
    status: 'completed',
  }));
});

// A job that throws must still leave a record: a scheduled run that vanishes
// is indistinguishable from one that never fired.
test('records a thrown job as a failed run', async () => {
  setFlag('true');
  runFraudWatch.mockRejectedValue(new Error('boom'));

  const run = await scheduler.runJobNow({ trigger: 'manual' });

  expect(run.status).toBe('failed');
  expect(run.error).toBe('boom');
  expect(runStore.append).toHaveBeenCalled();
});
