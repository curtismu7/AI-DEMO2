import { Readable } from 'stream';
import { IncomingMessage, ServerResponse } from 'http';
import { OAuthRouter } from '../OAuthRouter';
import { SigningKeyManager } from '../SigningKeyManager';
import { ClientRegistry } from '../ClientRegistry';
import { TokenStore } from '../TokenStore';

function fakeReqRes(method: string, urlPath: string, body = '', headers: Record<string, string> = {}) {
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage & { method: string; url: string; headers: Record<string, string> };
  req.method = method;
  req.url = urlPath;
  req.headers = { host: 'localhost:8080', ...headers };

  let statusCode = 0;
  let responseHeaders: Record<string, string> = {};
  let responseBody = '';
  const res = {
    writeHead: (code: number, h?: Record<string, string>) => { statusCode = code; responseHeaders = h || {}; },
    end: (b?: string) => { responseBody = b || ''; },
  } as unknown as ServerResponse;

  return {
    req: req as unknown as IncomingMessage,
    res,
    get statusCode() { return statusCode; },
    get headers() { return responseHeaders; },
    get body() { return responseBody; },
  };
}

/** A registration that asks for far more than it should be given. */
const GREEDY_REGISTRATION = JSON.stringify({
  client_name: 'chatgpt-like-client',
  grant_types: ['authorization_code'],
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'none',
  scope: 'mcp:invoke read write admin:read admin:write',
});

describe('OAuthRouter — open client registration (MCP_OPEN_CLIENT_REGISTRATION)', () => {
  const ORIG = { ...process.env };
  let router: OAuthRouter;
  let clientRegistry: ClientRegistry;

  beforeEach(async () => {
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    router = new OAuthRouter(keyManager, clientRegistry, new TokenStore());
    delete process.env.DCR_INITIAL_ACCESS_TOKEN;
    delete process.env.DCR_OPEN_REGISTRATION_SCOPE;
  });
  afterEach(() => { process.env = { ...ORIG }; jest.restoreAllMocks(); });

  it('still returns 503 when neither the token nor the open flag is set', async () => {
    delete process.env.MCP_OPEN_CLIENT_REGISTRATION;

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION);
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(503);
  });

  it('registers an unauthenticated client when the open flag is set', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION);
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(201);
    const parsed = JSON.parse(call.body);
    expect(parsed.client_id).toBeTruthy();
    expect(parsed.client_name).toBe('chatgpt-like-client');
  });

  it('pins the granted scope server-side, ignoring what the client asked for', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION);
    await router.handle(call.req, call.res);

    const parsed = JSON.parse(call.body);
    expect(parsed.scope).toBe('mcp:invoke read');
    expect(parsed.scope).not.toContain('admin:write');
    // and the stored client carries the pinned scope, not the requested one
    expect(clientRegistry.getClient(parsed.client_id)?.scope).toBe('mcp:invoke read');
  });

  it('honours DCR_OPEN_REGISTRATION_SCOPE when the operator overrides it', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    process.env.DCR_OPEN_REGISTRATION_SCOPE = 'mcp:invoke';

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION);
    await router.handle(call.req, call.res);

    expect(JSON.parse(call.body).scope).toBe('mcp:invoke');
  });

  it('still enforces a provisioned initial access token even with the open flag on', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'operator-provisioned-secret';

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION);
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(401);
  });

  it('lets an operator-authorised registration name its own scope', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'operator-provisioned-secret';

    const call = fakeReqRes('POST', '/register', GREEDY_REGISTRATION, {
      authorization: 'Bearer operator-provisioned-secret',
    });
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(201);
    expect(JSON.parse(call.body).scope).toContain('admin:write');
  });

  it('advertises client_id_metadata_document_supported only when the flag is on', async () => {
    delete process.env.MCP_OPEN_CLIENT_REGISTRATION;
    const off = fakeReqRes('GET', '/.well-known/oauth-authorization-server');
    await router.handle(off.req, off.res);
    expect(JSON.parse(off.body).client_id_metadata_document_supported).toBe(false);

    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    const on = fakeReqRes('GET', '/.well-known/oauth-authorization-server');
    await router.handle(on.req, on.res);
    expect(JSON.parse(on.body).client_id_metadata_document_supported).toBe(true);
  });
});
