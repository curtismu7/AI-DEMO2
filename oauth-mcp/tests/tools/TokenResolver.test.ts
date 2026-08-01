import { TokenResolver } from '../../src/tools/TokenResolver';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { TokenExchangeService } from '../../src/auth/TokenExchangeService';
import { Logger, createDefaultLoggerConfig } from '../../src/utils/Logger';
import { tokenCache } from '../../src/services/tokenCacheService';
import { Session, AuthenticationError } from '../../src/interfaces/auth';
import type { BankingToolDefinition } from '../../src/tools/BankingToolRegistry';

jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/auth/TokenExchangeService');

// BankingToolDefinition requires: name, description, inputSchema, requiresUserAuth,
// requiredScopes, handler, readOnly (plus optional title, icons, annotations)
const baseTool: BankingToolDefinition = {
  name: 'get_my_accounts',
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  requiredScopes: ['read'],
  requiresUserAuth: true,
  handler: 'executeGetMyAccounts',
  readOnly: true,
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'sess-1',
    agentTokenHash: 'hash-abc',
    userTokens: {
      accessToken: 'user-tok',
      refreshToken: 'r',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'read write',
      issuedAt: new Date(),
    },
    createdAt: new Date(),
    lastActivity: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

describe('TokenResolver', () => {
  let authManager: jest.Mocked<BankingAuthenticationManager>;
  let tokenExchangeService: jest.Mocked<TokenExchangeService>;
  let logger: Logger;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset the shared tokenCache singleton using its clear() method
    tokenCache.clear();
    authManager = new BankingAuthenticationManager({} as any) as jest.Mocked<BankingAuthenticationManager>;
    authManager.isTokenExpired = jest.fn((_userTokens) => false);
    tokenExchangeService = new TokenExchangeService({} as any) as jest.Mocked<TokenExchangeService>;
    tokenExchangeService.exchangeToken = jest.fn();
    logger = Logger.getInstance(createDefaultLoggerConfig());
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('agent-passthrough: returns agentToken when no resource URI configured', async () => {
    delete process.env.BANKING_API_RESOURCE_URI;
    const r = new TokenResolver({ authManager, tokenExchangeService, logger });
    const res = await r.resolve(makeSession(), baseTool, 'agent-tok');
    expect(res.token).toBe('agent-tok');
    expect(res.source).toBe('agent-passthrough');
    expect(tokenExchangeService.exchangeToken).not.toHaveBeenCalled();
  });

  it('agent-step9-exchange: exchanges when agentToken + resource URI present', async () => {
    process.env.BANKING_API_RESOURCE_URI = 'https://banking.example';
    (tokenExchangeService.exchangeToken as jest.Mock).mockResolvedValue({
      access_token: 'resource-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const r = new TokenResolver({ authManager, tokenExchangeService, logger });
    const res = await r.resolve(makeSession(), baseTool, 'agent-tok');
    expect(res.token).toBe('resource-tok');
    expect(res.source).toBe('agent-step9-exchange');
    expect(tokenExchangeService.exchangeToken).toHaveBeenCalledTimes(1);
  });

  it('user-rfc8693-exchange: exchanges user token when no agentToken', async () => {
    (tokenExchangeService.exchangeToken as jest.Mock).mockResolvedValue({
      access_token: 'exchanged-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const r = new TokenResolver({ authManager, tokenExchangeService, logger });
    const res = await r.resolve(makeSession(), baseTool, undefined);
    expect(res.token).toBe('exchanged-tok');
    expect(res.source).toBe('user-rfc8693-exchange');
  });

  it('user-passthrough-noexchange: passes user token directly when no exchange service in test env', async () => {
    process.env.NODE_ENV = 'test';
    const r = new TokenResolver({ authManager, tokenExchangeService: undefined, logger });
    const res = await r.resolve(makeSession(), baseTool, undefined);
    expect(res.token).toBe('user-tok');
    expect(res.source).toBe('user-passthrough-noexchange');
  });

  it('user-passthrough-noexchange: passes user token directly when no exchange service in production (no prod throw)', async () => {
    process.env.NODE_ENV = 'production';
    const r = new TokenResolver({ authManager, tokenExchangeService: undefined, logger });
    const res = await r.resolve(makeSession(), baseTool, undefined);
    expect(res.token).toBe('user-tok');
    expect(res.source).toBe('user-passthrough-noexchange');
  });

  it('throws AuthenticationError when no user token has required scopes', async () => {
    const session = makeSession({
      userTokens: {
        accessToken: 'u',
        refreshToken: 'r',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:other',
        issuedAt: new Date(),
      },
    });
    const r = new TokenResolver({ authManager, tokenExchangeService, logger });
    await expect(r.resolve(session, baseTool, undefined)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('caches and re-uses exchanged user token within TTL', async () => {
    (tokenExchangeService.exchangeToken as jest.Mock).mockResolvedValue({
      access_token: 'cached-tok',
      token_type: 'Bearer',
      expires_in: 60,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
    const r = new TokenResolver({ authManager, tokenExchangeService, logger });
    await r.resolve(makeSession(), baseTool, undefined);
    await r.resolve(makeSession(), baseTool, undefined);
    expect(tokenExchangeService.exchangeToken).toHaveBeenCalledTimes(1);
  });
});
