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
import axios from 'axios';

const SIGNING_KEY = 'correct-signing-key';
const OKTA_KEY = 'okta-signing-key';
const OKTA_ISSUER = 'https://x.okta.com';
const OKTA_JWKS = 'https://x.okta.com/oauth2/v1/keys';
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
    // Each IdP's JWKS URL serves its own key, so verifying against the wrong
    // IdP's key set fails the signature check.
    createRemoteJWKSet: (url: URL) => async (header: { x5t?: string }) => {
      if (header?.x5t) throw new Error('multiple matching keys found in the JSON Web Key Set');
      return url.href.includes('okta') ? 'okta-signing-key' : SIGNING_KEY;
    },
    importJWK: async () => SIGNING_KEY,
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
// eslint-disable-next-line import/first
import { resetTrustedIdpsForTests } from '../IdJagTrustedIdps';

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
  resetTrustedIdpsForTests();
  process.env.ENTERPRISE_IDP_REGISTRY_URL = 'off';
  process.env.OAUTH_ISSUER = 'https://mcpserver.ping.demo:8080';
  process.env.MCP_SERVER_RESOURCE_URI = RESOURCE;
  process.env.ENTERPRISE_IDP_ISSUER = IDP_ISSUER;
  process.env.ENTERPRISE_IDP_JWKS_URL = 'https://api.ping.demo:3001/api/enterprise-idp/jwks';
  jest.spyOn(axios, 'get').mockResolvedValue({ data: { keys: [{ x5t: 'pf-thumbprint', kty: 'RSA' }] } } as never);
});
afterEach(() => { jest.restoreAllMocks(); process.env = { ...ORIG }; });

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

  it('redeems a PF-style ID-JAG identified by its x5t JWKS thumbprint', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({}, { x5t: 'pf-thumbprint' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith(process.env.ENTERPRISE_IDP_JWKS_URL);
  });

  it('accepts the same x5t key listed under several kids (static PF key set)', async () => {
    const same = { x5t: 'pf-thumbprint', kty: 'RSA', n: 'modulus', e: 'AQAB' };
    (axios.get as jest.Mock).mockResolvedValue({ data: { keys: [{ ...same, kid: 'a' }, { ...same, kid: 'a_RS256' }, { ...same, kid: 'atm' }] } });
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({}, { x5t: 'pf-thumbprint' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(200);
  });

  it('refuses two different keys sharing one x5t', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { keys: [
      { x5t: 'pf-thumbprint', kty: 'RSA', n: 'one', e: 'AQAB' }, { x5t: 'pf-thumbprint', kty: 'RSA', n: 'two', e: 'AQAB' }] } });
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({}, { x5t: 'pf-thumbprint' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error_description)).toMatch(/found 2/);
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

describe('OAuthRouter — ID-JAG client binding and client authentication', () => {
  it('refuses an ID-JAG that was issued to a different client', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ client_id: 'some-other-client' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('redeems an ID-JAG whose client_id is the IdP-side id mapped by ENTERPRISE_IDP_ID_JAG_CLIENT_MAP', async () => {
    process.env.ENTERPRISE_IDP_ID_JAG_CLIENT_MAP = `ai-demo-pf-user=${CLIENT.client_id}`;
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ client_id: 'ai-demo-pf-user' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(200);
  });

  it('refuses a public client when ENTERPRISE_IDP_REQUIRE_CLIENT_AUTH is on', async () => {
    process.env.ENTERPRISE_IDP_REQUIRE_CLIENT_AUTH = 'true';
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const registry = new ClientRegistry();
    registry.initialize();
    const router = new OAuthRouter(keyManager, registry, new TokenStore());
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ client_id: 'demo-bff-mcp-client' }),
      client_id: 'demo-bff-mcp-client',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('registers the default redemption client as confidential when a secret is configured', async () => {
    process.env.ENTERPRISE_MCP_AS_CLIENT_SECRET = 'configured-secret';
    const registry = new ClientRegistry();
    registry.initialize();
    expect(registry.authenticateClient('demo-bff-mcp-client', undefined, 'token')).toBeNull();
    expect(registry.authenticateClient('demo-bff-mcp-client', 'configured-secret', 'token')).not.toBeNull();
  });
});

describe('OAuthRouter — ID-JAG resource allow-list', () => {
  it('refuses a resource outside ENTERPRISE_IDP_ID_JAG_RESOURCES even if the AS accepts it for tokens', async () => {
    process.env.MCP_SERVER_RESOURCE_URI = `${RESOURCE},https://api.pingone.com`;
    process.env.ENTERPRISE_IDP_ID_JAG_RESOURCES = RESOURCE;
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ resource: 'https://api.pingone.com' }),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_target');
  });

  it('keeps the redeeming client on the issued token so downstream policy can see the agent', async () => {
    const { router } = await buildRouter();
    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag(),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
    });
    const claims = JSON.parse(Buffer.from(String(res.body.access_token).split('.')[1], 'base64url').toString('utf8'));
    expect(claims.client_id).toBe(CLIENT.client_id);
    expect(claims.sub).toBe('user-123');
  });
});

