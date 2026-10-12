'use strict';

/**
 * GET /api/groups/check — one live Authorize decision for one picked user and
 * one vertical's group-gated tool.
 *
 * The page asks "is THIS user in THAT group, and what does policy say?" — the
 * single-check counterpart of the decision board, which can only ever ask about
 * the signed-in user. The assertions that matter:
 *   - the decision comes from the same evaluate call the PEP makes, with the
 *     picked user's REAL directory groups (not the session user's, not the
 *     manifest's declared membership);
 *   - a failed probe renders UNKNOWN, never PERMIT;
 *   - an unknown username is a 404, not a decision about nobody.
 */

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  listUserGroupNamesForVertical: jest.fn(),
  setUserGroupMembership: jest.fn(),
  _resetCache: jest.fn(),
}));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const membershipService = require('../services/pingOneGroupMembershipService');
const userLookup = require('../services/pingOneUserLookupService');
const groupPolicy = require('../services/groupPolicy');
const { verticalManifest } = require('../services/verticalManifest');

// Required ONCE at module load — see groupDecisionBoard.test.js for the
// lazy-require/resetModules trap.
const router = require('../routes/groupMembership');

// Invoke the /check handler directly, like groupDecisionBoard.test.js does for
// /decision-board — no supertest app wiring.
async function callCheck({
  username = 'demoDelegate',
  verticalId = 'banking',
  lookup,
  groups,
  evaluate,
} = {}) {
  membershipService.isReady.mockReturnValue(true);
  // Default: banking holds only a non-privileged group (the deny story);
  // other verticals hold nothing. `groups` overrides.
  membershipService.listUserGroupNamesForVertical.mockImplementation(
    async (_userId, vertical) => (
      typeof groups === 'function' ? groups(vertical)
        : groups !== undefined ? groups
          : (vertical === 'banking' ? ['AI_Demo_Delegates'] : [])
    ),
  );
  userLookup.fetchPingOneUserByUsername.mockResolvedValue(
    lookup || { user: { id: 'picked-user-1', username }, error: null },
  );
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockImplementation(
    evaluate || (async () => ({
      decision: 'DENY',
      raw: {
        deny_reason: 'user_not_in_group',
        statements: [{ code: 'mcp-authorization-denied' }, { code: 'mcp-user-not-in-group' }],
      },
    })),
  );

  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/check' && l.route.methods.get,
  );
  expect(layer).toBeDefined();
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = {
    query: { username, verticalId },
    session: { user: { username: 'demoUser', oauthId: 'session-user-1' } },
  };
  let payload = null;
  let status = 200;
  const res = {
    json: (b) => { payload = b; return res; },
    status: (c) => { status = c; return res; },
  };
  await handler(req, res, () => {});
  return { status, payload };
}

describe('GET /api/groups/check', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => { jest.clearAllMocks(); groupPolicy._reset(); });

  it('evaluates the PICKED user\'s real directory groups, not the session user\'s', async () => {
    const { status, payload } = await callCheck();
    expect(status).toBe(200);
    // The directory read used the id resolved from the picked username.
    expect(membershipService.listUserGroupNamesForVertical).toHaveBeenCalledWith(
      'picked-user-1', 'banking',
    );
    // The decision saw those same groups — not demoUser's, not the manifest's.
    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect(args.userGroups).toEqual(['AI_Demo_Delegates']);
    expect(args.userId).toBe('picked-user-1');
    expect(payload.decision).toBe('DENY');
    // The gate is the group the manifest's restrictedTools names — the one the
    // PEP and the UC9 chip arming actually consult — not the generic
    // AI_Demo_Privileged group nothing reads.
    expect(payload.requiredGroup).toBe(groupPolicy.groupNameForCategory('banking', 'premiumTier'));
    expect(payload.inRequiredGroup).toBe(false);
    expect(payload.denyReason).toBe('user_not_in_group');
    expect(payload.codes).toEqual(['mcp-authorization-denied', 'mcp-user-not-in-group']);
    expect(payload.username).toBe('demoDelegate');
    expect(payload.policyEnabled).toBe(false);
  });

  it('carries the vertical\'s access story for member and non-member', async () => {
    const { payload } = await callCheck();
    const access = payload.access;
    expect(access).toBeTruthy();
    expect(access.label).toBeTruthy();
    expect(typeof access.memberStory).toBe('string');
    expect(access.memberStory.length).toBeGreaterThan(10);
    expect(typeof access.nonMemberStory).toBe('string');
    expect(access.nonMemberStory.length).toBeGreaterThan(10);
  });

  it('evaluates against the TOOL\'s required category, not always privileged', async () => {
    // Every vertical's restrictedTools names premiumTier for its sensitive
    // tool — the args must reflect that category's group, whatever it is.
    const { payload } = await callCheck({ verticalId: 'healthcare' });
    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect(args.requiredGroup).toBe(groupPolicy.groupNameForCategory('healthcare', 'premiumTier'));
    expect(payload.requiredGroup).toBe(groupPolicy.groupNameForCategory('healthcare', 'premiumTier'));
  });

  it('renders UNKNOWN — never PERMIT — when the decision call throws', async () => {
    const { payload } = await callCheck({
      evaluate: async () => { throw new Error('PingOne unreachable'); },
    });
    expect(payload.decision).toBe('UNKNOWN');
    expect(payload.decision).not.toBe('PERMIT');
    expect(payload.error).toMatch(/unreachable/);
  });

  it('404s an unknown username instead of evaluating a decision about nobody', async () => {
    const { status, payload } = await callCheck({
      username: 'nobody',
      lookup: { user: null, error: 'not_found' },
    });
    expect(status).toBe(404);
    expect(payload.error).toBe('user_not_found');
    expect(pingOneAuthorizeService.evaluateMcpToolDelegation).not.toHaveBeenCalled();
  });

  it('404s an unknown vertical', async () => {
    const { status, payload } = await callCheck({ verticalId: 'atlantis' });
    expect(status).toBe(404);
    expect(payload.error).toBe('unknown_vertical');
  });
});

