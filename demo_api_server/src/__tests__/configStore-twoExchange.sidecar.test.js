/**
 * validateTwoExchangeConfig with clients the identity sidecar manages (ff_agent_identity_sidecar).
 *
 * The validator throws TWO_EXCHANGE_CONFIG_INVALID when a client secret is missing. Once the
 * sidecar holds a client's secret that is expected, not an error, so the caller passes the set of
 * client ids the sidecar manages. With no set the behaviour is exactly what it was.
 */

'use strict';

const ENV_SNAPSHOT = { ...process.env };

const AGENT_ID = 'agent-actor-client';
const EXCHANGER_ID = 'mcp-exchanger-client';

beforeEach(() => {
  jest.resetModules();
  Object.keys(process.env).forEach((k) => {
    if (
      k.startsWith('PINGONE_') ||
      k.startsWith('AI_AGENT_') ||
      k.startsWith('AGENT_OAUTH_') ||
      k === 'KV_REST_API_URL' ||
      k === 'KV_REST_API_TOKEN' ||
      k === 'VERCEL'
    ) {
      delete process.env[k];
    }
  });
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID = AGENT_ID;
  process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID = EXCHANGER_ID;
  process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI = 'agentgateway.test';
  process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI = 'mcpgateway.test';
  process.env.AI_AGENT_INTERMEDIATE_AUDIENCE = 'intermediate.test';
  process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI = 'final.test';
});

afterAll(() => {
  Object.keys(process.env).forEach((k) => {
    delete process.env[k];
  });
  Object.assign(process.env, ENV_SNAPSHOT);
});

function loadConfigStore() {
  const cs = require('../../services/configStore');
  [
    'pingone_ai_agent_client_id',
    'pingone_ai_agent_client_secret',
    'pingone_mcp_token_exchanger_client_id',
    'pingone_mcp_token_exchanger_client_secret',
    'pingone_resource_agent_gateway_uri',
    'pingone_resource_mcp_gateway_uri',
    'ai_agent_intermediate_audience',
    'pingone_resource_two_exchange_uri',
  ].forEach((k) => {
    cs._cache[k] = '';
  });
  return cs;
}

test('with both secrets absent and both clients managed by the sidecar the config is valid', () => {
  const { validateTwoExchangeConfig } = loadConfigStore();
  const result = validateTwoExchangeConfig({ managedClientIds: new Set([AGENT_ID, EXCHANGER_ID]) });
  expect(result.valid).toBe(true);
  expect(result.credentials.aiAgentClientId).toBe(AGENT_ID);
});

test('a missing secret for a client the sidecar does NOT manage is still reported', () => {
  const { validateTwoExchangeConfig } = loadConfigStore();
  let err;
  try {
    validateTwoExchangeConfig({ managedClientIds: new Set([AGENT_ID]) });
  } catch (e) {
    err = e;
  }
  expect(err.code).toBe('TWO_EXCHANGE_CONFIG_INVALID');
  expect(err.details.missing.join(' ')).toMatch(/TOKEN_EXCHANGER_CLIENT_SECRET/);
  expect(err.details.missing.join(' ')).not.toMatch(/AI_AGENT_ACTOR_CLIENT_SECRET/);
});

test('with no managed set the missing-secret error is unchanged (the flag-OFF behaviour)', () => {
  const { validateTwoExchangeConfig } = loadConfigStore();
  let err;
  try {
    validateTwoExchangeConfig();
  } catch (e) {
    err = e;
  }
  expect(err.code).toBe('TWO_EXCHANGE_CONFIG_INVALID');
  expect(err.details.missing.join(' ')).toMatch(/AI_AGENT_ACTOR_CLIENT_SECRET/);
  expect(err.details.missing.join(' ')).toMatch(/TOKEN_EXCHANGER_CLIENT_SECRET/);
});

test('present secrets keep working whether or not the sidecar manages the clients', () => {
  process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET = 'a-secret';
  process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET = 'e-secret';
  const { validateTwoExchangeConfig } = loadConfigStore();
  expect(validateTwoExchangeConfig().valid).toBe(true);
  expect(validateTwoExchangeConfig({ managedClientIds: new Set([AGENT_ID]) }).valid).toBe(true);
});