describe('OAuthRouter — ID-JAG granted scope is strict', () => {
  const redeem = async (overrides: Record<string, unknown>, extra: Record<string, string> = {}) => {
    const { router } = await buildRouter();
    return postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag(overrides),
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
      ...extra,
    });
  };

  // Regression: a live PingFederate ID-JAG carried only the refresh token's OIDC scopes,
  // and resolveScope's fallback minted a token with the client's FULL scope list.
  it('refuses an ID-JAG whose scopes do not overlap the client, instead of granting everything', async () => {
    const res = await redeem({ scope: 'openid profile email offline_access' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
    expect(res.body.access_token).toBeUndefined();
  });

  it('grants only the overlap of assertion and client scope', async () => {
    const res = await redeem({ scope: 'banking:read openid admin:root' });
    expect(res.status).toBe(200);
    expect(String(res.body.scope).split(' ').sort()).toEqual(['banking:read']);
  });

  it('narrows further to the scope the request asks for', async () => {
    const res = await redeem({ scope: 'banking:read banking:write' }, { scope: 'banking:read' });
    expect(res.status).toBe(200);
    expect(String(res.body.scope)).toBe('banking:read');
  });

  it('refuses when the request asks for a scope the assertion did not grant', async () => {
    const res = await redeem({ scope: 'banking:read' }, { scope: 'banking:write' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
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

describe('OAuthRouter — ID-JAG redemption by the default demo-bff-mcp-client', () => {
  // ClientRegistry.initialize()'s built-in entry, not the test CLIENT above:
  // TokenIssuer clamps the redeemed scope to that registration, and the BFF
  // (agentMcpTokenService) asks for `write transfer` for banking
  // create_transfer. If the registration lacks `transfer`, the gateway 403s
  // `insufficient_scope: missing transfer` on the native ID-JAG path.
  it('keeps `transfer` in the redeemed token when the assertion carries it', async () => {
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const registry = new ClientRegistry();
    registry.initialize();
    const router = new OAuthRouter(keyManager, registry, new TokenStore());

    const res = await postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion: mintIdJag({ client_id: 'demo-bff-mcp-client', scope: 'write transfer' }),
      client_id: 'demo-bff-mcp-client',
    });
    expect(res.status).toBe(200);
    expect(String(res.body.scope).split(' ')).toEqual(expect.arrayContaining(['write', 'transfer']));
  });
});

describe('OAuthRouter — bring-your-own IdP registry', () => {
  const REGISTRY_URL = 'https://demo-api-server:3001/api/id-jag-playground/trusted-idps/registry';
  const OKTA = {
    id: 'okta-dev',
    issuer: OKTA_ISSUER,
    jwksUrl: OKTA_JWKS,
    clientAliases: { 'okta-agent': CLIENT.client_id },
    scopes: '',
  };

  function mintOkta(overrides: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const h = { alg: 'RS256', typ: 'oauth-id-jag+jwt' };
    const p = {
      jti: `jti-${Math.random().toString(36).slice(2)}`,
      iss: OKTA_ISSUER,
      sub: 'okta-user',
      aud: process.env.OAUTH_ISSUER,
      resource: RESOURCE,
      client_id: 'okta-agent',
      scope: 'banking:read banking:write',
      iat: now,
      exp: now + 120,
      ...overrides,
    };
    const input = `${b64url(h)}.${b64url(p)}`;
    return `${input}.${hmacSign(input, OKTA_KEY)}`;
  }

  /** Registry endpoint serves `idps` (or fails); every other GET is a JWKS fetch. */
  function serveRegistry(idps: unknown[] | Error) {
    (axios.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url === REGISTRY_URL) {
        if (idps instanceof Error) throw idps;
        return { data: { idps } };
      }
      return { data: { keys: [] } };
    });
  }

  const redeem = async (assertion: string, extra: Record<string, string> = {}) => {
    const { router } = await buildRouter();
    return postToken(router, {
      grant_type: JWT_BEARER_GRANT,
      assertion,
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret as string,
      ...extra,
    });
  };

  beforeEach(() => {
    resetTrustedIdpsForTests();
    process.env.ENTERPRISE_IDP_REGISTRY_URL = REGISTRY_URL;
  });

  it('accepts an ID-JAG from a registry IdP, verified against that IdP\'s JWKS', async () => {
    serveRegistry([OKTA]);
    const res = await redeem(mintOkta());
    expect(res.status).toBe(200);
    const claims = JSON.parse(Buffer.from(String(res.body.access_token).split('.')[1], 'base64url').toString('utf8'));
    expect(claims.sub).toBe('okta-user');
  });

  it('enables the grant and metadata from the registry alone (no env IdP)', async () => {
    delete process.env.ENTERPRISE_IDP_ISSUER;
    delete process.env.ENTERPRISE_IDP_JWKS_URL;
    serveRegistry([OKTA]);
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
    expect(JSON.parse(payload).authorization_grant_profiles_supported).toContain(ID_JAG_GRANT_PROFILE);
    expect((await redeem(mintOkta())).status).toBe(200);
  });

  it('refuses an ID-JAG signed with another IdP\'s key', async () => {
    serveRegistry([OKTA]);
    const now = Math.floor(Date.now() / 1000);
    const h = b64url({ alg: 'RS256', typ: 'oauth-id-jag+jwt' });
    const p = b64url({
      jti: 'forged', iss: OKTA_ISSUER, sub: 'x', aud: process.env.OAUTH_ISSUER, resource: RESOURCE,
      client_id: 'okta-agent', scope: 'banking:read', iat: now, exp: now + 120,
    });
    const res = await redeem(`${h}.${p}.${hmacSign(`${h}.${p}`, SIGNING_KEY)}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('refuses an unknown issuer with invalid_grant', async () => {
    serveRegistry([OKTA]);
    const res = await redeem(mintOkta({ iss: 'https://evil.example' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/issuer is not trusted/);
  });

  it('binds clients with the matching IdP\'s aliases only', async () => {
    process.env.ENTERPRISE_IDP_ID_JAG_CLIENT_MAP = `env-only-alias=${CLIENT.client_id}`;
    serveRegistry([OKTA]);
    // env alias does not carry over to the Okta IdP
    const viaEnvAlias = await redeem(mintOkta({ client_id: 'env-only-alias' }));
    expect(viaEnvAlias.status).toBe(400);
    expect(viaEnvAlias.body.error).toBe('invalid_grant');
    // Okta's own alias does not carry over to the env IdP
    const viaOktaAliasOnEnv = await redeem(mintIdJag({ client_id: 'okta-agent' }));
    expect(viaOktaAliasOnEnv.status).toBe(400);
  });

  // Registry IdPs bind strictly: the ID-JAG's client_id must be one of the entry's
  // clientAliases keys and the authenticating client must be its mapped value. A
  // client that is merely registered here (e.g. a retired one) cannot redeem.
  it('refuses a registry ID-JAG whose client_id is not an alias key, even when it equals the authenticating client', async () => {
    serveRegistry([OKTA]);
    const res = await redeem(mintOkta({ client_id: CLIENT.client_id }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/client_id is not assigned to this IdP/);
  });

  it('refuses a registry ID-JAG whose alias maps to a different client than the one authenticating', async () => {
    serveRegistry([{ ...OKTA, clientAliases: { 'okta-agent': 'someone-else' } }]);
    const res = await redeem(mintOkta());
    expect(res.status).toBe(400);
    expect(res.body.error_description).toMatch(/client_id is not assigned to this IdP/);
  });

  it('keeps the env IdP\'s exact-match binding (no alias needed)', async () => {
    serveRegistry([OKTA]);
    const res = await redeem(mintIdJag({ client_id: CLIENT.client_id }));
    expect(res.status).toBe(200);
  });

  it('caps the granted scope at the IdP\'s registry scopes', async () => {
    serveRegistry([{ ...OKTA, scopes: 'banking:read' }]);
    const res = await redeem(mintOkta({ scope: 'banking:read banking:write' }));
    expect(res.status).toBe(200);
    expect(String(res.body.scope)).toBe('banking:read');
  });

  it('refuses with invalid_scope when the IdP cap leaves nothing', async () => {
    serveRegistry([{ ...OKTA, scopes: 'accounts:read' }]);
    const res = await redeem(mintOkta({ scope: 'banking:read' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });

  it('lets the env IdP win an issuer collision', async () => {
    serveRegistry([{ ...OKTA, issuer: IDP_ISSUER }]);
    // signed by the env IdP's key, carrying the env client id: env config verifies it
    const res = await redeem(mintIdJag());
    expect(res.status).toBe(200);
  });

  it('keeps the last good registry when a later fetch fails', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      serveRegistry([OKTA]);
      expect((await redeem(mintOkta())).status).toBe(200);
      jest.setSystemTime(Date.now() + 60_000);
      serveRegistry(new Error('ECONNREFUSED'));
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect((await redeem(mintOkta())).status).toBe(200);
      jest.setSystemTime(Date.now() + 60_000);
      expect((await redeem(mintOkta())).status).toBe(200);
      expect(warn.mock.calls.filter(([m]) => String(m).includes('registry fetch failed'))).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still serves the env IdP when the registry is unreachable', async () => {
    serveRegistry(new Error('ECONNREFUSED'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await redeem(mintIdJag())).status).toBe(200);
  });

  it('does not fetch when the registry is turned off', async () => {
    process.env.ENTERPRISE_IDP_REGISTRY_URL = 'off';
    serveRegistry([OKTA]);
    expect((await redeem(mintIdJag())).status).toBe(200);
    expect(axios.get).not.toHaveBeenCalledWith(REGISTRY_URL, expect.anything());
    expect((await redeem(mintOkta())).status).toBe(400);
  });
});
