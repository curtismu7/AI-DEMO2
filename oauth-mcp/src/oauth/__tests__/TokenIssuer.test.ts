import { resolveAudience, resolveOwnAudience } from '../TokenIssuer';

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

describe('resolveOwnAudience', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  it('returns ONLY the first entry — this AS may not assert the gateway\'s or PingOne\'s audience', () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo,https://api.pingone.com';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  it('trims whitespace around the first entry', () => {
    process.env.MCP_SERVER_RESOURCE_URI = '  mcpserver.ping.demo , mcpgateway.ping.demo ';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  it('defaults to "mcpserver.ping.demo" when unset', () => {
    delete process.env.MCP_SERVER_RESOURCE_URI;
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  it('falls back to the default rather than undefined when the env var is all separators', () => {
    process.env.MCP_SERVER_RESOURCE_URI = ' , , ';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  // The positional dependency this removes: MCP_SERVER_RESOURCE_URI[0] is only
  // "our own" URI by convention. Reorder the list and this AS starts asserting
  // an audience it has no authority to grant. Sibling resolvers already prefer
  // the dedicated var (JwtClaimVerifier); this one now matches them.
  it('prefers PINGONE_RESOURCE_MCP_SERVER_URI over the positional first entry', () => {
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = 'mcpserver.ping.demo';
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpgateway.ping.demo,mcpserver.ping.demo';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  it('takes the first entry when the dedicated var is itself a comma list', () => {
    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = ' mcpserver.ping.demo , other.example ';
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpgateway.ping.demo';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });

  // Inert today: the dedicated var is unset in docker-compose.yml, k8s/, and
  // the live ai-demo-mcp-server container, so behaviour is unchanged until an
  // operator sets it.
  it('falls through to MCP_SERVER_RESOURCE_URI when the dedicated var is unset or empty', () => {
    delete process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');

    process.env.PINGONE_RESOURCE_MCP_SERVER_URI = '  ,  ';
    expect(resolveOwnAudience()).toBe('mcpserver.ping.demo');
  });
});

jest.mock('jose', () => {
  class SignJWT {
    static audienceCalls: unknown[] = [];
    static payloads: Record<string, unknown>[] = [];
    constructor(payload: Record<string, unknown>) { SignJWT.payloads.push(payload); }
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

async function buildIssuer(): Promise<TokenIssuer> {
  const keyManager = new SigningKeyManager();
  await keyManager.initialize();
  const clientRegistry = new ClientRegistry();
  clientRegistry.initialize();
  return new TokenIssuer(keyManager, clientRegistry, new TokenStore());
}

describe('TokenIssuer audience wiring', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    (jose.SignJWT as any).audienceCalls = [];
    (jose.SignJWT as any).payloads = [];
  });

  it('issueClientCredentials sets aud to THIS AS\'s own resource URI only, never the full split list', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
    const issuer = await buildIssuer();

    await issuer.issueClientCredentials(
      { client_id: 'c1', client_name: 'Test', grant_types: ['client_credentials'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke' },
      'mcp:invoke',
    );

    expect((jose.SignJWT as any).audienceCalls).toEqual(['mcpserver.ping.demo']);
  });

  it('issueAuthorizationCode sets aud to THIS AS\'s own resource URI only', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = 'mcpserver.ping.demo,mcpgateway.ping.demo';
    const issuer = await buildIssuer();

    await issuer.issueAuthorizationCode(
      { client_id: 'c1', client_name: 'Test', grant_types: ['authorization_code'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke' },
      'real-user',
      'mcp:invoke',
    );

    expect((jose.SignJWT as any).audienceCalls).toEqual(['mcpserver.ping.demo']);
  });
});

describe('TokenIssuer scope filtering', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
    (jose.SignJWT as any).audienceCalls = [];
    (jose.SignJWT as any).payloads = [];
  });

  it('issueAuthorizationCode clamps a scope the client is not registered for', async () => {
    const issuer = await buildIssuer();

    const response = await issuer.issueAuthorizationCode(
      { client_id: 'narrow-client', client_name: 'Narrow', grant_types: ['authorization_code'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke' },
      'real-user',
      'mcp:invoke admin:read', // client-controlled: came in on /authorize?scope=...
    );

    // Returned to the client...
    expect(response.scope).toBe('mcp:invoke');
    // ...and, crucially, in the SIGNED token — the returned value being right
    // while the token over-grants would be the actual privilege escalation.
    const payloads = (jose.SignJWT as any).payloads as Record<string, unknown>[];
    const signed = payloads[payloads.length - 1];
    expect(signed.scope).toBe('mcp:invoke');
    expect(signed.scope).not.toContain('admin:read');
  });

  it('issueAuthorizationCode passes through a scope the client IS registered for', async () => {
    const issuer = await buildIssuer();

    const response = await issuer.issueAuthorizationCode(
      { client_id: 'wide-client', client_name: 'Wide', grant_types: ['authorization_code'], redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic', scope: 'mcp:invoke read write' },
      'real-user',
      'mcp:invoke read',
    );

    expect(response.scope).toBe('mcp:invoke read');
    const payloads = (jose.SignJWT as any).payloads as Record<string, unknown>[];
    expect(payloads[payloads.length - 1].scope).toBe('mcp:invoke read');
  });
});
