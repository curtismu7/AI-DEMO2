'use strict';
/**
 * Phase 3's core claim: the POLICY decides whether an unattended agent may move
 * money on its own — the job only proposes and obeys.
 *
 * These tests drive the real decision rule by mounting demo_authz_server's
 * decision router in-process, so an assertion here fails if the policy stops
 * enforcing the ceiling. A stubbed authorize() would only prove the job can
 * read its own stub.
 *
 * See autonomousRunsFlag.test.js for why mocks are required inside each test
 * (setup.js resets modules per test).
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));

const express = require('express');
const request = require('supertest');

const ACCOUNTS = [
  { id: 'chk-1', userId: 'u1', accountType: 'checking', name: 'Everyday Checking', balance: 2400 },
  { id: 'sav-1', userId: 'u1', accountType: 'savings', name: 'Savings', balance: 9000 },
];
const okToken = { access_token: 'x', claims: { sub: 'agent:balance-sweep' } };

/**
 * A supertest-backed stand-in for axios.post that routes at the real policy
 * router. This is what makes these tests enforcement tests rather than
 * stub-reading tests.
 */
function policyClient() {
  const app = express();
  app.use(express.json());
  app.use('/governance/pap/alpha/policy/:workerId', require('../../../demo_authz_server/routes/decision'));
  return {
    calls: [],
    async post(url, body) {
      this.calls.push(body);
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const res = await request(app).post(path).send(body);
      return { data: res.body };
    },
  };
}

function load() {
  const configStore = require('../../services/configStore');
  const { runBalanceSweep } = require('../../services/balanceSweepJob');
  const { authorizeUnattendedTransfer } = require('../../services/autonomousAuthorize');
  return { configStore, runBalanceSweep, authorizeUnattendedTransfer };
}

// Credentials are always present: these tests are about the mandate, and an
// unprovisioned agent now refuses before the policy is ever consulted.
const AGENT_CREDS = {
  pingone_balance_sweep_agent_client_id: 'bs-client',
  pingone_balance_sweep_agent_client_secret: 'shh',
};
const withConfig = (configStore, map = {}) =>
  configStore.getEffective.mockImplementation((k) => ({ ...AGENT_CREDS, ...map })[k]);

function deps(httpClient, over = {}) {
  return {
    getToken: async () => okToken,
    readAccounts: () => ACCOUNTS,
    initiateCiba: () => ({ auth_req_id: 'sim-abc', expires_in: 300, interval: 5 }),
    authorize: (args) =>
      require('../../services/autonomousAuthorize').authorizeUnattendedTransfer({ ...args, httpClient }),
    ...over,
  };
}

test('within the mandate, the policy permits and the sweep completes', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '2000' }); // surplus 400 < 500 ceiling

  const run = await runBalanceSweep(deps(policyClient()));

  expect(run.status).toBe('completed');
  expect(run.proposal.amount).toBe(400);
  expect(run.pending).toBeUndefined();
});

// The heart of it: over the ceiling is a PAUSE, not a refusal — PERMIT carrying
// an unfulfilled ciba-approval obligation, which the PEP discharges via CIBA.
test('over the mandate, the policy pauses and the run parks', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' }); // surplus 1400 > 500

  const run = await runBalanceSweep(deps(policyClient()));

  expect(run.status).toBe('parked');
  expect(run.decision.decision).toBe('PERMIT');
  expect(run.decision.code).toBe('ciba-approval-required');
  expect(run.pending.authReqId).toBe('sim-abc');
  // Parking must not move the money — approval does, or approval is theatre.
  expect(run.findings).toEqual([]);
});

// Order matters inside the rule: the absolute limit is checked BEFORE the
// pause. Otherwise a huge unattended transfer would merely "need approval", and
// a human waving it through would make the absolute ceiling advisory.
test('past the absolute limit it is denied outright, not offered for approval', async () => {
  const { configStore, runBalanceSweep } = load();
  // floor 0 → surplus 2400, over the $2000 absolute deny limit
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '0.01' });
  const initiateCiba = jest.fn();

  const run = await runBalanceSweep(deps(policyClient(), { initiateCiba }));

  expect(run.status).toBe('denied');
  expect(run.decision.code).toBe('transaction-denied');
  expect(initiateCiba).not.toHaveBeenCalled();
});

test('the declared ceiling reaches the policy as a request attribute', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });
  const client = policyClient();

  await runBalanceSweep(deps(client));

  expect(client.calls[0].parameters).toMatchObject({
    AgentClass: 'autonomous',
    MandateMaxAmount: '500',
    TransactionAmount: '1400',
    DecisionContext: 'Transaction',
  });
});

// No mandate → the request never reaches an explicit permit → the PDP fails
// closed. Deliberately NOT a pause, and no CIBA is raised.
test('an agent with no declared mandate is denied by policy and never raises CIBA', async () => {
  jest.doMock('../../services/scopeTopology', () => ({
    _manifest: () => ({ apps: { 'Super Banking Balance Sweep Agent': { agentClass: 'autonomous' } } }),
  }));
  const configStore = require('../../services/configStore');
  const { runBalanceSweep } = require('../../services/balanceSweepJob');
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });
  const initiateCiba = jest.fn();

  const run = await runBalanceSweep(deps(policyClient(), { initiateCiba }));

  expect(run.status).toBe('denied');
  expect(run.decision.code).toBe('autonomous-no-mandate');
  expect(initiateCiba).not.toHaveBeenCalled();
  expect(run.pending).toBeUndefined();
});

// An unreachable PDP is not a permit.
test('the sweep fails closed when the policy engine cannot be reached', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });
  const dead = { post: async () => { throw new Error('ECONNREFUSED'); } };

  const run = await runBalanceSweep(deps(dead));

  expect(run.status).toBe('failed');
  expect(run.error).toMatch(/authorization unavailable/);
  expect(run.findings).toEqual([]);
});

test('nothing over the floor never reaches the policy at all', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '99999' });
  const client = policyClient();

  const run = await runBalanceSweep(deps(client));

  expect(run.status).toBe('completed');
  expect(run.proposal).toBeUndefined();
  expect(client.calls).toHaveLength(0);
});

test('the parked run still proves it authenticated as the agent', async () => {
  const { configStore, runBalanceSweep } = load();
  withConfig(configStore, { BALANCE_SWEEP_FLOOR: '1000' });

  const run = await runBalanceSweep(deps(policyClient()));

  const agentEvent = run.tokenEvents.find((e) => e.id === 'agent-actor-token');
  expect(agentEvent.claims.sub).toBe('agent:balance-sweep');
  expect(run.tokenEvents.some((e) => e.claims && e.claims.act)).toBe(false);
});
