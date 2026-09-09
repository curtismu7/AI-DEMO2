'use strict';

/**
 * /api/agent/invoke must return token events tagged with the run's useCaseId.
 *
 * The gateway-dispatched chains are tagged deeper (bffMcpToolExecutor, and the
 * /api/mcp/tool path in server.js). A run whose tool never takes that path —
 * get_branch_hours (UC24), the A2A delegate_to_specialist chain (UC2, UC2.5,
 * UC2.6, UC37) — reached the client with NOTHING tagged. The UI's
 * ProofOfEnforcementContext.firstUseCaseId() then found no call-scoped
 * useCaseId, filed no verdict for the run, and ProofStrip rendered nothing:
 * the tool ran correctly and the proof surface was simply absent. Observed
 * live on ai-demo.ping-devops.com 2026-09-08.
 *
 * This asserts the backfill at the route's single exit, so the guarantee holds
 * for every dispatch path rather than the ones that happen to tag themselves.
 */

const express = require('express');
const request = require('supertest');

// Untagged events, shaped like the A2A / branch-hours chains that reach the
// route with no useCaseId of their own. `user-token` is a session card and
// must stay untagged (stamping it makes every later run inherit this run's
// identity — see services/useCaseTagging.js).
const UNTAGGED_EVENTS = [
  { id: 'user-token', label: 'User access token' },
  { id: 'a2a-agent1-actor', label: 'Agent 1 actor' },
  { id: 'a2a-exchange1', label: 'Exchange #1' },
  { type: 'mcp_challenge', phase: 'tools/call' },
  { id: 'personal-agent-lookup', useCaseId: 'already-tagged' },
];

jest.mock('../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async () => ({
    reply: 'Delegation complete.',
    success: true,
    toolsCalled: ['delegate_to_specialist'],
    tokenEvents: JSON.parse(JSON.stringify([
      { id: 'user-token', label: 'User access token' },
      { id: 'a2a-agent1-actor', label: 'Agent 1 actor' },
      { id: 'a2a-exchange1', label: 'Exchange #1' },
      { type: 'mcp_challenge', phase: 'tools/call' },
      { id: 'personal-agent-lookup', useCaseId: 'already-tagged' },
    ])),
  })),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => next(),
  optionalAuthenticateToken: (req, _res, next) => {
    req.user = { sub: 'test-sub' };
    next();
  },
}));

jest.mock('../middleware/agentSessionMiddleware', () => ({
  agentGuestSessionMiddleware: (req, _res, next) => {
    req.session = req.session || { active_vertical: 'sporting-goods' };
    next();
  },
  agentSessionMiddleware: (req, _res, next) => next(),
}));

let app;
beforeAll(() => {
  const router = require('../routes/agentInvokeRoute');
  app = express();
  app.use(express.json());
  app.use('/api', router);
});

describe('/api/agent/invoke useCaseId backfill', () => {
  test('tags every call-scoped token event with the requested useCaseId', async () => {
    const res = await request(app)
      .post('/api/agent/invoke')
      .send({
        prompt: 'show my sensitive membership details',
        useCaseId: 'a2a-delegation',
        vertical: 'sporting-goods',
      });

    expect(res.status).toBe(200);
    const events = res.body.tokenEvents || [];
    expect(events.length).toBeGreaterThan(0);

    const byId = (id) => events.find((e) => e.id === id);
    // The whole point: a call-scoped event the deeper emitters never tagged
    // now carries the slug, so firstUseCaseId() can file a verdict.
    expect(byId('a2a-agent1-actor').useCaseId).toBe('a2a-delegation');
    expect(byId('a2a-exchange1').useCaseId).toBe('a2a-delegation');
    expect(byId('a2a-exchange1').vertical).toBe('sporting-goods');
    // Session cards outlive the run — tagging one makes every later run
    // inherit this scenario's identity.
    expect(byId('user-token').useCaseId).toBeUndefined();
    // A tag a deeper emitter already applied is never overwritten.
    expect(byId('personal-agent-lookup').useCaseId).toBe('already-tagged');
  });

  test('a run with no useCaseId is left untagged rather than mislabelled', async () => {
    const res = await request(app)
      .post('/api/agent/invoke')
      .send({ prompt: 'my gear', vertical: 'sporting-goods' });

    expect(res.status).toBe(200);
    const events = res.body.tokenEvents || [];
    expect(events.find((e) => e.id === 'a2a-agent1-actor').useCaseId).toBeUndefined();
    // vertical is still backfilled — it is what disambiguates a shared slug.
    expect(events.find((e) => e.id === 'a2a-agent1-actor').vertical).toBe('sporting-goods');
  });
});

// Keeps the fixture honest: the source events carry no useCaseId except the
// one deliberately pre-tagged, so a green test can't come from the fixture.
test('fixture sanity — source events are untagged', () => {
  expect(UNTAGGED_EVENTS.filter((e) => e.useCaseId)).toHaveLength(1);
});