/**
 * POST /api/groups/check/toggle — move the PICKED demo user in or out of the
 * vertical's privileged group, live in PingOne.
 *
 * The check panel's demo is a transition: take demoDelegate out, the next
 * check DENIES; add them back, it PERMITs. The signed-in toggle
 * (/membership/toggle) cannot do that — it only moves the session user. Same
 * rules apply: the write goes to the real directory, the response is the
 * post-write re-read (never the requested state), and only the three seeded
 * demo usernames are toggleable.
 */
describe('POST /api/groups/check/toggle', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => { jest.clearAllMocks(); groupPolicy._reset(); });

  async function callToggle({ body = { inGroup: true, username: 'demoDelegate', verticalId: 'banking' } } = {}) {
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/check/toggle' && l.route.methods.post,
    );
    expect(layer).toBeDefined();
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    const req = { body, session: { user: { username: 'demoUser', oauthId: 'session-user-1' } } };
    let payload = null;
    let status = 200;
    const res = {
      json: (b) => { payload = b; return res; },
      status: (c) => { status = c; return res; },
    };
    await handler(req, res, () => {});
    return { status, payload };
  }

  it('writes the PICKED user\'s membership and returns the post-write re-read', async () => {
    userLookup.fetchPingOneUserByUsername.mockResolvedValue({
      user: { id: 'picked-user-1', username: 'demoDelegate' },
      error: null,
    });
    membershipService.setUserGroupMembership.mockResolvedValue({
      changed: true, inGroup: true, groupId: 'g-1',
    });
    // Post-write re-read: the toggle took effect.
    membershipService.listUserGroupNamesForVertical.mockResolvedValue([
      groupPolicy.groupNameForCategory('banking', 'premiumTier'),
    ]);

    const { status, payload } = await callToggle({ body: { inGroup: true, username: 'demoDelegate', verticalId: 'banking' } });

    expect(status).toBe(200);
    // The write targeted the PICKED user, and the group the TOOL actually
    // requires (restrictedTools category) — not the generic privileged group.
    expect(membershipService.setUserGroupMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'demoDelegate',
        pingOneUserId: 'picked-user-1',
        groupName: groupPolicy.groupNameForCategory('banking', 'premiumTier'),
        inGroup: true,
      }),
    );
    // The response reflects the re-read, not the request.
    expect(payload.inGroup).toBe(true);
    expect(payload.verified).toBe(true);
    expect(payload.username).toBe('demoDelegate');
  });

  it('maps the service allowlist rejection to 403 (allowlist itself is tested on the service)', async () => {
    userLookup.fetchPingOneUserByUsername.mockResolvedValue({
      user: { id: 'real-user-9', username: 'curt' },
      error: null,
    });
    const refusal = new Error("refusing to change group membership for 'curt'");
    refusal.code = 'user_not_toggleable';
    membershipService.setUserGroupMembership.mockRejectedValue(refusal);

    const { status, payload } = await callToggle({ body: { inGroup: true, username: 'curt', verticalId: 'banking' } });
    expect(status).toBe(403);
    expect(payload.error).toBe('user_not_toggleable');
  });

  it('404s when the picked user does not exist', async () => {
    userLookup.fetchPingOneUserByUsername.mockResolvedValue({ user: null, error: 'not_found' });
    const { status, payload } = await callToggle({ body: { inGroup: true, username: 'nobody', verticalId: 'banking' } });
    expect(status).toBe(404);
    expect(payload.error).toBe('user_not_found');
    expect(membershipService.setUserGroupMembership).not.toHaveBeenCalled();
  });
});
