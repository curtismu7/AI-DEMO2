'use strict';

// The BFF's PingFederate settings vs the committed record of what PingFederate's
// token managers sign and emit (config/demoReadinessPingFederateProfiles.json).
// Wrong audience / issuer was the most common way the PingFederate chain broke,
// and nothing compared the two until the first exchange failed.

// A plain variable, not a jest.fn(): the guard requires this module lazily, and
// the repo's global afterEach resets the module registry, so a mock function
// configured here would not be the instance the guard gets.
let mockExpectedFinalAud = '';
jest.mock('../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: () => mockExpectedFinalAud,
}));

const profiles = require('../config/demoReadinessPingFederateProfiles.json');
const guard = require('../services/startupConfigGuard');

const managers = profiles.accessTokenManagers;
const managerOf = (role) => profiles.roles[role].baseline.defaultAccessTokenManagerRef;
const AGENT_AUD = managers[managerOf('standard-agent-exchanger')].audience;
const FINAL_AUD = managers[managerOf('standard-mcp-exchanger')].audience;
const ISSUER = managers[managerOf('standard-agent-exchanger')].issuer;

const KEYS = ['PF_ISSUER', 'PF_STANDARD_INTERMEDIATE_AUDIENCE'];
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let warn;

beforeEach(() => {
  process.env.PF_ISSUER = ISSUER;
  process.env.PF_STANDARD_INTERMEDIATE_AUDIENCE = AGENT_AUD;
  mockExpectedFinalAud = FINAL_AUD;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

test('the contract names a token manager, with an audience, for both exchangers', () => {
  expect(AGENT_AUD).toEqual(expect.any(String));
  expect(FINAL_AUD).toEqual(expect.any(String));
  expect(ISSUER).toMatch(/^https:\/\//);
});

test('settings that match the contract raise nothing', () => {
  expect(guard.warnIfPingFederateContractDrifts()).toEqual([]);
  expect(warn).not.toHaveBeenCalled();
});

test('an issuer PingFederate does not sign as is reported', () => {
  process.env.PF_ISSUER = 'https://some-other-pf.example.test';
  expect(guard.warnIfPingFederateContractDrifts()).toEqual([expect.stringContaining('PF_ISSUER')]);
});

test('the scheme-less agent gateway audience is reported', () => {
  // The exact drift this check exists for: scope-topology.json names the PingOne
  // audience `agentgateway.ping.demo`, PingFederate emits the https:// form.
  process.env.PF_STANDARD_INTERMEDIATE_AUDIENCE = 'agentgateway.ping.demo';
  expect(guard.warnIfPingFederateContractDrifts()).toEqual([expect.stringContaining('PF_STANDARD_INTERMEDIATE_AUDIENCE')]);
});

test('a final audience the MCP exchanger does not emit is reported', () => {
  mockExpectedFinalAud = 'mcpgateway.ping.demo';
  expect(guard.warnIfPingFederateContractDrifts()).toEqual([expect.stringContaining('exchange #2')]);
});

test('says nothing when PingFederate is not configured', () => {
  delete process.env.PF_ISSUER;
  jest.spyOn(require('../services/configStore'), 'getEffective').mockReturnValue('');
  expect(guard.warnIfPingFederateContractDrifts()).toEqual([]);
});
