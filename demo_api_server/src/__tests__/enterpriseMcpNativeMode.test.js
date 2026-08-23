'use strict';

/**
 * The load-bearing regression suite for Phase A.
 *
 * The guarantee that matters most is NOT that native mode works — it is that
 * enterprise-managed mode with native UNCONFIGURED behaves exactly as it does
 * today, because that is what every existing demo runs.
 */

jest.mock('../../services/idJagService', () => ({
  isNativeIdJagEnabled: jest.fn(() => false),
  mintAndRedeem: jest.fn(),
}));
jest.mock('../../services/enterpriseMcpPolicyService', () => ({
  isEnabled: jest.fn(() => true),
  checkPolicy: jest.fn(async () => ({ allowed: true, matchDetail: 'group:banking-agents' })),
  getAllowedResourceUris: jest.fn(() => ['https://mcpserver.ping.demo']),
}));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn(), logAppEvent: jest.fn() }));

const idJagService = require('../../services/idJagService');
const agentMcpTokenService = require('../../services/agentMcpTokenService');

const RESOURCE = 'https://mcpserver.ping.demo';

function sessionReq() {
  return {
    session: { user: { oauthId: 'user-123', username: 'alice' } },
    headers: {},
  };
}

const kindOf = (e) => e.step || e.id || e.type;

describe('native ID-JAG token acquisition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    idJagService.isNativeIdJagEnabled.mockReturnValue(false);
  });

  test('STAND-IN UNCHANGED: native unconfigured returns null and touches nothing', async () => {
    const events = [];
    const token = await agentMcpTokenService.maybeResolveNativeIdJagToken(sessionReq(), events, {
      resource: RESOURCE, scope: 'banking:read',
    });

    expect(token).toBeNull();
    expect(events).toHaveLength(0);
    expect(idJagService.mintAndRedeem).not.toHaveBeenCalled();
  });

  test('native mode returns the redeemed token and records both ID-JAG steps', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    idJagService.mintAndRedeem.mockResolvedValue({
      assertion: 'the.id.jag',
      token: { access_token: 'mcp.access.token', token_type: 'Bearer', expires_in: 3600, scope: 'banking:read' },
    });

    const events = [];
    const token = await agentMcpTokenService.maybeResolveNativeIdJagToken(sessionReq(), events, {
      resource: RESOURCE, scope: 'banking:read',
    });

    expect(token).toBe('mcp.access.token');
    const kinds = events.map(kindOf);
    expect(kinds).toContain('id-jag-issued');
    expect(kinds).toContain('id-jag-redeemed');
  });

  test('the issued event surfaces the ID-JAG claims, never the raw token', async () => {
    // buildTokenEvent takes DECODED claims, not a token string, and deliberately
    // never stores the raw JWT. Asserting on the decoded shape also proves the
    // assertion really is a well-formed ID-JAG rather than an opaque blob.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const assertion = [
      b64({ alg: 'RS256', typ: 'oauth-id-jag+jwt' }),
      b64({ iss: 'https://idp.ping.demo', sub: 'user-123', aud: 'https://as', scope: 'banking:read' }),
      'sig',
    ].join('.');

    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    idJagService.mintAndRedeem.mockResolvedValue({
      assertion,
      token: { access_token: 'mcp.access.token', scope: 'banking:read' },
    });

    const events = [];
    await agentMcpTokenService.maybeResolveNativeIdJagToken(sessionReq(), events, {
      resource: RESOURCE, scope: 'banking:read',
    });

    const issued = events.find((e) => kindOf(e) === 'id-jag-issued');
    expect(issued.alg).toBe('RS256');
    expect(issued.claims.sub).toBe('user-123');
    expect(issued.claims.scope).toBe('banking:read');
    expect(issued.idJagStandIn).toBe(false);
    expect(JSON.stringify(issued)).not.toContain(assertion);
  });

  test('a DENY at the IdP propagates its code and yields no token', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    idJagService.mintAndRedeem.mockRejectedValue(
      Object.assign(new Error('Not authorized.'), { code: 'enterprise_mcp_policy_denied', httpStatus: 403 }),
    );

    await expect(
      agentMcpTokenService.maybeResolveNativeIdJagToken(sessionReq(), [], { resource: RESOURCE, scope: 'banking:read' }),
    ).rejects.toMatchObject({ code: 'enterprise_mcp_policy_denied', httpStatus: 403 });
  });

  test('native mode is skipped when no resource audience is configured', async () => {
    idJagService.isNativeIdJagEnabled.mockReturnValue(true);
    const events = [];
    const token = await agentMcpTokenService.maybeResolveNativeIdJagToken(sessionReq(), events, {
      resource: '', scope: 'banking:read',
    });

    expect(token).toBeNull();
    expect(idJagService.mintAndRedeem).not.toHaveBeenCalled();
  });
});
