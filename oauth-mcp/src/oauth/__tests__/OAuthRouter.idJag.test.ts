/**
 * OAuthRouter.idJag.test.ts — the jwt-bearer / ID-JAG grant at the token endpoint.
 *
 * Same jose treatment as IdJagGrantHandler.test.ts: jose is stubbed under jest,
 * so the double below does real HMAC crypto and honours jose's option semantics.
 * Everything else — the router, the grant dispatch, the client allow-list, the
 * issuer — is real production code.
 */

import { createHmac } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

const SIGNING_KEY = 'correct-signing-key';
const IDP_ISSUER = 'https://idp.ping.demo';
const RESOURCE = 'https://mcpserver.ping.demo';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function hmacSign(input: string, key: string): string {
  return createHmac('sha256', key).update(input).digest('base64url');
}

jest.mock('jose', () => {
  const actualCrypto = jest.requireActual('crypto');
  const sign = (input: string, key: string) =>
    actualCrypto.createHmac('sha256', key).update(input).digest('base64url');
  return {
    createRemoteJWKSet: () => async () => SIGNING_KEY,
    jwtVerify: async (
      token: string,
      keyOrResolver: unknown,
      options: { algorithms?: string[]; issuer?: string; audience?: string; clockTolerance?: number } = {},
    ) => {
      const parts = String(token).split('.');
      if (parts.length !== 3) throw new Error('JWSInvalid: malformed');
      const [h, p, s] = parts;
      const protectedHeader = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      const alg = String(protectedHeader.alg || '');
      if (options.algorithms && !options.algorithms.includes(alg)) {
        throw new Error(`JOSEAlgNotAllowed: "alg" (${alg}) not allowed`);
      }
      const key = typeof keyOrResolver === 'function'
        ? await (keyOrResolver as (x: unknown) => Promise<unknown>)(protectedHeader)
        : keyOrResolver;
      if (s !== sign(`${h}.${p}`, String(key))) {
        throw new Error('JWSSignatureVerificationFailed');
      }
      if (options.issuer && payload.iss !== options.issuer) throw new Error('JWTClaimValidationFailed: iss');
      if (options.audience && payload.aud !== options.audience) throw new Error('JWTClaimValidationFailed: aud');
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === 'number' && payload.exp + (options.clockTolerance || 0) < now) {
        throw new Error('JWTExpired');
      }
      return { payload, protectedHeader };
    },
    // Used by SigningKeyManager on the real path.
    exportJWK: async (key: { export: (o: unknown) => unknown }) => key.export({ format: 'jwk' }),
    SignJWT: class {
      private payload: Record<string, unknown>;
      private header: Record<string, unknown> = {};
      private claims: Record<string, unknown> = {};
      constructor(payload: Record<string, unknown>) { this.payload = payload; }
      setProtectedHeader(h: Record<string, unknown>) { this.header = h; return this; }
      setIssuer(v: string) { this.claims.iss = v; return this; }
      setSubject(v: string) { this.claims.sub = v; return this; }
      setAudience(v: string | string[]) { this.claims.aud = v; return this; }
      setIssuedAt(v: number) { this.claims.iat = v; return this; }
      setExpirationTime(v: number) { this.claims.exp = v; return this; }
      setJti(v: string) { this.claims.jti = v; return this; }
      async sign(_key: unknown) {
        const input = `${b64url(this.header)}.${b64url({ ...this.payload, ...this.claims })}`;
        return `${input}.${sign(input, SIGNING_KEY)}`;
      }
    },
  };
});

// eslint-disable-next-line import/first
import { OAuthRouter } from '../OAuthRouter';
// eslint-disable-next-line import/first
import { ClientRegistry, OAuthClient } from '../ClientRegistry';
// eslint-disable-next-line import/first
import { TokenStore } from '../TokenStore';
// eslint-disable-next-line import/first
import { SigningKeyManager } from '../SigningKeyManager';
// eslint-disable-next-line import/first
import { JWT_BEARER_GRANT, ID_JAG_GRANT_PROFILE, resetReplayCacheForTests } from '../IdJagGrantHandler';

const CLIENT: OAuthClient = {
  client_id: 'demo-bff-mcp-client',
  client_secret: 'test-secret',
  client_name: 'Demo BFF MCP Client',
  grant_types: ['authorization_code', JWT_BEARER_GRANT],
  redirect_uris: [],
  token_endpoint_auth_method: 'client_secret_post',
  scope: 'banking:read banking:write',
};

const ORIG = { ...process.env };

async function buildRouter(): Promise<{ router: OAuthRouter; registry: ClientRegistry }> {
  const keyManager = new SigningKeyManager();
  await keyManager.initialize();
  const registry = new ClientRegistry();
  registry.initialize();
  registry.registerClient({ ...CLIENT });
  const router = new OAuthRouter(keyManager, registry, new TokenStore());
  return { router, registry };
}

