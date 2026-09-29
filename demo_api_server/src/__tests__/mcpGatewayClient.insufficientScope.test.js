'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));
jest.mock('../../services/nrSegments', () => ({
  mcpToolCall: (fn) => fn(),
  tokenExchange: (fn) => fn(),
  introspection: (fn) => fn(),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

const SCOPE_DATA = {
  requiredScopes: ['read', 'write'],
  missingScopes: ['write'],
  availableScopes: ['read'],
};

describe.each([200, 403])('mcpGatewayClient HTTP %s insufficient-scope envelope', (status) => {
  afterEach(() => jest.clearAllMocks());

  test('maps JSON-RPC -32005 to the BFF scope-recovery error', async () => {
    axios.post.mockResolvedValue({
      status,
      headers: {},
      data: {
        jsonrpc: '2.0',
        id: 'request-1',
        error: { code: -32005, message: 'insufficient_scope', data: SCOPE_DATA },
      },
    });

    await expect(
      callToolViaGateway('https://gw.local', 'bearer-tok', 'get_my_accounts', {}, { pinNodeGateway: true })
    ).rejects.toMatchObject({
      code: 'mcp_insufficient_scope',
      httpStatus: 403,
      mcpErrorData: SCOPE_DATA,
    });
  });
});
