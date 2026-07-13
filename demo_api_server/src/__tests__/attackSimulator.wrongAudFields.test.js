'use strict';
/**
 * Structural (mocked) coverage of _runWrongAud's new triedAudience/allowedAudience
 * fields — no live PingOne/gateway credentials needed. Complements the existing
 * ATTACK_SIM_REAL_API-gated test in attackSimulator.test.js, which only runs
 * against a live stack.
 */

const mockPerformTokenExchange = jest.fn();
const mockCallToolViaGateway = jest.fn();

jest.mock('../../services/oauthService', () => ({
  performTokenExchange: (...args) => mockPerformTokenExchange(...args),
}));

jest.mock('../../services/mcpGatewayClient', () => ({
  callToolViaGateway: (...args) => mockCallToolViaGateway(...args),
  getMcpGatewayHttpUrl: () => 'http://mcp-gateway:3005',
}));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'pingone_resource_mcp_gateway_uri') return 'https://mcp-gateway.example.com';
    if (key === 'pingone_resource_mcp_server_uri') return 'https://mcp-server.example.com';
    return null;
  }),
}));

const { runAttackSim } = require('../../services/attackSimulatorService');

// A syntactically well-formed (unsigned) JWT so decodeJwtClaims can base64-decode
// its payload — the sim never verifies the signature, only presents it to the
// (mocked) gateway.
function fakeJwt(aud) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud, sub: 'test-user' })).toString('base64url');
  return `${header}.${payload}.`;
}

function makeReq() {
  return { session: { oauthTokens: { accessToken: fakeJwt('https://original-aud.example.com') } } };
}

beforeEach(() => {
  mockPerformTokenExchange.mockReset();
  mockCallToolViaGateway.mockReset();
});

describe('_runWrongAud — triedAudience/allowedAudience fields', () => {
  test('gateway-deny path includes both real audience values', async () => {
    mockPerformTokenExchange.mockResolvedValue(fakeJwt('https://mcp-server.example.com'));
    mockCallToolViaGateway.mockRejectedValue({
      code: 'GATEWAY_AUDIENCE_MISMATCH',
      httpStatus: 401,
      message: 'aud mismatch',
    });

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('invalid_aud');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });

  test('unexpected-permit path includes both real audience values', async () => {
    mockPerformTokenExchange.mockResolvedValue(fakeJwt('https://mcp-server.example.com'));
    mockCallToolViaGateway.mockResolvedValue({ ok: true });

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('unexpected_permit');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });

  test('exchange-failed path includes both real audience values', async () => {
    mockPerformTokenExchange.mockRejectedValue(
      Object.assign(new Error('exchange rejected'), { pingoneError: 'invalid_target' }),
    );

    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.errorCode).toBe('invalid_target');
    expect(result.triedAudience).toBe('https://mcp-server.example.com');
    expect(result.allowedAudience).toBe('https://mcp-gateway.example.com');
  });
});
