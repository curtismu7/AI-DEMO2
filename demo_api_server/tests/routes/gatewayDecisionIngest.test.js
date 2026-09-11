'use strict';

const express = require('express');
const request = require('supertest');
const agentGatewayDecisions = require('../../services/agentGatewayDecisions');
const router = require('../../routes/gatewayDecisionIngest');

const SECRET = process.env.BFF_INTERNAL_SECRET || 'dev-shared-secret-change-me';

function app() {
  const a = express();
  a.use('/internal', router);
  return a;
}

// Shape of the trail p1az-decision.groovy posts for a third-party app's plain SSO
// token: no actor, so real PingOne Authorize denies with mcp-invalid-actor.
const DENY_TRAIL = {
  introspection: {
    active: true,
    sub: 'user-1',
    scope: 'openid profile gateway:mcp:invoke',
    iss: 'https://auth.pingone.com/env/as',
    client_id: 'onyx-app',
    aud: 'https://api.ping.demo:3036/mcp',
    email: 'demo@example.com',
  },
  authorize: {
    decision: 'DENY',
    backend: 'real',
    method: 'initialize',
    tool: '',
    statements: [{ code: 'mcp-invalid-actor', payload: '{"message":"not a registered actor"}' }],
  },
  mcpAudit: { who: { userSub: 'user-1', agentSub: null } },
};

describe('POST /internal/gateway-decision', () => {
  beforeEach(() => { agentGatewayDecisions.clear(); });

  test('403 without the internal secret, and nothing is recorded', async () => {
    const res = await request(app()).post('/internal/gateway-decision').send(DENY_TRAIL);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(agentGatewayDecisions.recent()).toHaveLength(0);
  });

  test('403 with a wrong secret', async () => {
    const res = await request(app())
      .post('/internal/gateway-decision')
      .set('x-internal-gateway-secret', 'nope')
      .send(DENY_TRAIL);
    expect(res.status).toBe(403);
    expect(agentGatewayDecisions.recent()).toHaveLength(0);
  });

  test('204 and records who called, with which token, and why it was denied', async () => {
    const res = await request(app())
      .post('/internal/gateway-decision')
      .set('x-internal-gateway-secret', SECRET)
      .send(DENY_TRAIL);
    expect(res.status).toBe(204);
    const [entry] = agentGatewayDecisions.recent();
    expect(entry).toEqual(expect.objectContaining({
      decision: 'DENY',
      backend: 'real',
      method: 'initialize',
      sub: 'user-1',
      clientId: 'onyx-app',
      aud: 'https://api.ping.demo:3036/mcp',
      scope: 'openid profile gateway:mcp:invoke',
      iss: 'https://auth.pingone.com/env/as',
      email: 'demo@example.com',
      actor: '',
    }));
    expect(entry.statements[0].code).toBe('mcp-invalid-actor');
  });

  test('records the delegated agent as the actor when the token has one', async () => {
    await request(app())
      .post('/internal/gateway-decision')
      .set('x-internal-gateway-secret', SECRET)
      .send({ ...DENY_TRAIL, mcpAudit: { who: { userSub: 'user-1', agentSub: 'agent-7' } } });
    expect(agentGatewayDecisions.recent()[0].actor).toBe('agent-7');
  });

  test('400 when the body has no authorize block', async () => {
    const res = await request(app())
      .post('/internal/gateway-decision')
      .set('x-internal-gateway-secret', SECRET)
      .send({ introspection: {} });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_trail' });
    expect(agentGatewayDecisions.recent()).toHaveLength(0);
  });
});
