'use strict';
/**
 * The public flag endpoint. Two properties matter:
 *  1. It is reachable while the feature is OFF — otherwise the only way to turn
 *     autonomous agents on would be behind a gate that refuses while they are off.
 *  2. It writes ff_autonomous_agents and nothing else. The route is public by
 *     explicit decision; a public write to arbitrary flags is not on offer.
 *
 * NOTE ON MOCK HANDLES: src/__tests__/setup.js calls jest.resetModules() in an
 * afterEach, so from the second test onward `require` hands back a FRESH module
 * registry. A module-scope `const configStore = require(...)` would keep
 * pointing at the first instance while the router under test talks to a new
 * one, and every assertion on it would read zero calls while the route works
 * perfectly. Everything is therefore required inside each test, together.
 */

jest.mock('../../services/configStore', () => ({ setRaw: jest.fn(async () => {}), getEffective: jest.fn() }));
// markArmed/disarm are called by the route: turning the flag on starts the
// one-hour arming clock, turning it off clears it.
jest.mock('../../services/autonomousAgentScheduler', () => ({
  isEnabled: jest.fn(),
  runJobNow: jest.fn(),
  markArmed: jest.fn(async () => {}),
  disarm: jest.fn(async () => {}),
  ARM_TTL_MS: 3600000,
}));
jest.mock('../../services/lmdb/autonomousRunStore.lmdb', () => ({ list: jest.fn(() => []), get: jest.fn(() => null) }));

const express = require('express');
const request = require('supertest');

/** Build the app and hand back the mock handles the router is actually bound to. */
function harness() {
  const configStore = require('../../services/configStore');
  const scheduler = require('../../services/autonomousAgentScheduler');
  const app = express();
  app.use(express.json());
  app.use('/api/autonomous-runs', require('../../routes/autonomousRuns'));
  return { app, configStore, scheduler };
}

test('the flag can be read while the feature is off', async () => {
  const { app, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(false);

  const res = await request(app).get('/api/autonomous-runs/flag');

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ flag: 'ff_autonomous_agents', enabled: false });
});

// The ordering guarantee: /flag sits in front of the feature gate, so turning
// the feature ON is possible from a page that is looking at it while OFF.
test('the flag can be turned on while the feature is off', async () => {
  const { app, configStore, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(false);

  const res = await request(app).post('/api/autonomous-runs/flag').send({ enabled: true });

  expect(res.status).toBe(200);
  expect(configStore.setRaw).toHaveBeenCalledWith({ ff_autonomous_agents: 'true' });
  // Switching it on must start the clock, or it stays armed indefinitely.
  expect(scheduler.markArmed).toHaveBeenCalled();
  expect(res.body.armExpiresInMs).toBe(3600000);
});

test('switching it off disarms rather than only clearing the flag', async () => {
  const { app, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(false);

  await request(app).post('/api/autonomous-runs/flag').send({ enabled: false });

  expect(scheduler.disarm).toHaveBeenCalled();
});

test('writes only ff_autonomous_agents, whatever else is sent', async () => {
  const { app, configStore, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(true);

  await request(app)
    .post('/api/autonomous-runs/flag')
    .send({ enabled: false, ff_hitl_enabled: false, ff_authorize_real: false });

  expect(configStore.setRaw).toHaveBeenCalledTimes(1);
  expect(Object.keys(configStore.setRaw.mock.calls[0][0])).toEqual(['ff_autonomous_agents']);
});

test('rejects a non-boolean without writing anything', async () => {
  const { app, configStore, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(false);

  const res = await request(app).post('/api/autonomous-runs/flag').send({ enabled: 'yes' });

  expect(res.status).toBe(400);
  expect(configStore.setRaw).not.toHaveBeenCalled();
});

// The rest of the router stays gated: reading runs while off reports the
// feature state rather than an empty list that reads as "ran, found nothing".
test('the runs list still reports feature_disabled while off', async () => {
  const { app, scheduler } = harness();
  scheduler.isEnabled.mockReturnValue(false);

  const res = await request(app).get('/api/autonomous-runs');

  expect(res.status).toBe(403);
  expect(res.body.error).toBe('feature_disabled');
});
