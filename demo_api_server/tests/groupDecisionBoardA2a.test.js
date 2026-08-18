'use strict';

/**
 * GET /api/groups/decision-board — an a2aDelegated tool must be probed with the
 * token it is really called with.
 *
 * After the audience fix (#2016) the board finally reached the group rule, and
 * that exposed the next uniform denial: 11 of 13 rows denied on
 * `mcp-invalid-a2a-generalist` while `inRequiredGroup` was true on every one.
 * Authorize's DenyA2aDelegationRequired rule denies ActChainDepth < 2 for exactly
 * the tools flagged `a2aDelegated`, so a directly-minted one-hop token could never
 * pass — the row denied on delegation shape and never reached the group rule, and
 * moving the user in or out of the group changed nothing. Same failure as the
 * audience bug, one rule later.
 *
 * These pin that the delegated path is used for exactly the flagged tools, that
 * the two-hop chain reaches the PDP, and that a delegation refusal is reported
 * rather than silently becoming a membership-shaped denial.
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

// Same wrapper shape decodeJwtClaims really returns — see the guard in
// groupDecisionBoardToken.test.js for why this is not written inline.
const decoded = (claims) => ({ header: { alg: 'RS256', typ: 'JWT' }, claims });

const DIRECT_CLAIMS = { aud: 'mcpgateway.ping.demo' };
const DELEGATED_CLAIMS = {
  aud: 'mcpgateway.ping.demo',
  act: { sub: 'specialist-1', act: { sub: 'generalist-1' } },
};

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

describe('decision-board delegates for a2aDelegated tools', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => {
    jest.clearAllMocks();
    groupPolicy._reset();
    membershipService.isReady.mockReturnValue(true);
    membershipService.listUserGroupNamesForVertical.mockResolvedValue([PRIVILEGED]);
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
      decision: 'PERMIT', raw: { statements: [{ code: 'mcp-tool-authorized' }] },
    });
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: 'direct.jwt.x' });
    a2aDelegationService.delegateToSpecialist.mockResolvedValue({ token: 'delegated.jwt.x' });
    agentMcpTokenService.decodeJwtClaims.mockImplementation((tok) =>
      decoded(tok === 'delegated.jwt.x' ? DELEGATED_CLAIMS : DIRECT_CLAIMS));
  });

  it('splits the mint path on the a2aDelegated SoT flag, not a tool-name list', async () => {
    const payload = await callBoard();

    const delegatedTools = a2aDelegationService.delegateToSpecialist.mock.calls
      .map((c) => c[1].tool).sort();
    const directTools = agentMcpTokenService.resolveMcpAccessTokenWithEvents.mock.calls
      .map((c) => c[1]).sort();

    // Every row is minted exactly once, by exactly one path.
    expect(delegatedTools.length + directTools.length).toBe(payload.rows.length);
    expect(delegatedTools.filter((t) => directTools.includes(t))).toEqual([]);

    // And the split is the flag — asserted against the REAL scopeTopology, so a
    // tool whose flag moves is caught here rather than at demo time.
    for (const t of delegatedTools) { expect(scopeTopology.isA2aDelegatedTool(t)).toBe(true); }
    for (const t of directTools) { expect(scopeTopology.isA2aDelegatedTool(t)).toBe(false); }
    expect(delegatedTools.length).toBeGreaterThan(0);
    expect(directTools.length).toBeGreaterThan(0);
  });

  it('carries the two-hop act chain to the PDP for a delegated tool', async () => {
    await callBoard();

    const a2aCall = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls
      .map((c) => c[0])
      .find((a) => scopeTopology.isA2aDelegatedTool(a.toolName));

    expect(a2aCall).toBeDefined();
    // ActChainDepth < 2 is precisely what DenyA2aDelegationRequired denies.
    expect(a2aCall.actChainDepth).toBe(2);
    expect(a2aCall.actClientId).toBe('specialist-1');
    expect(a2aCall.nestedActClientId).toBe('generalist-1');
    expect(a2aCall.tokenAudience).toBe('mcpgateway.ping.demo');
  });

  it('delegates for the row own vertical, not the active one', async () => {
    const payload = await callBoard();

    // Compared as (vertical, tool) PAIRS, not by tool: sensitive_order_history
    // exists in two verticals, so a lookup keyed on the tool alone silently
    // matches the wrong row and passes for the wrong reason.
    const delegated = a2aDelegationService.delegateToSpecialist.mock.calls
      .map(([, o]) => `${o.vertical}:${o.tool}`).sort();
    const expected = payload.rows
      .filter((r) => scopeTopology.isA2aDelegatedTool(r.tool))
      .map((r) => `${r.verticalId}:${r.tool}`).sort();

    expect(delegated).toEqual(expected);
    // Two verticals really do share a tool here — the reason this is a pair test.
    expect(new Set(expected.map((p) => p.split(':')[1])).size).toBeLessThan(expected.length);
  });

  it('falls back to the one-hop mint when A2A is off, and says so', async () => {
    // ff_a2a_delegation defaults to FALSE, so this is the default path. Presenting
    // no token would make the PDP answer mcp-invalid-audience — less informative
    // than the mcp-invalid-a2a-generalist it returns when it can see a real
    // one-hop chain. Keep the better verdict, and explain the shortfall.
    a2aDelegationService.delegateToSpecialist.mockResolvedValue({
      token: null, error: 'a2a_delegation_disabled',
    });

    const payload = await callBoard();

    const a2aRows = payload.rows.filter((r) => scopeTopology.isA2aDelegatedTool(r.tool));
    expect(a2aRows.length).toBeGreaterThan(0);
    for (const row of a2aRows) {
      // A token IS presented — the one-hop one, so the PDP judges real evidence.
      expect(row.tokenPresented).toBe(true);
      expect(row.tokenError).toMatch(/a2a delegation unavailable \(a2a_delegation_disabled\)/);
      expect(row.tokenError).toMatch(/one-hop token/);
    }
    // Every row still gets a mint — the fallback goes through the direct path.
    expect(agentMcpTokenService.resolveMcpAccessTokenWithEvents.mock.calls.length)
      .toBe(payload.rows.length);
    // The non-delegated rows are unaffected by an A2A outage.
    const directRows = payload.rows.filter((r) => !scopeTopology.isA2aDelegatedTool(r.tool));
    expect(directRows.every((r) => r.tokenPresented === true && r.tokenError == null)).toBe(true);
  });

  it('a real mint failure outranks the A2A note — the note never hides it', async () => {
    a2aDelegationService.delegateToSpecialist.mockResolvedValue({
      token: null, error: 'a2a_delegation_disabled',
    });
    agentMcpTokenService.resolveMcpAccessTokenWithEvents.mockResolvedValue({
      token: null, blockCode: 'user_token_forwarding_disabled', blockMessage: 'off',
    });

    const payload = await callBoard();

    const a2aRow = payload.rows.find((r) => scopeTopology.isA2aDelegatedTool(r.tool));
    expect(a2aRow.tokenPresented).toBe(false);
    expect(a2aRow.tokenError).toBe('user_token_forwarding_disabled: off');
  });
});
