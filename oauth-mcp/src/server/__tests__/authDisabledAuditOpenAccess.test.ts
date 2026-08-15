import { HttpMCPTransport } from '../HttpMCPTransport';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * GET /audit under MCP_AUTH_DISABLED must not fail closed on the admin:read
 * scope gate. PingOne refuses to mint admin:read alongside mcp:invoke in one
 * client-credentials token ("May not request scopes for multiple resources"),
 * so the BFF token-chain poll can never present admin:read — every fetch
 * answered 403 and the ProofStrip reported "Run failed before
 * authorize-decision" on runs that actually succeeded.
 */
describe('HttpMCPTransport /audit — MCP_AUTH_DISABLED open access', () => {
  afterEach(() => { delete process.env.MCP_AUTH_DISABLED; });

  function transport(opts: { hasScopes: boolean }) {
    const t = Object.create(HttpMCPTransport.prototype) as Record<string, unknown>;
    t.authDisabled = process.env.MCP_AUTH_DISABLED === 'true';
    t.authManager = {
      validateAgentToken: async () => ({ isValid: true, scopes: ['mcp:invoke'] }),
      validateTokenScopes: async () => opts.hasScopes,
    };
    t.handleAuditQuery = jest.fn(async (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    t.isOriginAllowed = () => true;
    t.config = { resourceUrl: 'http://localhost:8080' };
    return t as unknown as {
      handleRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
      handleAuditQuery: jest.Mock;
    };
  }

  const req = (method: string) =>
    ({ method, headers: { authorization: 'Bearer real.jwt.token' }, url: '/audit' }) as unknown as IncomingMessage;

  function res() {
    const r = { statusCode: 0, body: '', writeHead(code: number) { r.statusCode = code; }, end(b?: string) { r.body = b || ''; } };
    return r as unknown as ServerResponse & { statusCode: number; body: string };
  }

  it('serves GET /audit despite missing admin:read when MCP_AUTH_DISABLED=true', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    const t = transport({ hasScopes: false });
    const r = res();
    await t.handleRequest(req('GET'), r, '/audit');
    expect(t.handleAuditQuery).toHaveBeenCalled();
    expect(r.statusCode).toBe(200);
  });

  it('still 403s GET /audit on missing admin:read when auth is enforced', async () => {
    const t = transport({ hasScopes: false });
    const r = res();
    await t.handleRequest(req('GET'), r, '/audit');
    expect(t.handleAuditQuery).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(403);
  });

  it('allows DELETE /audit despite missing admin:write when MCP_AUTH_DISABLED=true', async () => {
    process.env.MCP_AUTH_DISABLED = 'true';
    const t = transport({ hasScopes: false });
    const r = res();
    await t.handleRequest(req('DELETE'), r, '/audit');
    expect(r.statusCode).toBe(200);
  });
});
