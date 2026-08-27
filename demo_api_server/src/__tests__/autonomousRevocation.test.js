'use strict';
/**
 * Phase 4 containment. An autonomous agent makes its own requests, so "stop
 * this agent" has to cancel the SCHEDULE — denying its next tool call leaves
 * the cron firing, the agent waking up and authenticating, and only the call
 * refused. That is not stopped.
 *
 * Mocks are required inside each test: setup.js resets modules per test, so a
 * module-scope handle would go stale from test 2 on (see autonomousRunsFlag).
 */

jest.mock('../../services/configStore', () => {
  const store = {};
  return {
    __store: store,
    getEffective: jest.fn((k) => store[k]),
    setRaw: jest.fn(async (map) => { Object.assign(store, map); }),
  };
});
jest.mock('../../services/fraudWatchJob', () => ({ runFraudWatch: jest.fn(), AGENT: 'Super Banking Fraud Watch Agent' }));
jest.mock('../../services/balanceSweepJob', () => ({ runBalanceSweep: jest.fn(), AGENT: 'Super Banking Balance Sweep Agent' }));
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => ({ append: jest.fn((r) => ({ ...r, runId: 'aur-1' })) }));
jest.mock('../../services/agentLifecycleEvents', () => ({ emit: jest.fn() }));
jest.mock('node-cron', () => ({
  validate: jest.fn(() => true),
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

function load({ enabled = 'true' } = {}) {
  const configStore = require('../../services/configStore');
  Object.keys(configStore.__store).forEach((k) => delete configStore.__store[k]);
  configStore.__store.ff_autonomous_agents = enabled;
  return {
    configStore,
    cron: require('node-cron'),
    lifecycle: require('../../services/agentLifecycleEvents'),
    fraud: require('../../services/fraudWatchJob'),
    scheduler: require('../../services/autonomousAgentScheduler'),
  };
}

test('killing an agent cancels its live cron handle', async () => {
  const { scheduler, cron } = load();
  scheduler.startScheduler();
  const handles = cron.schedule.mock.results.map((r) => r.value);
  expect(handles).toHaveLength(2);

  const res = await scheduler.stopSchedules();

  expect(res.stopped.sort()).toEqual(['balance-sweep', 'fraud-watch']);
  handles.forEach((h) => expect(h.stop).toHaveBeenCalled());
});

// The property that makes it containment rather than a pause: a restart must
// not quietly re-arm an agent somebody killed.
test('a revoked agent is not re-registered on the next start', async () => {
  const { scheduler, cron } = load();
  await scheduler.stopSchedules({ agent: 'Super Banking Balance Sweep Agent' });
  cron.schedule.mockClear();

  scheduler.startScheduler();

  // fraud-watch still registers; balance-sweep does not.
  expect(cron.schedule).toHaveBeenCalledTimes(1);
  expect(scheduler.isAgentStopped('Super Banking Balance Sweep Agent')).toBe(true);
  expect(scheduler.isAgentStopped('Super Banking Fraud Watch Agent')).toBe(false);
});

// Belt and braces: the manual "Run now" path calls runJobNow directly, and a
// tick may already be in flight when the cancel lands.
test('a revoked agent does not run even when fired directly', async () => {
  const { scheduler, fraud } = load();
  await scheduler.stopSchedules({ agent: 'Super Banking Fraud Watch Agent' });

  const run = await scheduler.runJobNow({ job: 'fraud-watch', trigger: 'manual' });

  expect(run).toBeNull();
  expect(fraud.runFraudWatch).not.toHaveBeenCalled();
});

test('cancelling emits a leaver event per agent for the control-plane feed', async () => {
  const { scheduler, lifecycle } = load();
  await scheduler.stopSchedules({ agent: 'Super Banking Balance Sweep Agent' });

  expect(lifecycle.emit).toHaveBeenCalledTimes(1);
  expect(lifecycle.emit).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'leaver',
    agentId: 'Super Banking Balance Sweep Agent',
    reason: 'schedule-cancelled',
  }));
});

test('the revocation is persisted, not held in memory', async () => {
  const { scheduler, configStore } = load();
  await scheduler.stopSchedules({ agent: 'Super Banking Fraud Watch Agent' });

  expect(configStore.setRaw).toHaveBeenCalledWith(
    expect.objectContaining({ [scheduler.REVOKED_KEY]: 'Super Banking Fraud Watch Agent' }),
  );
});

// The kill switch auto-resets after 10 minutes so a demo can be repeated;
// schedules have to come back on that same path or the agent stays dead.
test('resuming lifts the revocation and re-registers on the next start', async () => {
  const { scheduler, cron } = load();
  await scheduler.stopSchedules();
  expect(scheduler.isAgentStopped('Super Banking Fraud Watch Agent')).toBe(true);

  await scheduler.resumeSchedules();
  cron.schedule.mockClear();
  scheduler.startScheduler();

  expect(scheduler.isAgentStopped('Super Banking Fraud Watch Agent')).toBe(false);
  expect(cron.schedule).toHaveBeenCalledTimes(2);
});
