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
  resolveMcpAccessTokenWithEvents: jest.fn(),
  decodeJwtClaims: jest.fn(),
}));
// a2aDelegated tools mint through the specialist chain instead (#2017). Without
// this mock those rows would reach the REAL delegation service and fail for a
// reason that has nothing to do with what this file is testing.
jest.mock('../services/a2aDelegationService', () => ({
  delegateToSpecialist: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const membershipService = require('../services/pingOneGroupMembershipService');
const agentMcpTokenService = require('../services/agentMcpTokenService');
const a2aDelegationService = require('../services/a2aDelegationService');
const scopeTopology = require('../services/scopeTopology');
const groupPolicy = require('../services/groupPolicy');
const { verticalManifest } = require('../services/verticalManifest');

const PRIVILEGED = 'AI_Demo_Privileged';
const router = require('../routes/groupMembership');

// decodeJwtClaims returns { header, claims }, NOT the claims. Every mock in this
// file goes through this helper so it cannot drift back to the flat shape — an
// earlier flat mock made the route's `.aud` read undefined for every row while
// this suite stayed green, so the test asserted the bug rather than the contract.
const decoded = (claims) => ({ header: { alg: 'RS256', typ: 'JWT' }, claims });

// A real JWT (unsigned — decodeJwtClaims does no verification), so the guard
// below compares the mock against the actual implementation, not a second guess.
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const REAL_JWT = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ aud: 'mcpgateway.ping.demo' })}.sig`;

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
    a2aDelegationService.delegateToSpecialist.mockResolvedValue({ token: 'jwt.for.mcp' });
  });

  // Rows whose tool is a2aDelegated take the specialist path; the refusal cases
  // below drive the DIRECT mint, so they assert over these rows only. The
  // delegated refusal has its own coverage in groupDecisionBoardA2a.test.js.
  const directRows = (payload) => payload.rows.filter((r) => !scopeTopology.isA2aDelegatedTool(r.tool));

  it('forwards the minted token audience and act chain to the PDP', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'jwt.for.mcp' });
    agentMcpTokenService.decodeJwtClaims.mockReturnValue(decoded({
      aud: 'mcpgateway.ping.demo',
      act: { sub: 'agent-1', act: { sub: 'generalist-1' } },
    }));

    const payload = await callBoard();

    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect(args.tokenAudience).toBe('mcpgateway.ping.demo');
    expect(args.actClientId).toBe('agent-1');
    expect(args.nestedActClientId).toBe('generalist-1');
    expect(args.actChainDepth).toBe(2);
    expect(payload.rows.every((r) => r.tokenPresented === true)).toBe(true);
  });

  it('mints one token per row, for that row own tool', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'jwt.for.mcp' });
    agentMcpTokenService.decodeJwtClaims.mockReturnValue(decoded({ aud: 'mcpgateway.ping.demo' }));

    const payload = await callBoard();

    // Compare as multisets: rows are sorted by displayName after evaluation,
    // so mint order and row order legitimately differ.
    const tools = [
      ...agentMcpTokenService.resolveMcpAccessTokenWithEvents.mock.calls.map((c) => c[1]),
      ...a2aDelegationService.delegateToSpecialist.mock.calls.map((c) => c[1].tool),
    ].sort();
    expect(tools).toEqual(payload.rows.map((r) => r.tool).sort());
  });

  it('reports WHY the mint was refused instead of a silent tokenPresented:false', async () => {
    // The blocked path resolves rather than throws, so the plain
    // resolveMcpAccessToken wrapper turned a refusal into a bare null and the
    // row said only "no token". Live, that left 13 rows unexplained.
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({
      token: null,
      blockCode: 'user_token_forwarding_disabled',
      blockMessage: 'Raw user-token forwarding to MCP is disabled.',
    });

    const payload = await callBoard();

    expect(directRows(payload).length).toBeGreaterThan(0);
    for (const row of directRows(payload)) {
      expect(row.tokenPresented).toBe(false);
      expect(row.tokenError).toBe(
        'user_token_forwarding_disabled: Raw user-token forwarding to MCP is disabled.',
      );
      // A string the UI can render — never describeBlockedToken()'s HTTP envelope.
      expect(typeof row.tokenError).toBe('string');
    }
  });

  it('falls back to need_auth when there is no block code', async () => {
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({
      token: null, need_auth: true,
    });

    const payload = await callBoard();

    expect(directRows(payload)[0].tokenError).toMatch(/need_auth/);
  });

  it('OMITS tokenAudience when the mint fails — never sends an empty string', async () => {
    // '' would claim the token was read and its audience was empty. Omission is
    // the honest encoding, and matches the PEP's C1 contract.
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockRejectedValue(new Error('no user token'));

    const payload = await callBoard();

    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls
      .map((c) => c[0])
      .find((a) => !scopeTopology.isA2aDelegatedTool(a.toolName));
    expect('tokenAudience' in args).toBe(false);
    for (const row of directRows(payload)) {
      expect(row.tokenPresented).toBe(false);
      expect(row.tokenError).toBe('no user token');
    }
  });

  // ── the shape this suite got wrong ──
  //
  // The route read `.aud` straight off decodeJwtClaims' return value. That is
  // { header, claims }, so `.aud` was ALWAYS undefined: every row reported
  // "minted token carries no aud claim", sent no TokenAudience to the PDP, and
  // the board could not show PERMIT no matter who was in which group. The mint
  // was fine the whole time. It survived because the mock in this file returned
  // a flat { aud } — the test encoded the same misreading as the code, so green
  // meant "both agree", not "the route is right".
  //
  // 20 other suites mock this function with the correct { claims: {...} } shape.
  // This one was the outlier.
  it('the mock shape matches what decodeJwtClaims really returns', () => {
    const real = jest.requireActual('../services/agentMcpTokenService').decodeJwtClaims;
    const actual = real(REAL_JWT);

    expect(Object.keys(actual).sort()).toEqual(['claims', 'header']);
    expect(actual.claims.aud).toBe('mcpgateway.ping.demo');
    // Reading the audience off the top level is the bug — pin that it is absent.
    expect(actual.aud).toBeUndefined();
    // And the helper every mock here goes through must have that same shape.
    expect(Object.keys(decoded({ aud: 'x' })).sort()).toEqual(Object.keys(actual).sort());
  });

  it('a flat-claims mock produces NO audience — the route must unwrap .claims', async () => {
    // Written to fail against the old route: with the flat shape the route used
    // to read, tokenAudience would still arrive at the PDP. It must not.
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: REAL_JWT });
    agentMcpTokenService.decodeJwtClaims.mockReturnValue({ aud: 'mcpgateway.ping.demo' });

    const payload = await callBoard();

    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect('tokenAudience' in args).toBe(false);
    expect(payload.rows.every((r) => r.tokenPresented === false)).toBe(true);
    // The flat shape has no .claims at all, so this lands on the decode branch
    // rather than the missing-aud one — either way the row is honest and the PDP
    // is not handed an audience the route never actually read.
    expect(payload.rows[0].tokenError).toMatch(/no claims could be decoded/);
  });
});
