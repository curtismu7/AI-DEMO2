'use strict';

/**
 * GET /api/groups/decision-board — PingOne rate-limit handling.
 *
 * The board asks PingOne Authorize once per group-gated vertical (~13). Issued
 * as one Promise.all burst, PingOne throttled it: the first two returned real
 * decisions and every later one came back 429, so the board rendered 11 UNKNOWN
 * rows. Found by driving the live page with the flag on — the demo the page
 * exists for could not be shown.
 *
 * These pin the two halves of the fix: requests are serialized, and a 429 is
 * retried rather than surfaced as UNKNOWN.
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
const router = require('../routes/groupMembership');

async function callBoard(evaluate) {
  membershipService.isReady.mockReturnValue(true);
  membershipService.listUserGroupNamesForVertical.mockResolvedValue([]);
  pingOneAuthorizeService.evaluateMcpToolDelegation.mockImplementation(evaluate);

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

describe('decision-board rate limiting', () => {
  beforeAll(() => { verticalManifest.init(); });
  beforeEach(() => { jest.clearAllMocks(); groupPolicy._reset(); });

  it('issues decisions one at a time, never as a parallel burst', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const payload = await callBoard(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { decision: 'DENY', raw: { statements: [{ code: 'mcp-user-not-in-group' }] } };
    });

    // The bug was maxInFlight === rows.length. Serial means never more than one.
    expect(maxInFlight).toBe(1);
    expect(payload.rows.length).toBeGreaterThanOrEqual(9);
  });

  it('retries a 429 instead of leaving the row UNKNOWN', async () => {
    const seen = new Map();
    const payload = await callBoard(async ({ verticalId }) => {
      const n = (seen.get(verticalId) || 0) + 1;
      seen.set(verticalId, n);
      // Throttle the first attempt for every vertical, succeed on the retry.
      if (n === 1) {
        throw new Error('PingOne Authorize decision endpoint evaluation failed (429): rate limited');
      }
      return { decision: 'DENY', raw: { statements: [{ code: 'mcp-user-not-in-group' }] } };
    });

    expect(payload.rows.length).toBeGreaterThanOrEqual(9);
    for (const row of payload.rows) {
      expect(row.decision).toBe('DENY');
      expect(row.codes).toContain('mcp-user-not-in-group');
    }
  }, 20000);

  it('does NOT retry a non-429 failure — it stays UNKNOWN immediately', async () => {
    let calls = 0;
    const payload = await callBoard(async () => {
      calls += 1;
      throw new Error('policy_not_found');
    });

    // One attempt per row, no wasted retries on an answer that will not change.
    expect(calls).toBe(payload.rows.length);
    for (const row of payload.rows) {
      expect(row.decision).toBe('UNKNOWN');
    }
  });
});
