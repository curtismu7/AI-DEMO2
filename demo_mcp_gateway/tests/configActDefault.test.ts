import { loadConfig } from '../src/config';

const envKeys = [
  'REQUIRE_ACT_FOR_AGENT_TOOLS',
  'MCP_GW_CLIENT_ID',
  'MCP_GW_CLIENT_SECRET',
  'MCP_GW_RESOURCE_URI',
  'PINGONE_TOKEN_ENDPOINT',
] as const;
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.MCP_GW_CLIENT_ID = 'test-gateway-client';
  process.env.MCP_GW_CLIENT_SECRET = 'test-gateway-secret';
  process.env.MCP_GW_RESOURCE_URI = 'https://gateway.test';
  process.env.PINGONE_TOKEN_ENDPOINT = 'https://pingone.test/token';
});

afterEach(() => {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('MCP Gateway act enforcement default', () => {
  test('requires act when the environment variable is unset', () => {
    delete process.env.REQUIRE_ACT_FOR_AGENT_TOOLS;
    expect(loadConfig().requireActForAgentTools).toBe(true);
  });

  test('supports an explicit opt-out', () => {
    process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'false';
    expect(loadConfig().requireActForAgentTools).toBe(false);
  });

  test('accepts the explicit enable value', () => {
    process.env.REQUIRE_ACT_FOR_AGENT_TOOLS = 'true';
    expect(loadConfig().requireActForAgentTools).toBe(true);
  });
});
