/**
 * @file configStore-authorizeEndpointSave.test.js
 * @description Regression: POST /api/authorize/bootstrap-demo-endpoints saves the
 * decision-endpoint IDs via setConfig({ authorize_decision_endpoint_id,
 * authorize_mcp_decision_endpoint_id }) and reported configSaved:true, but
 * setConfig silently dropped both keys (not in FIELD_DEFS), so getEffective()
 * kept returning '' and the MCP first-tool gate failed closed (503
 * mcp_authorize_unavailable) on every tool call.
 */

describe('configStore authorize decision-endpoint save', () => {
  const KEYS = ['PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID', 'PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID'];
  const orig = {};

  beforeEach(() => {
    for (const k of KEYS) {
      orig[k] = process.env[k];
      delete process.env[k];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
    jest.resetModules();
  });

  it('setConfig persists the exact patch the bootstrap route sends, readable via getEffective', async () => {
    const configStore = require('../../services/configStore');
    await configStore.setConfig({
      authorize_decision_endpoint_id: 'ep-tx-test-1',
      authorize_mcp_decision_endpoint_id: 'ep-mcp-test-1',
    });
    expect(configStore.getEffective('authorize_decision_endpoint_id')).toBe('ep-tx-test-1');
    expect(configStore.getEffective('authorize_mcp_decision_endpoint_id')).toBe('ep-mcp-test-1');
  });

  it('env vars still win over UI-saved values', async () => {
    const configStore = require('../../services/configStore');
    await configStore.setConfig({ authorize_mcp_decision_endpoint_id: 'ep-mcp-from-ui' });
    process.env.PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID = 'ep-mcp-from-env';
    expect(configStore.getEffective('authorize_mcp_decision_endpoint_id')).toBe('ep-mcp-from-env');
  });
});
