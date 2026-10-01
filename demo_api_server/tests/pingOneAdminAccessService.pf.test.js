'use strict';

// The PingOne Admin gate under a PingFederate sign-in. The session subject is a
// PingFederate username and the session token is PingFederate's, so the gate
// checks the PingOne account with the same username and runs both exchange
// hops at PingFederate. The PingOne-session path is covered, unchanged, by
// pingOneAdminAccessService.test.js.

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  listUserGroupNamesForVertical: jest.fn(),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchangeAs: jest.fn(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: jest.fn(() => 'https://gw.example.test/mcp'),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn(),
}));
jest.mock('../services/pfStandardTokenExchangeService', () => ({
  resolveConfig: jest.fn(() => ({ intermediateAudience: 'https://agentgateway.example.test', agentActorScope: 'agent:invoke' })),
  getActorToken: jest.fn(async (_config, role) => `${role}-actor-token`),
  performExchange: jest.fn(),
  validateFinalToken: jest.fn(),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const oauthService = require('../services/oauthService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const pfExchange = require('../services/pfStandardTokenExchangeService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

function buildToken(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

const FINAL_TOKEN = buildToken({
  aud: 'https://gw.example.test/mcp', sub: 'demoadmin', act: { sub: 'pf-mcp-actor', act: { sub: 'pf-agent-actor' } },
});
const pfSession = { username: 'demoadmin', pingOneUserId: 'demoadmin', accessToken: 'pf-session-token', oauthProvider: 'pingfederate' };

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  fetchPingOneUserByUsername.mockResolvedValue({ user: { id: 'p1-user-uuid' }, error: null });
  pfExchange.performExchange.mockResolvedValueOnce('hop1-token').mockResolvedValueOnce(FINAL_TOKEN);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'PERMIT' });
});

test('checks the PingOne account with the same username and exchanges at PingFederate', async () => {
  await expect(checkAccess(pfSession)).resolves.toMatchObject({ allowed: true, status: 200 });

  expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demoadmin');
  expect(membershipService.listUserGroupNamesForVertical).toHaveBeenCalledWith('p1-user-uuid', 'pingone-admin');
  expect(pfExchange.performExchange).toHaveBeenNthCalledWith(1,
    expect.any(Object), 'agent', 'pf-session-token', 'agent-actor-token', 'https://agentgateway.example.test', ['agent:invoke']);
  expect(pfExchange.performExchange).toHaveBeenNthCalledWith(2,
    expect.any(Object), 'mcp', 'hop1-token', 'mcp-actor-token', 'https://gw.example.test/mcp', ['gateway:mcp:invoke']);
  // The exchanged token must still carry the PingFederate subject it was minted for.
  expect(pfExchange.validateFinalToken).toHaveBeenCalledWith(FINAL_TOKEN, expect.objectContaining({
    userSub: 'demoadmin', audience: 'https://gw.example.test/mcp',
  }));
  expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'p1-user-uuid', inRequiredGroup: true, tokenAudience: 'https://gw.example.test/mcp', actClientId: 'pf-mcp-actor',
  }));
});

test('denies, without exchanging, when PingOne has no account with that username', async () => {
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });

  await expect(checkAccess(pfSession)).resolves.toMatchObject({
    allowed: false, error: 'pingone_admin_user_not_linked', status: 403, username: 'demoadmin',
  });
  expect(membershipService.listUserGroupNamesForVertical).not.toHaveBeenCalled();
  expect(pfExchange.performExchange).not.toHaveBeenCalled();
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when the PingOne username lookup itself fails', async () => {
  fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'request_failed' });

  await expect(checkAccess(pfSession)).resolves.toMatchObject({
    allowed: false, error: 'pingone_admin_group_lookup_unavailable', status: 503,
  });
  expect(pfExchange.performExchange).not.toHaveBeenCalled();
});

test('fails closed with 503 when the exchanged token does not validate — the PDP never runs', async () => {
  pfExchange.validateFinalToken.mockImplementationOnce(() => { throw new Error('PingFederate final audience mismatch'); });

  await expect(checkAccess(pfSession)).resolves.toMatchObject({
    allowed: false, error: 'pingone_admin_group_lookup_unavailable', status: 503,
  });
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('a PingOne session never takes the PingFederate path', async () => {
  oauthService.performTokenExchangeAs.mockResolvedValueOnce('hop1').mockResolvedValueOnce(FINAL_TOKEN);

  await expect(checkAccess({ username: 'demoAdmin', pingOneUserId: 'p1-user-uuid', accessToken: 'p1-session-token' }))
    .resolves.toMatchObject({ allowed: true });
  expect(fetchPingOneUserByUsername).not.toHaveBeenCalled();
  expect(pfExchange.performExchange).not.toHaveBeenCalled();
  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(2);
});
