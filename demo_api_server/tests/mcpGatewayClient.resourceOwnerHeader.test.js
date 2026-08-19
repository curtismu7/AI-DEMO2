// demo_api_server/tests/mcpGatewayClient.resourceOwnerHeader.test.js
'use strict';
/**
 * UC10 cross-owner: the BFF resolves ResourceOwnerId for its OWN authorize gate, but
 * that gate is SKIPPED when the gateway is authoritative (the live default). The value
 * was computed and dropped — it was never sent to the gateway, never appeared in
 * p1az-decision.groovy's parameter set, and PingOne Authorize was therefore
 * structurally blind to ownership. Measured live 2026-08-18: the attack sim's
 * `authorize` came back `{decision:'PERMIT', outcome:'PERMIT'}` and only the data
 * plane blocked the read, so ProofStrip scored the step "Mismatch" against its
 * declared DENY.
 *
 * The fix sends X-Resource-Owner-Id. This asserts the BFF half; the groovy half
 * (parameter + local backstop deny) is covered by the live UC10 run.
 */

jest.mock('../services/mcpToolAuthorizationService', () => ({
  resolveResourceOwnerId: jest.fn(),
}));

const { resolveResourceOwnerId } = require('../services/mcpToolAuthorizationService');

/** Capture the headers callToolViaGateway builds, without a real gateway. */
async function headersFor(tool, params) {
  jest.resetModules();
  const captured = {};
  jest.doMock('axios', () => ({
    post: jest.fn(async (_url, _body, cfg) => {
      Object.assign(captured, (cfg && cfg.headers) || {});
      return { status: 200, headers: {}, data: { jsonrpc: '2.0', id: 1, result: { content: [] } } };
    }),
    get: jest.fn(async () => ({ status: 200, headers: {}, data: {} })),
  }));
  jest.doMock('../services/mcpToolAuthorizationService', () => ({ resolveResourceOwnerId }));
  const { callToolViaGateway } = require('../services/mcpGatewayClient');
  try {
    await callToolViaGateway('https://gw.local', 'tok', tool, params, {});
  } catch (_) { /* transport shape is not what this asserts */ }
  return captured;
}

describe('mcpGatewayClient — X-Resource-Owner-Id reaches the gateway', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sends the resolved owner id for an account-scoped tool', async () => {
    resolveResourceOwnerId.mockReturnValue('owner-uuid-9');
    const h = await headersFor('get_account_balance', { account_id: 'acct-someone-else' });
    expect(h['X-Resource-Owner-Id']).toBe('owner-uuid-9');
  });

  test('omits the header entirely when ownership cannot be resolved', async () => {
    // C1 rule 3: omission means "unknown". Sending an empty/!= value would make the
    // gateway's backstop deny every call whose owner simply could not be looked up.
    resolveResourceOwnerId.mockReturnValue(null);
    const h = await headersFor('list_gear', {});
    expect('X-Resource-Owner-Id' in h).toBe(false);
  });

  test('a lookup failure never blocks the tool call', async () => {
    resolveResourceOwnerId.mockImplementation(() => { throw new Error('store down'); });
    const h = await headersFor('get_account_balance', { account_id: 'acct-1' });
    expect('X-Resource-Owner-Id' in h).toBe(false);
    expect(h.Authorization).toBe('Bearer tok');
  });
});