/** Drives the real handle() path over fake http objects and captures the response. */
async function postToken(
  router: OAuthRouter,
  form: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new URLSearchParams(form).toString();
  const req = new IncomingMessage(new Socket());
  req.method = 'POST';
  req.url = '/token';
  req.headers = { host: 'mcpserver.ping.demo:8080', 'content-type': 'application/x-www-form-urlencoded' };

  let status = 0;
  let payload = '';
  const res = {
    writeHead(code: number) { status = code; return this; },
    setHeader() { return this; },
    end(chunk?: string) { if (chunk) payload = chunk; },
  } as unknown as ServerResponse;

  const handled = router.handle(req, res);
  req.push(body);
  req.push(null);
  await handled;

  return { status, body: payload ? JSON.parse(payload) : {} };
}

function mintIdJag(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', typ: 'oauth-id-jag+jwt', ...header };
  const p = {
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    iss: IDP_ISSUER,
    sub: 'user-123',
    email: 'alice@example.com',
    aud: process.env.OAUTH_ISSUER,
    resource: RESOURCE,
    client_id: CLIENT.client_id,
    scope: 'banking:read',
    iat: now,
    exp: now + 120,
    ...overrides,
  };
  const input = `${b64url(h)}.${b64url(p)}`;
  return `${input}.${hmacSign(input, SIGNING_KEY)}`;
}

beforeEach(() => {
  resetReplayCacheForTests();
  process.env.OAUTH_ISSUER = 'https://mcpserver.ping.demo:8080';
  process.env.MCP_SERVER_RESOURCE_URI = RESOURCE;
  process.env.ENTERPRISE_IDP_ISSUER = IDP_ISSUER;
  process.env.ENTERPRISE_IDP_JWKS_URL = 'https://api.ping.demo:3001/api/enterprise-idp/jwks';
});
afterEach(() => { process.env = { ...ORIG }; });

describe('OAuthRouter — ID-JAG jwt-bearer grant', () => {
  it('redeems a valid ID-JAG for an access token subjected to the assertion sub', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag(),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    const claims = JSON.parse(
      Buffer.from(String(res.body.access_token).split('.')[1], 'base64url').toString('utf8'),
    );
    expect(claims.sub).toBe('user-123');
  });

  it('never widens scope beyond the assertion', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ scope: 'banking:read' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(200);
    expect(String(res.body.scope).split(' ')).not.toContain('banking:write');
  });

  it('returns an OAuth error, not a token, for a bad assertion', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: 'not.a.jwt',
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.body.access_token).toBeUndefined();
    expect(res.body.error).toBeTruthy();
  });

  it('requires the assertion parameter', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('refuses the grant when native mode is not configured', async () => {
    delete process.env.ENTERPRISE_IDP_JWKS_URL;
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag(),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
    expect(res.body.access_token).toBeUndefined();
  });

  it('refuses a client not registered for the jwt-bearer grant', async () => {
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const registry = new ClientRegistry();
    registry.initialize();
    registry.registerClient({ ...CLIENT, grant_types: ['authorization_code'] });
    const router = new OAuthRouter(keyManager, registry, new TokenStore());

    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag(),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unauthorized_client');
  });
});

describe('OAuthRouter — authorization server metadata', () => {
  async function getMetadata(): Promise<Record<string, unknown>> {
    const { router } = await buildRouter();
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url = '/.well-known/oauth-authorization-server';
    req.headers = { host: 'mcpserver.ping.demo:8080' };
    let payload = '';
    const res = {
      writeHead() { return this; },
      setHeader() { return this; },
      end(chunk?: string) { if (chunk) payload = chunk; },
    } as unknown as ServerResponse;
    await router.handle(req, res);
    return JSON.parse(payload);
  }

  it('advertises the id-jag grant profile when native mode is configured', async () => {
    const md = await getMetadata();
    expect(md.grant_types_supported).toContain(JWT_BEARER_GRANT);
    expect(md.authorization_grant_profiles_supported).toContain(ID_JAG_GRANT_PROFILE);
  });

  it('advertises neither when native mode is off — do not promise what we refuse', async () => {
    delete process.env.ENTERPRISE_IDP_ISSUER;
    const md = await getMetadata();
    expect(md.grant_types_supported).not.toContain(JWT_BEARER_GRANT);
    expect(md.authorization_grant_profiles_supported).toBeUndefined();
  });

  it('keeps the pre-existing grant types untouched', async () => {
    const md = await getMetadata();
    expect(md.grant_types_supported).toContain('authorization_code');
    expect(md.grant_types_supported).toContain('client_credentials');
  });
});
