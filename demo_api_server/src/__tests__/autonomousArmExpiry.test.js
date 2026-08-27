'use strict';
/**
 * The dead-man switch. Autonomous agents are the one thing here that acts with
 * nobody watching, so the feature expires an hour after it is armed rather than
 * waiting for somebody to remember to switch it off.
 *
 * Mocks are required inside each test: setup.js resets modules per test.
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
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => ({ append: jest.fn((r) => r) }));
jest.mock('../../services/agentLifecycleEvents', () => ({ emit: jest.fn() }));
jest.mock('node-cron', () => ({ validate: () => true, schedule: jest.fn(() => ({ stop: jest.fn() })) }));

const HOUR = 60 * 60 * 1000;

function load(config = {}) {
  const configStore = require('../../services/configStore');
  Object.keys(configStore.__store).forEach((k) => delete configStore.__store[k]);
  Object.assign(configStore.__store, config);
  return { configStore, scheduler: require('../../services/autonomousAgentScheduler') };
}

test('armed within the window, the feature is on', () => {
  const { scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - 5 * 60 * 1000),
  });
  expect(scheduler.isEnabled()).toBe(true);
});

// The enforcement point. Even with the flag still reading true and the sweep
// never having run, an expired arm cannot start a job.
test('past the window it is off even though the flag still says true', async () => {
  const { configStore, scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - HOUR - 1000),
  });

  expect(configStore.__store.ff_autonomous_agents).toBe('true');
  expect(scheduler.isEnabled()).toBe(false);
  await expect(scheduler.runJobNow({ job: 'fraud-watch' })).resolves.toBeNull();
});

test('an expired arm registers no schedules on start', () => {
  const { scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - HOUR - 1000),
  });
  expect(scheduler.startScheduler()).toBeNull();
});

test('the sweep switches the flag off once the window elapses', async () => {
  const { configStore, scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - HOUR - 1000),
  });

  const timer = scheduler.startArmSweep({ intervalMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  clearInterval(timer);

  expect(configStore.__store.ff_autonomous_agents).toBe('false');
  expect(configStore.__store.AUTONOMOUS_AGENTS_ARMED_AT).toBe('');
});

// The admin flags UI knows nothing about arming, so a flag flipped there would
// otherwise be armed forever. The sweep starts the clock instead.
test('a flag switched on elsewhere gets a clock rather than running forever', async () => {
  const { configStore, scheduler } = load({ ff_autonomous_agents: 'true' });
  expect(configStore.__store.AUTONOMOUS_AGENTS_ARMED_AT).toBeUndefined();

  const timer = scheduler.startArmSweep({ intervalMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  clearInterval(timer);

  expect(Number(configStore.__store.AUTONOMOUS_AGENTS_ARMED_AT)).toBeGreaterThan(0);
  expect(configStore.__store.ff_autonomous_agents).toBe('true');
});

// Disarming is not revoking: re-arming must bring the jobs back without anyone
// having to un-revoke them first.
test('expiry does not revoke the agents', async () => {
  const { scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - HOUR - 1000),
  });

  const timer = scheduler.startArmSweep({ intervalMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  clearInterval(timer);

  expect(scheduler.isAgentStopped('Super Banking Fraud Watch Agent')).toBe(false);
});

test('re-arming after expiry brings the schedules back', async () => {
  const { configStore, scheduler } = load({
    ff_autonomous_agents: 'true',
    AUTONOMOUS_AGENTS_ARMED_AT: String(Date.now() - HOUR - 1000),
  });
  expect(scheduler.startScheduler()).toBeNull();

  configStore.__store.ff_autonomous_agents = 'true';
  await scheduler.markArmed();

  expect(scheduler.isEnabled()).toBe(true);
  expect(scheduler.startScheduler()).toHaveLength(2);
});
