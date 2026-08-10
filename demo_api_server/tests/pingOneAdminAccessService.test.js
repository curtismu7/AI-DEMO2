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
  getEffective: jest.fn((key) => {
    if (key === 'pingone_mcp_token_exchanger_client_id') return 'exchanger-client-id';
    if (key === 'pingone_mcp_token_exchanger_client_secret') return 'exchanger-secret';
    return null;
  }),
}));

const membershipService = require('../services/pingOneGroupMembershipService');
const oauthService = require('../services/oauthService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const { checkAccess } = require('../services/pingOneAdminAccessService');

// A minimal valid JWT with { aud: 'mcpgateway.ping.demo' } in its payload —
// decodeJwt only needs a 3-part base64url string, signature is never checked.
const EXCHANGED_TOKEN = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ aud: 'mcpgateway.ping.demo', sub: 'user-1' })).toString('base64url'),
  'sig',
].join('.');

beforeEach(() => {
  jest.clearAllMocks();
  membershipService.isReady.mockReturnValue(true);
  oauthService.performTokenExchangeAs.mockResolvedValue(EXCHANGED_TOKEN);
});

test('permits a live pingone-admin member via a real PingOne Authorize PERMIT', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
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

  expect(oauthService.performTokenExchangeAs).toHaveBeenCalledWith(
    'admin-session-token', null, 'exchanger-client-id', 'exchanger-secret',
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
    }),
  );
});

test('denies a live pingone-admin member when the real PDP decision is DENY', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
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

test('fails closed with 503 immediately when accessToken is missing — never calls the exchange', async () => {
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

test('fails closed with 503 when the token exchange itself throws', async () => {
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(['pingone-admin']);
  oauthService.performTokenExchangeAs.mockRejectedValue(new Error('Token exchange failed: invalid_grant'));

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
