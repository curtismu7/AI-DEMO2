import { Readable } from 'stream';
import { IncomingMessage, ServerResponse } from 'http';
import { HttpMCPTransport } from '../HttpMCPTransport';

/**
 * RFC 9728 metadata is the hinge of MCP discovery: a client that gets a 401
 * reads this document to learn WHICH authorization server to go to. Point it at
 * PingOne while admitting self-registering clients and every such client
 * dead-ends at an AS that cannot register it.
 */
function fakeReqRes(urlPath: string) {
  const req = Readable.from([Buffer.from('')]) as unknown as IncomingMessage & {
    method: string; url: string; headers: Record<string, string>;
  };
  req.method = 'GET';
  req.url = urlPath;
  req.headers = { host: 'localhost:8080' };

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
    get json() { return JSON.parse(responseBody); },
  };
}

function makeTransport() {
  return new HttpMCPTransport(
    {
      resourceUrl: 'http://mcp-server:8080',
      authServerUrl: 'https://auth.pingone.com/env-id/as',
      allowedOrigins: [],
    } as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('GET /.well-known/oauth-protected-resource', () => {
  const ORIG = { ...process.env };
  afterEach(() => { process.env = { ...ORIG }; });

  it('advertises PingOne and the in-cluster resource when open registration is off', async () => {
    delete process.env.MCP_OPEN_CLIENT_REGISTRATION;
    delete process.env.OAUTH_ISSUER;

    const call = fakeReqRes('/.well-known/oauth-protected-resource');
    await (makeTransport() as never as {
      handleRequest: (a: IncomingMessage, b: ServerResponse, c: string) => Promise<void>;
    }).handleRequest(call.req, call.res, '/.well-known/oauth-protected-resource');

    expect(call.statusCode).toBe(200);
    expect(call.json.authorization_servers).toEqual(['https://auth.pingone.com/env-id/as']);
    expect(call.json.resource).toBe('http://mcp-server:8080/mcp');
  });

  it('advertises the embedded AS and public resource when open registration is on', async () => {
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    process.env.OAUTH_ISSUER = 'https://cmuir-mcp.ping-devops.com';

    const call = fakeReqRes('/.well-known/oauth-protected-resource');
    await (makeTransport() as never as {
      handleRequest: (a: IncomingMessage, b: ServerResponse, c: string) => Promise<void>;
    }).handleRequest(call.req, call.res, '/.well-known/oauth-protected-resource');

    expect(call.statusCode).toBe(200);
    // The AS a self-registering client must use — NOT PingOne, which has no DCR.
    expect(call.json.authorization_servers).toEqual(['https://cmuir-mcp.ping-devops.com']);
    expect(call.json.authorization_servers[0]).not.toContain('pingone.com');
    // Addressed as an external client reaches it, not by the in-cluster name.
    expect(call.json.resource).toBe('https://cmuir-mcp.ping-devops.com/mcp');
  });

  it('also answers the RFC 9728 §3.1 resource-path-suffixed form (.../oauth-protected-resource/mcp)', async () => {
    // Confirmed live via MCP Inspector: it requests the suffixed form, not the
    // bare well-known path. Before this fix the request fell through to a 404
    // here even after the ingress routed it correctly.
    process.env.MCP_OPEN_CLIENT_REGISTRATION = 'true';
    process.env.OAUTH_ISSUER = 'https://cmuir-mcp.ping-devops.com';

    const call = fakeReqRes('/.well-known/oauth-protected-resource/mcp');
    await (makeTransport() as never as {
      handleRequest: (a: IncomingMessage, b: ServerResponse, c: string) => Promise<void>;
    }).handleRequest(call.req, call.res, '/.well-known/oauth-protected-resource/mcp');

    expect(call.statusCode).toBe(200);
    expect(call.json.authorization_servers).toEqual(['https://cmuir-mcp.ping-devops.com']);
    expect(call.json.resource).toBe('https://cmuir-mcp.ping-devops.com/mcp');
  });

  it('does not match an unrelated path that merely shares the prefix', async () => {
    const call = fakeReqRes('/.well-known/oauth-protected-resource-unrelated');
    await (makeTransport() as never as {
      handleRequest: (a: IncomingMessage, b: ServerResponse, c: string) => Promise<void>;
    }).handleRequest(call.req, call.res, '/.well-known/oauth-protected-resource-unrelated');

    expect(call.statusCode).not.toBe(200);
  });
});
