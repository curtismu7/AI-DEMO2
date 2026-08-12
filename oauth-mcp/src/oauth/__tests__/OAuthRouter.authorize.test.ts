import axios from 'axios';
import { IncomingMessage, ServerResponse } from 'http';
import { OAuthRouter } from '../OAuthRouter';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';
import * as jwksModule from '../../auth/jwks';

jest.mock('axios');
jest.mock('../../auth/jwks');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwks = jwksModule as jest.Mocked<typeof jwksModule>;

function fakeReqRes(method: string, urlPath: string) {
  const req = { method, url: urlPath, headers: { host: 'localhost:8080' } } as unknown as IncomingMessage;
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = '';
  const res = {
    writeHead: (code: number, h?: Record<string, string>) => { statusCode = code; headers = h || {}; },
    end: (b?: string) => { body = b || ''; },
  } as unknown as ServerResponse;
  return { req, res, get statusCode() { return statusCode; }, get headers() { return headers; }, get body() { return body; } };
}

describe('OAuthRouter — real PingOne-backed /authorize', () => {
  const ORIG = { ...process.env };
  let router: OAuthRouter;
  let clientRegistry: ClientRegistry;

  beforeEach(async () => {
    process.env.OAUTH_MCP_PINGONE_CLIENT_ID = 'rp-client-id';
    process.env.OAUTH_MCP_PINGONE_CLIENT_SECRET = 'rp-client-secret';
    process.env.PINGONE_AUTHORIZATION_ENDPOINT = 'https://auth.pingone.com/env/as/authorize';
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/env/as/token';

    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    clientRegistry = new ClientRegistry();
    clientRegistry.initialize(); // seeds 'mcp-inspector' with redirect_uris incl. localhost:6274
    router = new OAuthRouter(keyManager, clientRegistry, new TokenStore());
  });
  afterEach(() => { process.env = { ...ORIG }; jest.clearAllMocks(); });

  it('GET /authorize redirects (302) to PingOne, not to the client redirect_uri', async () => {
    const call = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc&state=client-state-1');

    const handled = await router.handle(call.req, call.res);
    const ctx = call as any;

    expect(handled).toBe(true);
    expect(ctx.statusCode).toBe(302);
    const location = new URL(ctx.headers.Location);
    expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env/as/authorize');
    expect(location.searchParams.get('client_id')).toBe('rp-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(`${(router as any).issuer}/authorize/callback`);
  });

  it('full round trip: /authorize -> capture relay state -> /authorize/callback mints a code for the ORIGINAL client', async () => {
    const authorizeCall = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc&state=client-state-1');
    await router.handle(authorizeCall.req, authorizeCall.res);
    const location = new URL((authorizeCall as any).headers.Location);
    expect(location.origin + location.pathname).toBe('https://auth.pingone.com/env/as/authorize');
    const relayState = location.searchParams.get('state')!;
    expect(relayState).toBeTruthy();
    expect(relayState).not.toBe('client-state-1'); // never leaks the client's own state to PingOne

    mockedAxios.post.mockResolvedValue({ data: { access_token: 'pingone.access.token' } });
    const jwtVerify = jest.fn().mockResolvedValue({ payload: { sub: 'real-pingone-user' } });
    mockedJwks.getJose.mockResolvedValue({ jwtVerify } as any);
    mockedJwks.createJwksKeySet.mockResolvedValue((() => {}) as any);

    const callbackCall = fakeReqRes('GET', `/authorize/callback?code=pingone-auth-code&state=${relayState}`);
    const handled = await router.handle(callbackCall.req, callbackCall.res);

    expect(handled).toBe(true);
    const callbackLocation = new URL((callbackCall as any).headers.Location);
    expect(callbackLocation.origin + callbackLocation.pathname).toBe('http://localhost:6274/oauth/callback');
    expect(callbackLocation.searchParams.get('code')).toBeTruthy();
    expect(callbackLocation.searchParams.get('state')).toBe('client-state-1'); // original client's state, relayed back
  });

  it('/authorize/callback rejects an unknown/expired relay state', async () => {
    const call = fakeReqRes('GET', '/authorize/callback?code=abc&state=never-issued');
    await router.handle(call.req, call.res);
    const ctx = call as any;
    expect(ctx.statusCode).toBe(400);
    expect(JSON.parse(ctx.body).error).toBe('invalid_grant');
  });

  it('/authorize returns 503 when PingOne federation env vars are not configured', async () => {
    delete process.env.OAUTH_MCP_PINGONE_CLIENT_ID;
    const call = fakeReqRes('GET',
      '/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:6274/oauth/callback&response_type=code&code_challenge=abc');
    await router.handle(call.req, call.res);
    const ctx = call as any;
    expect(ctx.statusCode).toBe(503);
  });
});
