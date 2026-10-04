// The Privilege AI Gateway's Static Token auth mode sends one fixed bearer on
// every backend call. These pin the opt-in path that accepts it: off by
// default, exact match only, and never wider than the configured scopes.
import { decodeAndValidate, extractScopes, TokenError } from '../src/server/tokenValidator';

const AUD = 'mcp-invest.ping.demo,mcpgateway.ping.demo';
const TOKEN = 'a'.repeat(48);
const ENV_TOKEN = 'MCP_RESOURCE_SERVER_GATEWAY_STATIC_TOKEN';
const ENV_SCOPES = 'MCP_RESOURCE_SERVER_GATEWAY_STATIC_SCOPES';

describe('gateway static token', () => {
  const saved = { token: process.env[ENV_TOKEN], scopes: process.env[ENV_SCOPES] };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env[ENV_TOKEN];
    delete process.env[ENV_SCOPES];
    // The JWT path warns when no JWKS is configured; keep test output quiet.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  afterAll(() => {
    if (saved.token === undefined) delete process.env[ENV_TOKEN]; else process.env[ENV_TOKEN] = saved.token;
    if (saved.scopes === undefined) delete process.env[ENV_SCOPES]; else process.env[ENV_SCOPES] = saved.scopes;
  });

  it('is off when no static token is configured', async () => {
    await expect(decodeAndValidate(TOKEN, AUD)).rejects.toBeInstanceOf(TokenError);
  });

  it('accepts the configured token as a sub-less caller with no scopes by default', async () => {
    process.env[ENV_TOKEN] = TOKEN;
    const decoded = await decodeAndValidate(TOKEN, AUD);
    expect(decoded.sub).toBe('');
    expect(extractScopes(decoded)).toEqual([]);
  });

  it('accepts comma-separated scopes, which survive env files that quote spaces', async () => {
    process.env[ENV_TOKEN] = TOKEN;
    process.env[ENV_SCOPES] = 'read,invest:read, airlines:read';
    const decoded = await decodeAndValidate(TOKEN, AUD);
    expect(extractScopes(decoded)).toEqual(['read', 'invest:read', 'airlines:read']);
  });

  it('uses the configured scopes and nothing wider', async () => {
    process.env[ENV_TOKEN] = TOKEN;
    process.env[ENV_SCOPES] = 'read invest:read';
    const decoded = await decodeAndValidate(TOKEN, AUD);
    expect(extractScopes(decoded)).toEqual(['read', 'invest:read']);
    expect(extractScopes(decoded)).not.toContain('write');
  });

  it('rejects a different token of the same length', async () => {
    process.env[ENV_TOKEN] = TOKEN;
    await expect(decodeAndValidate('b'.repeat(48), AUD)).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a prefix of the configured token', async () => {
    process.env[ENV_TOKEN] = TOKEN;
    await expect(decodeAndValidate(TOKEN.slice(0, 40), AUD)).rejects.toBeInstanceOf(TokenError);
  });

  it('stays off when the configured token is shorter than 32 characters', async () => {
    const short = 'c'.repeat(16);
    process.env[ENV_TOKEN] = short;
    await expect(decodeAndValidate(short, AUD)).rejects.toBeInstanceOf(TokenError);
  });

  it('never accepts an empty bearer, even if the env var is blank', async () => {
    process.env[ENV_TOKEN] = '';
    await expect(decodeAndValidate('', AUD)).rejects.toBeInstanceOf(TokenError);
  });
});
