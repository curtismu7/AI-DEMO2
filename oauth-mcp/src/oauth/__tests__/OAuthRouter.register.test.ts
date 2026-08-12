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

const REGISTRATION_BODY = JSON.stringify({
  client_name: 'test-dcr-client',
  grant_types: ['client_credentials'],
  scope: 'mcp:invoke',
});

describe('OAuthRouter — POST /register is gated by DCR_INITIAL_ACCESS_TOKEN', () => {
  const ORIG = { ...process.env };
  let router: OAuthRouter;

  beforeEach(async () => {
    const keyManager = new SigningKeyManager();
    await keyManager.initialize();
    const clientRegistry = new ClientRegistry();
    clientRegistry.initialize();
    router = new OAuthRouter(keyManager, clientRegistry, new TokenStore());
  });
  afterEach(() => { process.env = { ...ORIG }; jest.clearAllMocks(); });

  it('returns 503 temporarily_unavailable when DCR_INITIAL_ACCESS_TOKEN is unset', async () => {
    delete process.env.DCR_INITIAL_ACCESS_TOKEN;

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY);
    const handled = await router.handle(call.req, call.res);

    expect(handled).toBe(true);
    expect(call.statusCode).toBe(503);
    const parsed = JSON.parse(call.body);
    expect(parsed.error).toBe('temporarily_unavailable');
    expect(parsed.error_description).toContain('DCR_INITIAL_ACCESS_TOKEN');
  });

  it('returns 401 invalid_token when the secret IS set but no Authorization header is presented', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY);
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(401);
    expect(JSON.parse(call.body).error).toBe('invalid_token');
  });

  it('returns 401 invalid_token for a WRONG bearer value', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY, {
      authorization: 'Bearer not-the-right-token',
    });
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(401);
    expect(JSON.parse(call.body).error).toBe('invalid_token');
  });

  it('returns 401 for a same-length-but-different bearer (constant-time compare still rejects)', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY, {
      authorization: 'Bearer super-secret-dcr-tokeX',
    });
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(401);
  });

  it('returns 401 for a non-Bearer scheme carrying the right value', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY, {
      authorization: 'Basic super-secret-dcr-token',
    });
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(401);
  });

  it('returns 201 and registers the client when the correct bearer is presented', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('POST', '/register', REGISTRATION_BODY, {
      authorization: 'Bearer super-secret-dcr-token',
    });
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(201);
    const registered = JSON.parse(call.body);
    expect(registered.client_id).toBeTruthy();
    expect(registered.client_secret).toBeTruthy();
    expect(registered.client_name).toBe('test-dcr-client');
    expect(registered.grant_types).toEqual(['client_credentials']);
    expect(registered.scope).toBe('mcp:invoke');
  });

  it('still 405s a GET before any secret check', async () => {
    process.env.DCR_INITIAL_ACCESS_TOKEN = 'super-secret-dcr-token';

    const call = fakeReqRes('GET', '/register');
    await router.handle(call.req, call.res);

    expect(call.statusCode).toBe(405);
  });
});
