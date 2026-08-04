'use strict';

/**
 * GET /api/groups/decision-board — one live decision per group-gated vertical.
 *
 * The assertion that matters most is the failure one: a probe that throws must
 * render as UNKNOWN, never as PERMIT. A board that shows green when it could not
 * ask is worse than a board that shows nothing, because the whole point of the
 * page is to be evidence.
 */

jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
}));
jest.mock('../services/pingOneGroupMembershipService', () => ({
  isReady: jest.fn(() => true),
  listUserGroupNamesForVertical: jest.fn(),
  _resetCache: jest.fn(),
}));

const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const membershipService = require('../services/pingOneGroupMembershipService');
const groupPolicy = require('../services/groupPolicy');
const { verticalManifest } = require('../services/verticalManifest');

const PRIVILEGED = 'AI_Demo_Privileged';

/** Invoke the route handler directly — no supertest app wiring needed. */
// Required ONCE, at module load. Calling jest.resetModules() per-invocation
// re-requires the router against the REAL services and silently discards these
// mocks — the lazy-require/resetModules trap this repo has hit before.
const router = require('../routes/groupMembership');

async function callBoard({ groups = [PRIVILEGED], evaluate } = {}) {
  membershipService.isReady.mockReturnValue(true);
  membershipService.listUserGroupNamesForVertical.mockResolvedValue(groups);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockImplementation(
    evaluate || (async () => ({ decision: 'PERMIT', raw: { statements: [{ code: 'mcp-tool-authorized' }] } })),
  );

  const layer = router.stack.find(
    (l) => l.route && l.route.path === '/decision-board' && l.route.methods.get,
  );
  expect(layer).toBeDefined();
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const req = { session: { user: { username: 'demoUser', oauthId: 'user-1' } } };
  let payload = null;
  let status = 200;
  const res = {
    json: (b) => { payload = b; return res; },
    status: (c) => { status = c; return res; },
  };
  await handler(req, res, () => {});
  return { status, payload };
}

describe('GET /api/groups/decision-board', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => { jest.clearAllMocks(); groupPolicy._reset(); });

  it('returns one row per group-gated vertical, from the manifests', async () => {
    const { payload } = await callBoard();
    expect(payload.rows.length).toBeGreaterThanOrEqual(9);
    for (const r of payload.rows) {
      expect(r.tool).toBeTruthy();
      expect(r.requiredGroup).toBe(PRIVILEGED);
      expect(r.verticalId).toBeTruthy();
    }
  });

  it('reports UNKNOWN — never PERMIT — when the decision call throws', async () => {
    // The regression this test exists for. `decision` is rendered directly, so a
    // thrown probe that fell through as PERMIT would paint the board green while
    // proving nothing.
    const { payload } = await callBoard({
      evaluate: async () => { throw new Error('PingOne unreachable'); },
    });
    expect(payload.rows.length).toBeGreaterThan(0);
    for (const r of payload.rows) {
      expect(r.decision).toBe('UNKNOWN');
      expect(r.decision).not.toBe('PERMIT');
      expect(r.error).toMatch(/unreachable/);
    }
  });

  it('marks inRequiredGroup false when the user holds no privileged group', async () => {
    const { payload } = await callBoard({ groups: ['AI_Demo_Delegates'] });
    for (const r of payload.rows) expect(r.inRequiredGroup).toBe(false);
  });

  it('marks inRequiredGroup true when the user holds it', async () => {
    const { payload } = await callBoard({ groups: [PRIVILEGED] });
    for (const r of payload.rows) expect(r.inRequiredGroup).toBe(true);
  });

  it('surfaces the statement codes — a bare decision cannot identify the rule', async () => {
    const { payload } = await callBoard({
      evaluate: async () => ({
        decision: 'DENY',
        raw: { statements: [{ code: 'mcp-authorization-denied' }, { code: 'mcp-user-not-in-group' }] },
      }),
    });
    expect(payload.rows[0].codes).toEqual(['mcp-authorization-denied', 'mcp-user-not-in-group']);
  });

  it('passes the user\'s REAL groups to the decision, not the manifest', async () => {
    await callBoard({ groups: [PRIVILEGED] });
    const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
    expect(args.userGroups).toEqual([PRIVILEGED]);
    expect(args.inRequiredGroup).toBe(true);
    expect(args.requiredGroup).toBe(PRIVILEGED);
  });
});
