'use strict';

/**
 * agentMayActSub() must resolve the id the deployment actually sets.
 *
 * The user's PingOne `mayAct` attribute is a per-user consent artifact written
 * ONLY by the grant/revoke routes — provisioning deliberately does not set it
 * (pingoneProvisionService step 23.5: "an unset attribute projects no claim, so
 * a fresh environment starts with the agent unauthorized"). PingOne then
 * CONSTRUCTS the exchanged token's `act` from `may_act`, projected from
 * `${user.mayAct}`.
 *
 * Found live 2026-08-29: the resolver read four keys, all empty in the running
 * container, because the deployment sets PINGONE_AI_AGENT_ACTOR_CLIENT_ID —
 * which was not among them. Grant answered 503 agent_not_configured, so no user
 * could be re-granted, and demoUser kept mayAct.sub = 71e878ea, the AI Agent
 * Actor app deleted when it was recreated as 0b412e8b on 2026-08-22. Every
 * exchanged token then carried a dead act.sub and the gateway refused it.
 */

const ACTOR_ID = '0b412e8b-cfbc-4c7d-a773-0d46118de09d';

const mockGetEffective = jest.fn(() => undefined);
jest.mock('../services/configStore', () => ({
  getEffective: (...a) => mockGetEffective(...a),
}));

const ENV_KEYS = [
  'AI_AGENT_CLIENT_ID',
  'PINGONE_AI_AGENT_CLIENT_ID',
  'PINGONE_AI_AGENT_ACTOR_CLIENT_ID',
];
const saved = {};

beforeEach(() => {
  jest.resetModules();
  mockGetEffective.mockReset();
  mockGetEffective.mockReturnValue(undefined);
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function subject() {
  // The route module exports the router; reach the helper through the module's
  // own resolution by re-requiring it with the env in place.
  return require('../routes/agentAuthorization').__test.agentMayActSub();
}

test('RED PROOF — resolves PINGONE_AI_AGENT_ACTOR_CLIENT_ID, the name the deployment sets', () => {
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = ACTOR_ID;
  expect(subject()).toBe(ACTOR_ID);
});

test('resolves the configStore actor key too', () => {
  mockGetEffective.mockImplementation((k) => (k === 'pingone_ai_agent_actor_client_id' ? ACTOR_ID : undefined));
  expect(subject()).toBe(ACTOR_ID);
});

test('the older key still wins when set — precedence unchanged for existing deployments', () => {
  mockGetEffective.mockImplementation((k) => (k === 'ai_agent_client_id' ? 'legacy-id' : undefined));
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = ACTOR_ID;
  expect(subject()).toBe('legacy-id');
});

test('null when nothing is configured — grant must still fail closed, never write a bogus sub', () => {
  expect(subject()).toBeNull();
});
