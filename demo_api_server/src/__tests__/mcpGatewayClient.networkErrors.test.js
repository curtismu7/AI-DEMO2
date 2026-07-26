'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const {
  callToolViaGateway,
  tryGetMcpGatewayHttpUrl,
  getMcpGatewayHttpUrl,
  _normalizeGatewayNetworkError,
} = require('../../services/mcpGatewayClient');

describe('mcpGatewayClient network error normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('_normalizeGatewayNetworkError maps ECONNABORTED to GATEWAY_TIMEOUT', () => {
    const axErr = Object.assign(new Error('timeout of 30000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    const err = _normalizeGatewayNetworkError(axErr, 30000);
    expect(err).toMatchObject({
      code: 'GATEWAY_TIMEOUT',
      httpStatus: 504,
    });
    expect(err.message).toMatch(/timed out after 30000ms/);
  });

  test('_normalizeGatewayNetworkError maps ECONNREFUSED to GATEWAY_UNREACHABLE', () => {
    const axErr = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const err = _normalizeGatewayNetworkError(axErr, 30000);
    expect(err).toMatchObject({
      code: 'GATEWAY_UNREACHABLE',
      httpStatus: 503,
    });
  });

  test('callToolViaGateway surfaces GATEWAY_TIMEOUT from axios timeout', async () => {
    axios.post = jest.fn().mockRejectedValue(
      Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })
    );

    await expect(
      callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'get_my_accounts', {}, {})
    ).rejects.toMatchObject({
      code: 'GATEWAY_TIMEOUT',
      httpStatus: 504,
    });
  });

  test('tryGetMcpGatewayHttpUrl returns null when unconfigured, URL when set', () => {
    const prev = process.env.MCP_DEMO_GATEWAY_URL;
    delete process.env.MCP_DEMO_GATEWAY_URL;
    delete process.env.MCP_GATEWAY_HTTP_URL;
    expect(tryGetMcpGatewayHttpUrl()).toBeNull();
    expect(() => getMcpGatewayHttpUrl()).toThrow(/not configured/);

    process.env.MCP_DEMO_GATEWAY_URL = 'https://api.ping.demo:3005/';
    expect(tryGetMcpGatewayHttpUrl()).toBe('https://api.ping.demo:3005');

    if (prev === undefined) delete process.env.MCP_DEMO_GATEWAY_URL;
    else process.env.MCP_DEMO_GATEWAY_URL = prev;
  });
});
