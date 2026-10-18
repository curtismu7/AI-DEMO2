'use strict';
/** POST /api/admin/mcp-gateway/test: a refused call must still carry the gateway audit trail. */
const express = require('express');
const supertest = require('supertest');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  get: jest.fn(() => null),
  setRaw: jest.fn().mockResolvedValue(undefined),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 'tok', tokenEvents: [] })),
}));
const TRAIL = { filterChain: [{ filter: 'P1AZDecision', result: 'blocked' }], denyingFilter: 'P1AZDecision', authorize: { decision: 'DENY' } };
jest.mock('../../services/mcpGatewayClient', () => ({
  getMcpGatewayHttpUrl: () => 'https://gw.test/mcp',
  callToolViaGateway: jest.fn(async () => {
    throw Object.assign(new Error('denied'), {
      code: 'gateway_error', httpStatus: 403, gatewayErrorCode: 'access_denied', gatewayMessage: 'Denied by PingOne Authorize',
      rpcData: { decision: 'DENY' }, gwAuditTrail: TRAIL,
    });
  }),
}));

it('returns decision and gwAuditTrail on the ok:false JSON', async () => {
  const app = express();
  app.use(express.json());
  app.use('/', require('../../routes/mcpGatewayConfig'));
  const res = await supertest(app).post('/test').send({ tool: 'get_sensitive_account_details', args: {} });
  expect(res.body.ok).toBe(false);
  expect(res.body.httpStatus).toBe(403);
  expect(res.body.decision).toBe('DENY');
  expect(res.body.gwAuditTrail).toEqual(TRAIL);
});
