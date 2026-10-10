'use strict';

/**
 * AuthZEN (Shared Authorization API / draft-ietf-authzen-authz-api) mock
 * endpoint on the Demo Agent Gateway: POST /access-eval.
 *
 * Coverage plan row "AuthZEN" — MOCK: expose the gateway's Authorize decision
 * as an AuthZEN-shaped evaluation so the interop standard has a demo surface.
 * The endpoint is a MOCK in the AuthZEN sense too: it answers from the
 * gateway's own policy state (p1azEnabled) rather than calling a real external
 * PDP — the shape is the standard's, the decision engine is the demo's.
 *
 * Request  (AuthZEN draft §5):  { subject: {type, id}, resource: {type, id}, action: {name}, context? }
 * Response (AuthZEN draft §5):  decisionId-echo, { decision: 'permit'|'deny' } — the demo adds
 * a `reason` for the teach panel.
 */

import request from 'supertest';
import type { GatewayConfig } from '../src/config';

jest.mock('../src/proxy', () => ({ proxyJsonRpc: jest.fn() }));

const stubConfig = {
  port: 0,
  host: '127.0.0.1',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: 'https://mcp-gateway.example.com',
  mcpOlbWsUrl: 'ws://localhost:8080',
  mcpResourceServerWsUrl: 'ws://localhost:8081',
  mcpOlbResourceUri: 'https://mcp-olb.example.com',
  mcpResourceServerResourceUri: 'https://mcp-resource-server.example.com',
  pingAuthorizeEndpoint: 'http://localhost:9001',
  pingAuthorizeWorkerId: 'mcp-gateway',
  p1azEnabled: false,
  hitlServiceUrl: 'http://localhost:9999',
  devBypass: false,
  requireActForAgentTools: false,
  intentTokenRequired: false,
  requireRarIntent: false,
  rateLimitEnabled: false,
  rateLimitMaxRequests: 20,
  rateLimitWindowMs: 60000,
  introspectionSimDown: false,
  jwksSimDown: false,
  introspectionEnabled: true,
  introspectionEndpoint: 'https://auth.example.com/introspect',
  introspectionClientId: '',
  introspectionClientSecret: '',
  enterpriseManagedMcpAuth: false,
} as unknown as GatewayConfig;

const EVAL_BODY = {
  subject: { type: 'user', id: 'user-1' },
  resource: { type: 'account', id: 'acc-1' },
  action: { name: 'read' },
};

describe('POST /access-eval — AuthZEN-shaped decision mock', () => {
  let gateway: import('../src/server/GatewayServer').GatewayServer;

  beforeEach(async () => {
    jest.resetModules();
    gateway = new (require('../src/server/GatewayServer').GatewayServer)({
      config: { ...stubConfig },
      upstreamMcpUrl: 'http://127.0.0.1:19999',
    });
    await gateway.start(0, '127.0.0.1');
  });

  afterEach(async () => {
    await gateway.close();
  });

  test('answers a well-formed request with decision permit/deny + evaluationId', async () => {
    const res = await request(gateway.httpServer)
      .post('/access-eval')
      .send(EVAL_BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.decision).toBe('string');
    expect(['permit', 'deny']).toContain(res.body.decision);
    expect(typeof res.body.evaluationId).toBe('string');
  });

  test('rejects a malformed request (missing subject) with 400', async () => {
    const res = await request(gateway.httpServer)
      .post('/access-eval')
      .send({ resource: { type: 'account', id: 'x' }, action: { name: 'read' } });
    expect(res.status).toBe(400);
  });

  test('exposes no admin surface without the internal secret (POST only, read-only decision)', async () => {
    const res = await request(gateway.httpServer).get('/access-eval');
    expect(res.status).toBe(405);
  });
});
