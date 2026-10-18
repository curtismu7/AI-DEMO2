/**
 * GET /protected/profile — a tiny REST resource behind the same bearer validation as the MCP
 * tools path. The ID-JAG playground calls it to show a real backend accepting (or refusing) the
 * redeemed access token, check by check.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { handleProtectedProfile } from '../protectedProfile';
import { HttpMCPTransport } from '../HttpMCPTransport';
import { resolveEmbeddedIssuer } from '../../oauth/embeddedIssuer';

const ISS = 'https://oauth-mcp.test';
const RESOURCE = 'https://oauth-mcp.test/protected/profile';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  iss: ISS, sub: 'demouser', aud: 'mcpserver.ping.demo', client_id: 'demo-bff-mcp-client', scope: 'mcp:invoke accounts:read', exp: now() + 300, ...over,
});
const jwt = (c: Record<string, unknown>, typ = 'at+jwt') => `${b64({ alg: 'RS256', typ })}.${b64(c)}.c2ln`;

function run(token: string | null, validate: jest.Mock) {
  const out: { status?: number; headers?: Record<string, string>; body?: any } = {};
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as IncomingMessage;
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => { out.status = status; out.headers = headers; },
    end: (body: string) => { out.body = JSON.parse(body); },
  } as unknown as ServerResponse;
  return handleProtectedProfile(req, res, { validate, acceptedIssuers: [ISS], resourceUrl: RESOURCE }).then(() => out);
}
const verifiedAs = (c: Record<string, unknown>, signatureVerified = true) =>
  jest.fn().mockResolvedValue({ isValid: true, signatureVerified, verifiedClaims: signatureVerified ? c : undefined, scopes: String(c.scope || '').split(' ') });
const failed = (out: any) => out.body.verified[out.body.verified.length - 1];

describe('GET /protected/profile', () => {
  it('serves the profile to a valid access token, with every check it ran', async () => {
    const c = claims();
    const out = await run(jwt(c), verifiedAs(c));
    expect(out.status).toBe(200);
    expect(out.body.resource).toBe(RESOURCE);
    expect(out.body.verified.map((v: any) => v.check)).toEqual(['bearer', 'token type', 'expiry', 'signature', 'audience', 'issuer', 'scope']);
    expect(out.body.verified.every((v: any) => v.ok)).toBe(true);
    expect(out.body.principal).toEqual({ sub: 'demouser', client_id: 'demo-bff-mcp-client', scope: 'mcp:invoke accounts:read' });
    expect(out.body.data).toEqual(expect.objectContaining({ subject: 'demouser' }));
    expect(JSON.stringify(out.body)).not.toContain(jwt(c));
  });

  it('401s with no token, and a bare Bearer challenge', async () => {
    const validate = jest.fn();
    const out = await run(null, validate);
    expect(out.status).toBe(401);
    expect(out.headers!['WWW-Authenticate']).toMatch(/^Bearer realm=/);
    expect(out.body.verified).toEqual([expect.objectContaining({ check: 'bearer', ok: false })]);
    expect(validate).not.toHaveBeenCalled();
  });

  it('refuses an ID-JAG presented as a bearer: it is a grant for the authorization server, not an access token', async () => {
    const validate = jest.fn();
    const out = await run(jwt(claims({ aud: ISS }), 'oauth-id-jag+jwt'), validate);
    expect(out.status).toBe(401);
    expect(out.headers!['WWW-Authenticate']).toContain('error="invalid_token"');
    expect(failed(out)).toEqual(expect.objectContaining({ check: 'token type', ok: false, detail: expect.stringMatching(/ID-JAG/) }));
    expect(validate).not.toHaveBeenCalled();
  });

  it('refuses a token for another audience (the shared validator says so)', async () => {
    const validate = jest.fn().mockRejectedValue(new Error('Token audience does not match MCP server resource URI'));
    const out = await run(jwt(claims({ aud: 'https://other.test' })), validate);
    expect(out.status).toBe(401);
    expect(failed(out)).toEqual(expect.objectContaining({ check: 'audience', ok: false }));
  });

  it('refuses an expired token as expired, not as a bad signature', async () => {
    const validate = jest.fn();
    const out = await run(jwt(claims({ exp: now() - 10 })), validate);
    expect(out.status).toBe(401);
    expect(failed(out)).toEqual(expect.objectContaining({ check: 'expiry', ok: false }));
    expect(validate).not.toHaveBeenCalled();
  });

  it('refuses a signature it could not verify, and an issuer it does not trust', async () => {
    const c = claims();
    expect(failed(await run(jwt(c), verifiedAs(c, false)))).toEqual(expect.objectContaining({ check: 'signature', ok: false }));
    const evil = claims({ iss: 'https://evil.test' });
    expect(failed(await run(jwt(evil), verifiedAs(evil)))).toEqual(expect.objectContaining({ check: 'issuer', ok: false }));
  });

  it('serves the profile to the generic read scope (all an xaa.dev IdenX ID-JAG grants)', async () => {
    const c = claims({ scope: 'read' });
    const out = await run(jwt(c), verifiedAs(c));
    expect(out.status).toBe(200);
  });

  it('403s insufficient_scope when the token carries none of the profile scopes', async () => {
    const c = claims({ scope: 'openid profile' });
    const out = await run(jwt(c), verifiedAs(c));
    expect(out.status).toBe(403);
    expect(out.headers!['WWW-Authenticate']).toContain('error="insufficient_scope"');
    expect(failed(out)).toEqual(expect.objectContaining({ check: 'scope', ok: false }));
  });
});

describe('HttpMCPTransport routes /protected/profile through the MCP path validator', () => {
  it('uses authManager.validateAgentToken and the same RFC 9207 issuers', async () => {
    const c = claims({ iss: resolveEmbeddedIssuer() });
    const t = Object.create(HttpMCPTransport.prototype) as any;
    t.config = { authServerUrl: 'https://auth.pingone.com/env/as', resourceUrl: 'https://mcp.example.com', allowedOrigins: [] };
    t.authManager = { validateAgentToken: verifiedAs(c) };
    t.isOriginAllowed = () => true;
    const out: any = {};
    const req = { method: 'GET', headers: { authorization: `Bearer ${jwt(c)}` } } as unknown as IncomingMessage;
    const res = { writeHead: (s: number) => { out.status = s; }, end: (b: string) => { out.body = JSON.parse(b); } } as unknown as ServerResponse;
    await t.handleRequestImpl(req, res, '/protected/profile');
    expect(out.status).toBe(200);
    expect(t.authManager.validateAgentToken).toHaveBeenCalledWith(jwt(c));
    expect(out.body.resource).toBe('https://mcp.example.com/protected/profile');
  });
});
