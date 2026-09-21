import { IncomingMessage, ServerResponse } from 'http';
import { OAuthRouter } from '../OAuthRouter';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenIssuer } from '../TokenIssuer';
import { TokenStore } from '../TokenStore';

function fakeReqRes(method: string, urlPath: string, authorization?: string) {
  const req = {
    method,
    url: urlPath,
    headers: { host: 'oidc.example.test', ...(authorization ? { authorization } : {}) },
  } as unknown as IncomingMessage;
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const res = {
    writeHead: (code: number, h?: Record<string, string>) => { statusCode = code; headers = h || {}; },
    setHeader: (name: string, value: string) => { headers[name] = value; },
    end: (b?: string) => { body = b || ''; },
  } as unknown as ServerResponse;
  return { req, res, get statusCode() { return statusCode; }, get headers() { return headers; }, get body() { return body; } };
}

describe('embedded OIDC provider surface', () => {
  const ORIG = { ...process.env };
  let keyManager: SigningKeyManager;
  let clientRegistry: ClientRegistry;
  let tokenStore: TokenStore;
  let router: OAuthRouter;

  beforeEach(async () => {
    process.env.OAUTH_ISSUER = 'https://oidc.example.test';
    keyManager = new SigningKeyManager();
    await keyManager.initialize();
    clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    tokenStore = new TokenStore();
    router = new OAuthRouter(keyManager, clientRegistry, tokenStore);
  });

  afterEach(() => {
    process.env = { ...ORIG };
  });

  it('publishes OpenID Connect discovery without advertising logout', async () => {
    const call = fakeReqRes('GET', '/.well-known/openid-configuration');

    expect(await router.handle(call.req, call.res)).toBe(true);
    expect(call.statusCode).toBe(200);
    const metadata = JSON.parse(call.body);
    expect(metadata.issuer).toBe('https://oidc.example.test');
    expect(metadata.authorization_endpoint).toBe('https://oidc.example.test/authorize');
    expect(metadata.token_endpoint).toBe('https://oidc.example.test/token');
    expect(metadata.userinfo_endpoint).toBe('https://oidc.example.test/userinfo');
    expect(metadata.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(metadata.grant_types_supported).toEqual(['authorization_code']);
    expect(metadata.scopes_supported).toContain('openid');
    expect(metadata.end_session_endpoint).toBeUndefined();
  });

  it('returns OIDC user claims from an openid authorization-code access token', async () => {
    jest.spyOn(TokenIssuer.prototype, 'userInfo').mockResolvedValue({ sub: 'user-123' });

    const call = fakeReqRes('GET', '/userinfo', 'Bearer test-access-token');
    expect(await router.handle(call.req, call.res)).toBe(true);
    expect(call.statusCode).toBe(200);
    expect(JSON.parse(call.body)).toMatchObject({ sub: 'user-123' });
  });
});
