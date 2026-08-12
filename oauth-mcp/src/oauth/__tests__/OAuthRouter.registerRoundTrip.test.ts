/**
 * Part A round-trip — the seam the spec names as its success criterion and that
 * nothing else in this branch exercises:
 *
 *   POST /register  ->  POST /token (client_credentials)  ->  the resulting
 *   bearer authenticates through TokenIntrospector.validateAgentToken().
 *
 * Every other test on this branch mocks the neighbour it hands off to, so the
 * point where DCR registration, self-issued signing, the embedded-issuer verify
 * path, the `aud` binding and scope resolution all have to AGREE has never been
 * run as one flow.
 *
 * `jose` is module-mapped to the throwing CJS shim in every Jest run, so this
 * file supplies a LOCAL matched pair: a SignJWT that emits a well-formed compact
 * JWT and remembers its claims, and a jwtVerify that only accepts tokens that
 * map came out of. That is the project's stated philosophy (see
 * src/__mocks__/jose-cjs.js) — prove the WIRING, not RSA. Real crypto is covered
 * by integration tests against a live tenant.
 */

jest.mock('jose', () => {
  // Shared, module-level to this factory: the "signature" — a token verifies iff
  // this fake AS actually minted it.
  const claimsByToken = new Map<string, Record<string, unknown>>();
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  class SignJWT {
    private payload: Record<string, unknown>;
    private header: Record<string, unknown> = {};
    constructor(payload: Record<string, unknown>) { this.payload = { ...payload }; }
    setProtectedHeader(h: Record<string, unknown>) { this.header = h; return this; }
    setIssuer(v: string) { this.payload.iss = v; return this; }
    setSubject(v: string) { this.payload.sub = v; return this; }
    setAudience(v: unknown) { this.payload.aud = v; return this; }
    setIssuedAt(v: number) { this.payload.iat = v; return this; }
    setExpirationTime(v: number) { this.payload.exp = v; return this; }
    setJti(v: string) { this.payload.jti = v; return this; }
    setNotBefore(v: number) { this.payload.nbf = v; return this; }
    async sign() {
      const token = `${b64u(this.header)}.${b64u(this.payload)}.embedded-as-signature`;
      claimsByToken.set(token, this.payload);
      return token;
    }
  }

  async function jwtVerify(token: string) {
    const claims = claimsByToken.get(token);
    if (!claims) {
      throw new Error('signature verification failed — not signed by this key');
    }
    return { payload: claims, protectedHeader: { alg: 'RS256' } };
  }

  return {
    SignJWT,
    jwtVerify,
    // Genuinely real, exactly as the repo-wide shim does — SigningKeyManager
    // derives its kid from a real JWK.
    exportJWK: async (key: { export: (o: { format: 'jwk' }) => unknown }) => key.export({ format: 'jwk' }),
    createRemoteJWKSet: () => async () => { throw new Error('remote JWKS not used in this test'); },
  };
});

import { Readable } from 'stream';
import { IncomingMessage, ServerResponse } from 'http';
import { OAuthRouter } from '../OAuthRouter';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';
import { resetEmbeddedSigningKeyManagerForTests } from '../embeddedIssuer';
import { TokenIntrospector } from '../../auth/TokenIntrospector';
import { PingOneConfig } from '../../interfaces/auth';

const DCR_TOKEN = 'round-trip-initial-access-token';
const EMBEDDED_ISSUER = 'https://oauth-mcp.test:8080';
const OWN_RESOURCE_URI = 'mcpserver.ping.demo';

function fakeReqRes(method: string, urlPath: string, body = '', headers: Record<string, string> = {}) {
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = urlPath;
  req.headers = { host: 'localhost:8080', ...headers };

  let statusCode = 0;
  let responseBody = '';
  const res = {
    writeHead: (code: number) => { statusCode = code; },
    end: (b?: string) => { responseBody = b || ''; },
  } as unknown as ServerResponse;

  return {
    req: req as unknown as IncomingMessage,
    res,
    get statusCode() { return statusCode; },
    get body() { return responseBody; },
  };
}

const introspectorConfig: PingOneConfig = {
  baseUrl: 'https://auth.pingone.com/env-abc',
  clientId: 'unused-in-this-path',
  clientSecret: 'unused-in-this-path',
  tokenIntrospectionEndpoint: 'https://auth.pingone.com/env-abc/as/introspect',
  authorizationEndpoint: 'https://auth.pingone.com/env-abc/as/authorize',
  tokenEndpoint: 'https://auth.pingone.com/env-abc/as/token',
};

