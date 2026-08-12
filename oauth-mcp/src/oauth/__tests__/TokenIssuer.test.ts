import { resolveAudience } from '../TokenIssuer';

describe('resolveAudience', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  it('splits a comma-separated MCP_SERVER_RESOURCE_URI into an array', () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo,https://api.pingone.com';
    expect(resolveAudience()).toEqual([
      'mcpserver.ping.demo',
      'mcpgateway.ping.demo',
      'https://api.pingone.com',
    ]);
  });

  it('trims whitespace around entries', () => {
    process.env.MCP_SERVER_RESOURCE_URI = ' mcpserver.ping.demo , mcpgateway.ping.demo ';
    expect(resolveAudience()).toEqual(['mcpserver.ping.demo', 'mcpgateway.ping.demo']);
  });

  it('defaults to ["mcpserver.ping.demo"] when unset', () => {
    delete process.env.MCP_SERVER_RESOURCE_URI;
    expect(resolveAudience()).toEqual(['mcpserver.ping.demo']);
  });
});

jest.mock('jose', () => {
  class SignJWT {
    static audienceCalls: unknown[] = [];
    constructor(_payload: unknown) {}
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setSubject() { return this; }
    setAudience(aud: unknown) { SignJWT.audienceCalls.push(aud); return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    setJti() { return this; }
    async sign() { return 'fake.jwt.token'; }
  }
  return {
    SignJWT,
    exportJWK: async () => ({ kty: 'RSA', n: 'mock', e: 'AQAB' }),
  };
});

import * as jose from 'jose';
import { TokenIssuer } from '../TokenIssuer';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';

describe('TokenIssuer audience wiring', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    (jose.SignJWT as any).audienceCalls = [];
  });

  it('issueClientCredentials sets aud to the split array, not the raw env string', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    const issuer = new TokenIssuer(keyManager, clientRegistry, new TokenStore());

    await issuer.issueClientCredentials(
      { client_id: 'c1', client_name: 'Test', grant_types: ['client_credentials'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke' },
      'mcp:invoke',
    );

    expect((jose.SignJWT as any).audienceCalls).toEqual([['mcpserver.ping.demo', 'mcpgateway.ping.demo']]);
  });
});
