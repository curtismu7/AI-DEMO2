'use strict';

/**
 * Ruling 1 guard — the JSON-RPC mount MUST build its request handler per
 * request.
 *
 * A handler built once at startup cannot see the inbound bearer, the session or
 * the validated claims, so every real call degrades to `a2a_no_subject_token`.
 * A directly-constructed executor (tests/a2aSpecialistExecutor.test.js) passes
 * either way, and a router test that sends no tool in its message metadata
 * returns `not_authorized_for_skill` either way — so only driving the router
 * over HTTP *with* a tool catches a revert to startup construction.
 */

jest.mock('../services/tokenValidationService', () => ({ validateToken: jest.fn() }));
// The bearer gate never threads a cfg into verifyA2aBearer, so it falls back to
// the real configStore singleton, which has no checked-in generalist client id
// (a credential). Without this, the actor check fails whatever the claim shape.
jest.mock('../services/configStore', () => ({
  getEffective: (key) => (key === 'pingone_ai_agent_client_id' ? 'generalist-agent' : ''),
}));
jest.mock('../services/a2aDelegationService', () => ({
  ...jest.requireActual('../services/a2aDelegationService'),
  exchangeAsSpecialist: jest.fn(),
}));
jest.mock('../services/bffMcpToolExecutor', () => ({ executeBffToolWithToken: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { validateToken } = require('../services/tokenValidationService');
const { exchangeAsSpecialist } = require('../services/a2aDelegationService');
const { executeBffToolWithToken } = require('../services/bffMcpToolExecutor');
const { createA2aProtocolRouter } = require('../services/a2aProtocolServer');
const { specialistForVertical } = require('../config/a2aSpecialists');

const TOOL = specialistForVertical('investment').tools[0];

// 'investment' → appKey 'holdings'; its intermediate audience has a real
// checked-in fallback in scope-topology.json.
const CLAIMS = {
  sub: 'user-1',
  aud: ['a2a-intermediate-holdings.ping.demo'],
  scope: 'agent:invoke:holdings',
  act: { client_id: 'generalist-agent' },
};

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function buildApp() {
  const app = express();
  app.use(
    '/a2a/specialists',
    createA2aProtocolRouter({ configStore: { getEffective: () => 'https://api.ping.demo:3001' } }),
  );
  return app;
}

function sendMessage(app, bearer) {
  return request(app)
    .post('/a2a/specialists/investment')
    .set('Authorization', `Bearer ${bearer}`)
    .set('A2A-Version', '1.0')
    .send({
      jsonrpc: '2.0',
      id: 'ruling1-send',
      method: 'SendMessage',
      params: {
        message: {
          messageId: 'ruling1-message-1',
          role: 'ROLE_USER',
          parts: [{ text: 'review my holdings' }],
          metadata: { vertical: 'investment', tool: TOOL },
        },
      },
    });
}

describe('A2A JSON-RPC mount builds the handler per request (Ruling 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateToken.mockResolvedValue(CLAIMS);
    exchangeAsSpecialist.mockResolvedValue({
      token: 'T.NESTED',
      claims: { sub: 'user-1' },
      actChainDepth: 2,
      scopes: ['holdings:read'],
    });
    executeBffToolWithToken.mockResolvedValue(JSON.stringify({ holdings: [{ symbol: 'VTI' }] }));
  });

  test('the live request reaches the executor, which replies with real data', async () => {
    const bearer = fakeJwt(CLAIMS);
    const res = await sendMessage(buildApp(), bearer);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();

    const payload = JSON.parse(res.body.result.message.parts[0].text);
    // A handler built at startup has no bearer, so this would be
    // { result: null, toolError: 'a2a_no_subject_token' }.
    expect(payload.toolError).toBeNull();
    expect(payload.result).toEqual({ holdings: [{ symbol: 'VTI' }] });

    // Exchange #2's subject IS the inbound bearer — only reachable if the
    // executor saw this request.
    expect(exchangeAsSpecialist).toHaveBeenCalledWith(
      bearer,
      expect.objectContaining({ vertical: 'investment', tool: TOOL }),
    );
    // suppliedUserSub comes from the claims the bearer gate validated onto req.
    expect(executeBffToolWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: TOOL, suppliedToken: 'T.NESTED', suppliedUserSub: 'user-1' }),
    );

    expect(res.body.result.message.metadata).toMatchObject({
      vertical: 'investment',
      specialist: specialistForVertical('investment').specialistName,
      actChainDepth: 2,
      demoLayer: 'a2a-protocol-wire',
    });
    // No credential crosses the wire.
    expect(JSON.stringify(res.body)).not.toMatch(/T\.NESTED/);
  });

  test('the bearer gate still runs first: no Authorization, no executor call', async () => {
    const res = await request(buildApp())
      .post('/a2a/specialists/investment')
      .set('A2A-Version', '1.0')
      .send({ jsonrpc: '2.0', id: 'no-auth', method: 'SendMessage', params: { message: { messageId: 'm', role: 'ROLE_USER', parts: [{ text: 'x' }] } } });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(exchangeAsSpecialist).not.toHaveBeenCalled();
  });
});
