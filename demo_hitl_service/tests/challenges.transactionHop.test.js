'use strict';

/**
 * Task 9 wiring gap (Important finding): the only tests exercising transaction-hop
 * emission drove emitHop() in isolation (transactionHop.test.js) or the challenge
 * store in isolation (challengeCorrelation.test.js). Nothing proved that a real
 * POST /:id/respond request produces a hop carrying the right correlationId,
 * params, and decision.outcome — the ONLY parameter-level binding a later task's
 * INV-7 invariant relies on.
 *
 * This file drives the actual Express router exported by routes/challenges.js
 * (request in, JSON response out), wrapped in the same correlationMiddleware the
 * production app.use()s ahead of the router (see src/index.js), with a fetch
 * double injected via transactionHop.__setFetchForTests. Follows the technique
 * from demo_authz_server/tests/decision.transactionHop.test.js, adapted to this
 * service's jest runner (no supertest dependency added).
 *
 * Also covers the Minor finding: a challenge resolved without a correlationId
 * must emit NO hop — the respond handler must not fall back to the per-request
 * ALS id (which correlationMiddleware fabricates fresh for every request that
 * doesn't supply one), or the hop would be stamped with an unrelated id and
 * render as an orphan transaction in the UI.
 */

// HITL_INTERNAL_SECRET is read once at module-load time in routes/challenges.js —
// must be set before the first require.
process.env.HITL_INTERNAL_SECRET = 'test-secret';

const router = require('../src/routes/challenges');
const store = require('../src/store/challengeStore');
const { correlationMiddleware } = require('../src/correlationMiddleware');
const { __setFetchForTests } = require('../src/transactionHop');

let calls;

beforeEach(() => {
  calls = [];
  process.env.BFF_TRANSACTION_HOP_URL = 'http://bff/internal/transaction-hop';
  process.env.BFF_INTERNAL_SECRET = 'sekrit';
  __setFetchForTests(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true };
  });
});

afterEach(() => {
  __setFetchForTests(undefined);
  delete process.env.BFF_TRANSACTION_HOP_URL;
  delete process.env.BFF_INTERNAL_SECRET;
});

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
    context: { amount: 500, to_account_id: 'acc-42' },
    correlationId: 'chain-cid-1',
  }, overrides));
}

// Drives POST /challenges/:id/respond through the SAME middleware chain
// production uses: correlationMiddleware (which fabricates a random id in ALS
// whenever the request carries none) then the challenges router. Neither the
// header nor the body here carries a correlationId, matching how the
// dashboard/webhook actually calls this endpoint — only { decision } is sent.
async function respond(challengeId, decision, respondedBy) {
  const req = {
    method: 'POST',
    url: `/${challengeId}/respond`,
    headers: { 'x-hitl-internal-secret': 'test-secret' },
    body: respondedBy === undefined ? { decision } : { decision, respondedBy },
  };
  const res = makeRes();
  await new Promise((resolve, reject) => {
    correlationMiddleware(req, res, () => {
      router(req, res, (err) => (err ? reject(err) : resolve()));
      resolve();
    });
  });
  // Flush the fire-and-forget emitHop() fetch call.
  await new Promise((r) => setImmediate(r));
  return res;
}

test('an approved response emits exactly one hop with phase/service/outcome=permit', async () => {
  const ch = createChallenge();
  const res = await respond(ch.id, 'approved');
  expect(res.statusCode).toBe(200);
  expect(calls).toHaveLength(1);
  const hop = calls[0].body;
  expect(hop.phase).toBe('hitl.consent');
  expect(hop.service).toBe('hitl-service');
  expect(hop.decision.outcome).toBe('permit');
});

test('a denied response emits a hop with outcome=deny', async () => {
  const ch = createChallenge();
  const res = await respond(ch.id, 'denied');
  expect(res.statusCode).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].body.decision.outcome).toBe('deny');
});

test("the hop's correlationId is the challenge's, not the ALS-fabricated request id", async () => {
  const ch = createChallenge({ correlationId: 'chain-cid-distinct' });
  await respond(ch.id, 'approved');
  expect(calls).toHaveLength(1);
  expect(calls[0].body.correlationId).toBe('chain-cid-distinct');
});

test("the hop's params deep-equal the challenge's context (amount + to_account_id)", async () => {
  const context = { amount: 750, to_account_id: 'acc-99' };
  const ch = createChallenge({ context });
  await respond(ch.id, 'approved');
  expect(calls).toHaveLength(1);
  expect(calls[0].body.params).toEqual(context);
});

test('the HTTP response body is unaffected even when hop emission fails', async () => {
  __setFetchForTests(async () => { throw new Error('network down'); });
  const ch = createChallenge();
  const res = await respond(ch.id, 'approved');
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ challengeId: ch.id, status: 'approved', decision: 'approved' });
});

test('a failed resolve (409, responding twice) emits no additional hop', async () => {
  const ch = createChallenge();
  const first = await respond(ch.id, 'approved');
  expect(first.statusCode).toBe(200);
  expect(calls).toHaveLength(1);

  const second = await respond(ch.id, 'denied');
  expect(second.statusCode).toBe(409);
  expect(calls).toHaveLength(1); // no new hop from the failed second resolve
});

test('respondedBy sent in the request body is persisted on the resolved challenge', async () => {
  const ch = createChallenge();
  const res = await respond(ch.id, 'approved', 'admin-user-7');
  expect(res.statusCode).toBe(200);
  expect(store.get(ch.id).responderId).toBe('admin-user-7');
});

test('a challenge with no correlationId emits no hop (does not fabricate one from ALS)', async () => {
  const ch = createChallenge({ correlationId: undefined });
  expect(ch.correlationId).toBeNull();
  const res = await respond(ch.id, 'approved');
  expect(res.statusCode).toBe(200);
  expect(calls).toHaveLength(0);
});
