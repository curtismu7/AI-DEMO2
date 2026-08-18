'use strict';

/**
 * GET /api/groups/decision-board — the decision must be backed by a REAL token.
 *
 * The board sent no TokenAudience, so the PDP fail-closed on
 * mcp-invalid-audience before the group rule was ever reached: every row denied
 * for the same reason regardless of membership, and the page's claim ("change
 * the membership and every row moves with it") was false. Found live — the 429
 * burst had been masking it on 11 of 13 rows.
 *
 * Fabricating the expected URI is what C1 rule 1 forbids, so the fix presents
 * the same token the PEP would. These pin that: the audience reaches the PDP,
 * the act chain rides with it, and a failed mint is reported rather than
 * silently becoming an audience-shaped denial.
 */

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  listUserGroupNamesForVertical: jest.fn(),
  _resetCache: jest.fn(),
}));
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessToken: jest.fn(),
  decodeJwtClaims: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const membershipService = require('../services/pingOneGroupMembershipService');
const agentMcpTokenService = require('../services/agentMcpTokenService');
const groupPolicy = require('../services/groupPolicy');
const { verticalManifest } = require('../services/verticalManifest');

const PRIVILEGED = 'AI_Demo_Privileged';
const router = require('../routes/groupMembership');

async function callBoard() {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/decision-board' && l.route.methods.get,
  );
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = { session: { user: { username: 'demoUser', oauthId: 'user-1' } } };
  let payload = null;
  const res = { json: (b) => { payload = b; return res; }, status: () => res };
  await handler(req, res, () => {});
  return payload;
}

describe('decision-board presents a real token', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => {
    jest.clearAllMocks();
    groupPolicy._reset();
    membershipService.isReady.mockReturnValue(true);
    membershipService.listUserGroupNamesForVertical.mockResolvedValue([PRIVILEGED]);
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
      decision: 'PERMIT', raw: { statements: [{ code: 'mcp-tool-authorized' }] },
    });
  });

  it('forwards the minted token audience and act chain to the PDP', async () => {
    agentMcpTokenService.resolveMcpAccessToken.mockResolvedValue('jwt.for.mcp');
    agentMcpTokenService.decodeJwtClaims.mockReturnValue({
      aud: 'mcpgateway.ping.demo',
      act: { sub: 'agent-1', act: { sub: 'generalist-1' } },
    });

    const payload = await callBoard();

    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect(args.tokenAudience).toBe('mcpgateway.ping.demo');
    expect(args.actClientId).toBe('agent-1');
    expect(args.nestedActClientId).toBe('generalist-1');
    expect(args.actChainDepth).toBe(2);
    expect(payload.rows.every((r) => r.tokenPresented === true)).toBe(true);
  });

  it('mints one token per row, for that row own tool', async () => {
    agentMcpTokenService.resolveMcpAccessToken.mockResolvedValue('jwt.for.mcp');
    agentMcpTokenService.decodeJwtClaims.mockReturnValue({ aud: 'mcpgateway.ping.demo' });

    const payload = await callBoard();

    // Compare as multisets: rows are sorted by displayName after evaluation,
    // so mint order and row order legitimately differ.
    const tools = agentMcpTokenService.resolveMcpAccessToken.mock.calls.map((c) => c[1]).sort();
    expect(tools).toEqual(payload.rows.map((r) => r.tool).sort());
  });

  it('OMITS tokenAudience when the mint fails — never sends an empty string', async () => {
    // '' would claim the token was read and its audience was empty. Omission is
    // the honest encoding, and matches the PEP's C1 contract.
    agentMcpTokenService.resolveMcpAccessToken.mockRejectedValue(new Error('no user token'));

    const payload = await callBoard();

    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect('tokenAudience' in args).toBe(false);
    for (const row of payload.rows) {
      expect(row.tokenPresented).toBe(false);
      expect(row.tokenError).toBe('no user token');
    }
  });
});
