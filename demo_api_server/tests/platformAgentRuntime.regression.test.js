// banking_api_server/tests/platformAgentRuntime.regression.test.js
jest.mock('axios');
const { buildPlatformRequest } = require('../services/platformAgentRuntime');

describe('buildPlatformRequest', () => {
  const gwUrl = 'https://gw.example/mcp';
  const tok = 'eyJtok';

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('openai → Responses API shape with mcp tool + authorization', () => {
    const r = buildPlatformRequest('openai', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'List accounts', model: 'gpt-4o' });
    expect(r.url).toMatch(/openai|responses/i);
    expect(r.body.tools[0]).toMatchObject({ type: 'mcp', server_url: gwUrl, authorization: tok });
    expect(r.body.input).toBe('List accounts');
  });

  test('anthropic → Messages API shape with mcp_servers + authorization_token', () => {
    const r = buildPlatformRequest('anthropic', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'List accounts', model: 'claude-sonnet-4-6' });
    expect(r.body.mcp_servers[0]).toMatchObject({ type: 'url', url: gwUrl, authorization_token: tok });
    expect(r.body.messages[0]).toMatchObject({ role: 'user', content: 'List accounts' });
  });

  test('anthropic → includes mcp-client beta header', () => {
    const r = buildPlatformRequest('anthropic', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'hi' });
    expect(r.headers['anthropic-beta']).toBe('mcp-client-2025-04-04');
  });

  test('session vertical persona → openai instructions / anthropic system; omitted when absent', () => {
    const persona = 'You are CareConnect, a healthcare assistant.';
    const o = buildPlatformRequest('openai', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'hi', systemPrompt: persona });
    const a = buildPlatformRequest('anthropic', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'hi', systemPrompt: persona });
    expect(o.body.instructions).toBe(persona);
    expect(a.body.system).toBe(persona);
    // No persona → field omitted (generic agent), not set to undefined/empty.
    const none = buildPlatformRequest('openai', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'hi' });
    expect('instructions' in none.body).toBe(false);
  });

  test('unknown provider throws (no silent default)', () => {
    expect(() => buildPlatformRequest('mistral', {})).toThrow(/unsupported platform provider/i);
  });

  test('unknown provider throws even when opts omitted (no destructure crash)', () => {
    expect(() => buildPlatformRequest('mistral')).toThrow(/unsupported platform provider/i);
  });
});
