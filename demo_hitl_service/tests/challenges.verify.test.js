'use strict';

/**
 * POST /challenges/:id/verify — the receipt binding rules PingGateway relies on.
 *
 * IG's Groovy p1az-decision script cannot reuse the MCP gateway's TypeScript
 * `verifyHitlReceipt`, so it calls this endpoint instead of carrying a
 * hand-ported third copy of the rules. These tests are what stop the endpoint
 * from silently weakening: every replay vector the TS implementation rejects
 * (wrong user, wrong agent, wrong tool, changed amount, swapped payee, expired,
 * unapproved) must be rejected here too.
 *
 * Drives the real Express router the way the sibling transactionHop spec does
 * (no supertest dependency in this service).
 */

// HITL_INTERNAL_SECRET is read once at module-load time in routes/challenges.js —
// must be set before the first require.
process.env.HITL_INTERNAL_SECRET = 'test-secret';

const router = require('../src/routes/challenges');
const store = require('../src/store/challengeStore');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createChallenge(overrides) {
  return store.create(Object.assign({
    tool: 'create_transfer',
    userId: 'user-1',
    agentId: 'agent-1',
    context: { amount: 300, from_account_id: 'chk-1', to_account_id: 'sav-1' },
  }, overrides));
}

async function verify(challengeId, body) {
  const req = {
    method: 'POST',
    url: `/${challengeId}/verify`,
    headers: { 'x-hitl-internal-secret': 'test-secret' },
    body,
  };
  const res = makeRes();
  await new Promise((resolve, reject) => {
    router(req, res, (err) => (err ? reject(err) : resolve()));
    resolve();
  });
  return res;
}

/** The happy path every gated retry takes: approved receipt, identical caller + args. */
async function approvedChallenge(overrides) {
  const ch = createChallenge(overrides);
  store.resolve(ch.id, 'approved');
  return ch;
}

const MATCHING_RETRY = {
  userId: 'user-1',
  agentId: 'agent-1',
  tool: 'create_transfer',
  params: { amount: 300, from_account_id: 'chk-1', to_account_id: 'sav-1' },
};

test('an approved receipt with matching caller and args verifies', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, MATCHING_RETRY);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test('a pending (unapproved) receipt is refused', async () => {
  const ch = createChallenge();
  const res = await verify(ch.id, MATCHING_RETRY);
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/not approved/i);
});

test('a denied receipt is refused', async () => {
  const ch = createChallenge();
  store.resolve(ch.id, 'denied');
  const res = await verify(ch.id, MATCHING_RETRY);
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/not approved/i);
});

test('an unknown challenge id is refused, not 404-ed', async () => {
  // A transport-level 404 would be indistinguishable from "HITL service down"
  // at the IG call site, which must fail closed on transport errors only.
  const res = await verify('does-not-exist', MATCHING_RETRY);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/not found/i);
});

test('a receipt minted for another user is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, { ...MATCHING_RETRY, userId: 'user-2' });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/different user/i);
});

test('a receipt minted for another agent is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, { ...MATCHING_RETRY, agentId: 'agent-2' });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/different agent/i);
});

test('a receipt minted for another tool is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, { ...MATCHING_RETRY, tool: 'pay_bill' });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/different tool/i);
});

test('raising the amount after consent is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, {
    ...MATCHING_RETRY,
    params: { ...MATCHING_RETRY.params, amount: 5000 },
  });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/different amount/i);
});

test('dropping the amount from the retry is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, {
    ...MATCHING_RETRY,
    params: { from_account_id: 'chk-1', to_account_id: 'sav-1' },
  });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/missing amount/i);
});

test('a same-amount recipient swap is refused', async () => {
  const ch = await approvedChallenge();
  const res = await verify(ch.id, {
    ...MATCHING_RETRY,
    params: { ...MATCHING_RETRY.params, to_account_id: 'attacker-1' },
  });
  expect(res.body.ok).toBe(false);
  expect(res.body.message).toMatch(/different to_account_id/i);
});

test('an approved-then-expired receipt is refused', async () => {
  // The store only flips *pending* challenges to 'expired' at read time, so an
  // approved-then-aged receipt still reads as approved — the expiry check in
  // verifyReceipt is the only thing standing between it and a replay. Advance
  // the clock past the TTL (but under the 1h prune window, or the record would
  // simply be deleted and the test would pass for the wrong reason).
  const ch = await approvedChallenge();
  const realNow = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 30 * 60_000);
  try {
    const res = await verify(ch.id, MATCHING_RETRY);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/expired/i);
  } finally {
    spy.mockRestore();
  }
});

test('an approved receipt is consumed on first verify; a replayed verify is refused', async () => {
  // BUGS.md #35 — a second /verify against the same human approval must not
  // discharge a second transfer.
  const ch = await approvedChallenge();

  const first = await verify(ch.id, MATCHING_RETRY);
  expect(first.statusCode).toBe(200);
  expect(first.body).toEqual({ ok: true });

  const replay = await verify(ch.id, MATCHING_RETRY);
  expect(replay.body.ok).toBe(false);
  expect(replay.body.message).toMatch(/not approved/i);
  expect(replay.body.message).toMatch(/consumed/i);
});

test('the endpoint requires the internal secret', async () => {
  const ch = await approvedChallenge();
  const req = { method: 'POST', url: `/${ch.id}/verify`, headers: {}, body: MATCHING_RETRY };
  const res = makeRes();
  await new Promise((resolve, reject) => {
    router(req, res, (err) => (err ? reject(err) : resolve()));
    resolve();
  });
  expect(res.statusCode).toBe(401);
});
