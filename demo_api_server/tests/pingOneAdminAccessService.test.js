'use strict';

jest.mock('../services/groupPolicy', () => ({
  groupNameForCategory: jest.fn(() => 'pingone-admin'),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(),
  listUserGroupNamesForVertical: jest.fn(),
}));
jest.mock('../services/oauthService', () => ({
  performTokenExchangeAs: jest.fn(),
}));
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: jest.fn(() => 'mcpgateway.ping.demo'),
}));
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    pingone_ai_agent_actor_client_id: 'actor-client-id',
    pingone_ai_agent_actor_client_secret: 'actor-secret',
    ai_agent_intermediate_audience: 'agentgateway.ping.demo',
    pingone_mcp_token_exchanger_client_id: 'exchanger-client-id',
    pingone_mcp_token_exchanger_client_secret: 'exchanger-secret',
  }[key] || null)),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const oauthService = require('../services/oauthService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

// Build a minimal valid JWT (3-part base64url) — decodeJwt never checks the
// signature, so part 3 can be any placeholder string.
function buildToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

const HOP1_TOKEN = buildToken({ aud: 'agentgateway.ping.demo', sub: 'user-1', act: { sub: 'actor-client-id' } });
const FINAL_TOKEN = buildToken({ aud: 'mcpgateway.ping.demo', sub: 'user-1', act: { sub: 'actor-client-id' } });
const FINAL_TOKEN_NO_AUD = buildToken({ sub: 'user-1', act: { sub: 'actor-client-id' } });

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
});

test('permits a live pingone-admin member via a real two-hop exchange and PingOne Authorize PERMIT', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'PERMIT' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: true,
    status: 200,
    requiredGroup: 'pingone-admin',
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenNthCalledWith(1,
    'admin-session-token', null, 'actor-client-id', 'actor-secret',
    'agentgateway.ping.demo', ['read'], 'post',
  );
  expect(oauthService.performTokenExchangeAs).toHaveBeenNthCalledWith(2,
    HOP1_TOKEN, null, 'exchanger-client-id', 'exchanger-secret',
    'mcpgateway.ping.demo', ['read'], 'post',
  );
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'user-1',
      requiredGroup: 'pingone-admin',
      inRequiredGroup: true,
      verticalId: 'pingone-admin',
      tokenAudience: 'mcpgateway.ping.demo',
      mcpResourceUri: 'mcpgateway.ping.demo',
      actClientId: 'actor-client-id',
    }),
  );
});

test('denies a live pingone-admin member when the real PDP decision is DENY', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed on INDETERMINATE for a real member', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'INDETERMINATE' });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_required',
    status: 403,
  });
});

test('fails closed with 503 on policyNotFound, not a member-facing 403', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY', policyNotFound: true });

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});

test('fails closed with 503 immediately when accessToken is missing — neither hop runs', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: null,
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when hop 1 throws — hop 2 and the PDP never run', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs.mockRejectedValueOnce(new Error('Token exchange failed: invalid_grant'));

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when hop 2 throws — the PDP never runs', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockRejectedValueOnce(new Error('Token exchange failed: invalid_grant'));

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(2);
  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed with 503 when the final token has no audience claim — the PDP never runs', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs
    .mockResolvedValueOnce(HOP1_TOKEN)
    .mockResolvedValueOnce(FINAL_TOKEN_NO_AUD);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });

  expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
});

test('fails closed when live membership cannot be verified', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(null);

  await expect(checkAccess({
    username: 'demoAdmin',
    pingOneUserId: 'user-1',
    accessToken: 'admin-session-token',
  })).resolves.toMatchObject({
    allowed: false,
    error: 'pingone_admin_group_lookup_unavailable',
    status: 503,
  });
});
