'use strict';

/**
 * Regression (2026-09-08 Demo Steps review): `_denyFromGateway` relabelled ANY
 * gateway error with the sim's canonical security code, so a gateway that was
 * down (503 GATEWAY_UNREACHABLE) rendered as "401 DENY — PingOne Authorize DENY
 * — token audience does not match the gateway resource". Only a 401/403 can be
 * the control the sim proves; anything else is the sim failing to run and must
 * keep its raw status/code. And "PingOne Authorize DENY" is only true when
 * Authorize actually answered (an `authorize` audit record exists).
 */

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => undefined),
  setRaw: jest.fn(async () => {}),
}));

const { __test } = require('../services/attackSimulatorService');
const { _denyFromGateway, _nodeGatewayUrl } = __test;

function deny(err) {
  return _denyFromGateway('replayed-token', 'replayed-token', [], err, 401, 'invalid_aud', 'Gateway DENY (invalid_aud)');
}

describe('_denyFromGateway keeps infrastructure failures out of the security tier', () => {
  test('a 401 from the gateway takes the canonical code and a Gateway (not Authorize) prefix', () => {
    const r = deny(Object.assign(new Error('aud mismatch'), { code: 'GATEWAY_AUDIENCE_MISMATCH', httpStatus: 401 }));
    expect(r.status).toBe(401);
    expect(r.errorCode).toBe('invalid_aud');
    expect(r.reason).toMatch(/^Gateway DENY — token audience/);
    expect(r.authorize).toBeUndefined();
  });

  test('an error with no status falls back to the sim status (BFF-side audience check)', () => {
    const r = deny(Object.assign(new Error('aud mismatch'), { code: 'GATEWAY_AUDIENCE_MISMATCH' }));
    expect(r.status).toBe(401);
    expect(r.errorCode).toBe('invalid_aud');
  });

  test('a gateway that is DOWN keeps its raw 503 and code — never "401 DENY"', () => {
    const r = deny(Object.assign(new Error('connect ECONNREFUSED'), { code: 'GATEWAY_UNREACHABLE', httpStatus: 503 }));
    expect(r.status).toBe(503);
    expect(r.errorCode).toBe('GATEWAY_UNREACHABLE');
    expect(r.reason).not.toMatch(/DENY —/);
  });

  test('a schema 400 keeps its raw status', () => {
    const r = deny(Object.assign(new Error('missing from_account_id'), { code: 'gateway_bad_request', httpStatus: 400 }));
    expect(r.status).toBe(400);
    expect(r.errorCode).toBe('gateway_bad_request');
  });
});

describe('_nodeGatewayUrl', () => {
  const PREV = process.env.MCP_DEMO_GATEWAY_URL;
  afterEach(() => {
    if (PREV === undefined) delete process.env.MCP_DEMO_GATEWAY_URL;
    else process.env.MCP_DEMO_GATEWAY_URL = PREV;
  });

  test('prefers the Demo Agent Gateway URL over the active-gateway resolver', () => {
    process.env.MCP_DEMO_GATEWAY_URL = 'http://mcp-gateway:3005/';
    expect(_nodeGatewayUrl()).toBe('http://mcp-gateway:3005');
  });
});
