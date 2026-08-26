'use strict';
/**
 * Phase 3's core claim: an autonomous agent may act alone up to its standing
 * mandate, and must ask a human beyond it. Nothing here reaches PingOne.
 *
 * See autonomousRunsFlag.test.js for why the mocks are required inside each
 * test rather than at module scope (setup.js resets modules per test).
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const ACCOUNTS = [
  { id: 'chk-1', userId: 'u1', accountType: 'checking', name: 'Everyday Checking', balance: 2400 },
  { id: 'sav-1', userId: 'u1', accountType: 'savings', name: 'Savings', balance: 9000 },
];
const okToken = { access_token: 'x', claims: { sub: 'agent:balance-sweep' } };

function load() {
  const configStore = require('../../services/configStore');
  const { runBalanceSweep, AGENT } = require('../../services/balanceSweepJob');
  const mandate = require('../../services/agentMandate');
  return { configStore, runBalanceSweep, AGENT, mandate };
}

/** configStore with only the given keys set; everything else undefined. */
function withConfig(configStore, map = {}) {
  configStore.getEffective.mockImplementation((k) => map[k]);
}

const deps = (over = {}) => ({
  getToken: async () => okToken,
  readAccounts: () => ACCOUNTS,
  initiateCiba: () => ({ auth_req_id: 'sim-abc', expires_in: 300, interval: 5 }),
  ...over,
});

test('a sweep within the mandate completes without asking anyone', async () => {
  const { configStore, runBalanceSweep } = load();
  // floor 2000 → surplus 400, under the declared 500 ceiling
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '2000' });

  const run = await runBalanceSweep(deps());

  expect(run.status).toBe('completed');
  expect(run.proposal.amount).toBe(400);
  expect(run.pending).toBeUndefined();
});

test('a sweep over the mandate parks the run and raises CIBA', async () => {
  const { configStore, runBalanceSweep } = load();
  // floor 1000 → surplus 1400, over the declared 500 ceiling
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });

  const run = await runBalanceSweep(deps());

  expect(run.status).toBe('parked');
  expect(run.proposal.amount).toBe(1400);
  expect(run.pending.authReqId).toBe('sim-abc');
  expect(run.pending.bindingMessage).toContain('1400');
  // Parking must not move the money — approval does, or the approval is theatre.
  expect(run.findings).toEqual([]);
});

test('the runtime override beats the declared ceiling, so a demo can force a pause', async () => {
  const { configStore, runBalanceSweep, mandate, AGENT } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '2000', [mandate.OVERRIDE_KEY]: '100' });

  const run = await runBalanceSweep(deps());

  // 400 was within the declared 500, but the override drops the ceiling to 100.
  expect(mandate.getMandate(AGENT)).toMatchObject({ maxAmount: 100, source: 'override' });
  expect(run.status).toBe('parked');
});

// An undeclared ceiling means nobody has said what this agent may do alone.
// Reading that as "unlimited" is the dangerous default.
test('an agent with no declared mandate may not move anything unattended', () => {
  const { configStore, mandate } = load();
  withConfig(configStore, {});

  const verdict = mandate.checkAmount('Super Banking Fraud Watch Agent', 1);

  expect(verdict.withinMandate).toBe(false);
  expect(verdict.mandate).toBeNull();
});

test('nothing over the floor is a completed run with no proposal', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '99999' });

  const run = await runBalanceSweep(deps());

  expect(run.status).toBe('completed');
  expect(run.proposal).toBeUndefined();
});

test('the parked run still proves it authenticated as the agent', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });

  const run = await runBalanceSweep(deps());

  const agentEvent = run.tokenEvents.find((e) => e.id === 'agent-actor-token');
  expect(agentEvent.claims.sub).toBe('agent:balance-sweep');
  expect(run.tokenEvents.some((e) => e.claims && e.claims.act)).toBe(false);
});