describe('DCR round trip — /register -> /token -> the bearer authenticates', () => {
  const ORIG = { ...process.env };
  let router: OAuthRouter;

  beforeEach(async () => {
    resetEmbeddedSigningKeyManagerForTests();
    // /register is gated (Fix 1) — this flow needs it to actually succeed.
    process.env.DCR_INITIAL_ACCESS_TOKEN = DCR_TOKEN;
    // Pin both sides of the issuer agreement: TokenIssuer signs with it,
    // TokenIntrospector routes on it.
    process.env.OAUTH_ISSUER = EMBEDDED_ISSUER;
    // Single-entry list, so resolveOwnAudience()'s first-entry value and the
    // introspector's accepted set are the same string.
    process.env.MCP_SERVER_RESOURCE_URI = OWN_RESOURCE_URI;
    delete process.env.SKIP_TOKEN_SIGNATURE_VALIDATION;
    delete process.env.MCP_ALLOWED_ACTORS;

    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    router = new OAuthRouter(keyManager, clientRegistry, new TokenStore());
  });

  afterEach(() => {
    process.env = { ...ORIG };
    resetEmbeddedSigningKeyManagerForTests();
    jest.clearAllMocks();
  });

  async function registerClient(scope: string): Promise<{ clientId: string; clientSecret: string }> {
    const call = fakeReqRes(
      'POST', '/register',
      JSON.stringify({ client_name: 'round-trip-client', grant_types: ['client_credentials'], scope }),
      { authorization: `Bearer ${DCR_TOKEN}` },
    );
    await router.handle(call.req, call.res);
    expect(call.statusCode).toBe(201);
    const registered = JSON.parse(call.body);
    return { clientId: registered.client_id, clientSecret: registered.client_secret };
  }

  async function fetchToken(clientId: string, clientSecret: string, scope: string) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const call = fakeReqRes(
      'POST', '/token',
      new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
      { authorization: `Basic ${basic}` },
    );
    await router.handle(call.req, call.res);
    expect(call.statusCode).toBe(200);
    return JSON.parse(call.body);
  }

  it('a DCR-registered client_credentials token authenticates through TokenIntrospector', async () => {
    const { clientId, clientSecret } = await registerClient('mcp:invoke');
    const tokenResponse = await fetchToken(clientId, clientSecret, 'mcp:invoke');

    expect(tokenResponse.token_type).toBe('Bearer');
    expect(tokenResponse.scope).toBe('mcp:invoke');
    expect(tokenResponse.access_token.split('.')).toHaveLength(3);

    const introspector = new TokenIntrospector(introspectorConfig);
    const result = await introspector.validateAgentToken(tokenResponse.access_token);

    expect(result.isValid).toBe(true);
    expect(result.scopes).toContain('mcp:invoke');
    expect(result.clientId).toBe(clientId);
    // Signature was actually checked against the embedded issuer's local key —
    // NOT skipped, and NOT the PingOne remote-JWKS path.
    expect(result.signatureVerified).toBe(true);
    expect(result.verifiedClaims?.iss).toBe(EMBEDDED_ISSUER);
  });

  it('the self-issued token asserts ONLY this AS\'s own resource URI as aud', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = `${OWN_RESOURCE_URI},mcpgateway.ping.demo,https://api.pingone.com`;

    const { clientId, clientSecret } = await registerClient('mcp:invoke');
    const tokenResponse = await fetchToken(clientId, clientSecret, 'mcp:invoke');

    const claims = JSON.parse(Buffer.from(tokenResponse.access_token.split('.')[1], 'base64url').toString());
    expect(claims.aud).toBe(OWN_RESOURCE_URI);
    expect(claims.aud).not.toContain('mcpgateway.ping.demo');
  });

  it('the token endpoint clamps a scope beyond what /register recorded', async () => {
    const { clientId, clientSecret } = await registerClient('mcp:invoke');
    const tokenResponse = await fetchToken(clientId, clientSecret, 'mcp:invoke admin:read');

    expect(tokenResponse.scope).toBe('mcp:invoke');

    const introspector = new TokenIntrospector(introspectorConfig);
    const result = await introspector.validateAgentToken(tokenResponse.access_token);
    expect(result.scopes).toEqual(['mcp:invoke']);
  });

  it('a token this AS did not sign is rejected by the same path', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: EMBEDDED_ISSUER,
      sub: 'attacker',
      aud: OWN_RESOURCE_URI,
      scope: 'mcp:invoke admin:read',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const forged = `${header}.${payload}.forged`;

    const introspector = new TokenIntrospector(introspectorConfig);
    await expect(introspector.validateAgentToken(forged)).rejects.toThrow(/signature verification failed/i);
  });
});
