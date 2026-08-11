// demo_api_server/tests/agentRun.publicCatalog.regression.test.js
'use strict';

// Regression: the UC24 public catalog must never be answered by the LLM.
//
// routes/agentRun.js listed branch_hours in PUBLIC_GUEST_ACTIONS, but that set only
// decides AUTHORIZATION ("may a signed-out caller run this?"). Nothing DISPATCHED it,
// so "branches near me" fell through to the agent service and the model improvised —
// observed live: it asked the guest for the email on their "Great Buy" account while
// the vertical picker read "Super Banking". The deterministic handler lives on the
// other agent route (dispatchBankingAction), which /api/agent/run never calls, so the
// location cards only ever appeared in Heuristics mode.
//
// These assert the short-circuit: catalog text + locationCards on the stream, and the
// agent service (http.request) never contacted.

const express = require('express');
const request = require('supertest');
const http = require('http');

jest.mock('../services/configStore', () => ({
  getEffective: (k) => (k === 'ff_agui_enabled' ? 'true' : ''),
  get: () => undefined,
}));

jest.mock('../middleware/nrTransactionMiddleware', () => ({
  nrTransactionMiddleware: (_req, _res, next) => next(),
}));

jest.mock('../services/promptGuard', () => ({ guardPromptInput: () => null }));

let mockActiveVertical = 'banking';
jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: { activeIdFor: () => mockActiveVertical, resolve: () => null },
  },
}));

jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (_req, _res, next) => next(),
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.agentContext = {}; // signed-out: no userId / accessToken
    req.session = { save: (cb) => cb && cb() };
    next();
  });
  app.use('/api/agent', require('../routes/agentRun'));
  return app;
}

function post(body) {
  return request(makeApp()).post('/api/agent/run').send(body);
}

function runBody(content) {
  return { threadId: 't1', runId: 'r1', messages: [{ role: 'user', content }] };
}

/** Pull the parsed `data:` SSE frames out of a response body. */
function frames(text) {
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)));
}

// Only the agent-service call carries x-internal-gateway-secret, so match on that
// and let every other http.request through — supertest itself uses http.request to
// drive these tests, and stubbing it wholesale breaks the client.
let agentCalls;
let httpSpy;
beforeEach(() => {
  mockActiveVertical = 'banking';
  agentCalls = [];
  const realRequest = http.request;
  httpSpy = jest.spyOn(http, 'request').mockImplementation((opts, ...rest) => {
    if (opts && opts.headers && opts.headers['x-internal-gateway-secret'] !== undefined) {
      agentCalls.push(opts);
      const stub = { on: () => stub, setTimeout: () => stub, write: () => stub, end: () => stub, destroy: () => stub };
      return stub;
    }
    return realRequest.call(http, opts, ...rest);
  });
});
afterEach(() => httpSpy.mockRestore());

describe('agentRun — UC24 public catalog short-circuit', () => {
  test('a guest asking for branches gets catalog cards, not an LLM turn', async () => {
    const res = await post(runBody('branches near me'));
    expect(res.status).toBe(200);

    const evts = frames(res.text);
    const end = evts.find((e) => e.type === 'TEXT_MESSAGE_END');
    expect(end).toBeDefined();
    expect(Array.isArray(end.locationCards)).toBe(true);
    expect(end.locationCards.length).toBeGreaterThan(0);
    // Every card carries what ProductCardGrid renders.
    for (const c of end.locationCards) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.address).toBe('string');
    }
    // The whole point: the model was never asked.
    expect(agentCalls).toHaveLength(0);
  });

  test('emits the Act 1 token events so the chain shows what was skipped', async () => {
    // The teaching point of UC24 is that this turn deliberately skips PingOne
    // Authorize AND the RFC 8693 exchange. The first cut of the short-circuit
    // emitted no token events at all, so the chain rendered empty and the step
    // looked untraced rather than intentionally cheap.
    const res = await post(runBody('branches near me'));
    const snap = frames(res.text).find((e) => e.type === 'STATE_SNAPSHOT');
    expect(snap).toBeDefined();
    const evts = snap.snapshot.tokenEvents || [];
    const byId = Object.fromEntries(evts.map((e) => [e.id, e]));
    expect(Object.keys(byId)).toEqual(
      expect.arrayContaining(['token-exchange', 'authorize-decision', 'tool-dispatched']),
    );
    // The two that must read as deliberately skipped, not as failures.
    expect(byId['token-exchange'].status).toBe('skipped');
    expect(byId['authorize-decision'].status).toBe('skipped');
    // The catalog read itself did happen.
    expect(byId['tool-dispatched'].status).toBe('success');
  });

  test('the reply text comes from the catalog, and never asks for an account', async () => {
    const res = await post(runBody('branches near me'));
    const content = frames(res.text).find((e) => e.type === 'TEXT_MESSAGE_CONTENT');
    expect(content.delta).toMatch(/branch/i);
    expect(content.delta).not.toMatch(/email/i);
  });

  test('cards are scoped to the active vertical — no cross-vertical brand leak', async () => {
    mockActiveVertical = 'sporting-goods';
    const res = await post(runBody('stores near me'));
    const end = frames(res.text).find((e) => e.type === 'TEXT_MESSAGE_END');
    const names = end.locationCards.map((c) => c.name).join(' | ');
    expect(names).toMatch(/Super Sports/);
    expect(names).not.toMatch(/Super Banking/);
    expect(agentCalls).toHaveLength(0);
  });

  test('a non-catalog prompt still falls through to the agent service', async () => {
    // Guard against the short-circuit swallowing ordinary traffic. A signed-out
    // caller is rejected before dispatch, which is itself proof we did not answer.
    const res = await post(runBody('transfer 500 dollars to savings'));
    expect(res.status).toBe(401);
    expect(res.body.need_auth).toBe(true);
  });
});
