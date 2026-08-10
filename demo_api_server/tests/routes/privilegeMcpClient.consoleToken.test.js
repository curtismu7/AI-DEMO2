const request = require('supertest');
const app = require('../../server');

// Build a JWT with the given header/payload. Signature is irrelevant here — the
// endpoint decodes claims, it does not verify (the gateway does that).
function jwt(header, payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(payload)}.sig`;
}

describe('POST /api/privilege-mcp/dev/console-token', () => {
  const origEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = origEnv; });

  it('404s in production', async () => {
    process.env.NODE_ENV = 'production';
    await request(app)
      .post('/api/privilege-mcp/dev/console-token')
      .send({ token: 'x' })
      .expect(404);
  });

  it('rejects a blob with no token', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(app)
      .post('/api/privilege-mcp/dev/console-token')
      .send({ curl: "curl 'https://console.privilege.pingone.com/x'" })
      .expect(400);
    expect(res.body.error).toMatch(/no auth_token/i);
  });

  it('rejects an expired token', async () => {
    process.env.NODE_ENV = 'development';
    const expired = jwt({ alg: 'RS256', kid: 'infra-root-jwt' }, { user: 'u', exp: 1 });
    const res = await request(app)
      .post('/api/privilege-mcp/dev/console-token')
      .send({ curl: `curl 'https://x' -b 'auth_token=${expired}'` })
      .expect(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('parses auth_token out of a cURL blob and reports kid match', async () => {
    process.env.NODE_ENV = 'development';
    const future = Math.floor(Date.now() / 1000) + 3600;
    const tok = jwt({ alg: 'RS256', kid: 'infra-root-jwt' }, { user: 'operator-1', exp: future });
    const res = await request(app)
      .post('/api/privilege-mcp/dev/console-token')
      .send({ curl: `curl 'https://console.privilege.pingone.com/x' -b 'auth_token=${tok}; other=1'` })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toBe('operator-1');
    expect(res.body.kidMatchesGateway).toBe(true);
    expect(res.body.expiresInMinutes).toBeGreaterThan(50);
    expect(res.body.mcpUrl).toContain('mcp-pingone-admin');
  });

  it('honors an explicit mcpUrl override', async () => {
    process.env.NODE_ENV = 'development';
    const future = Math.floor(Date.now() / 1000) + 3600;
    const tok = jwt({ alg: 'RS256', kid: 'other' }, { sub: 'sub-2', exp: future });
    const res = await request(app)
      .post('/api/privilege-mcp/dev/console-token')
      .send({ token: tok, mcpUrl: 'https://MCP-aidemo.mcpgw.local.ping-devops.com/mcp' })
      .expect(200);
    expect(res.body.kidMatchesGateway).toBe(false);
    expect(res.body.user).toBe('sub-2');
    expect(res.body.mcpUrl).toBe('https://MCP-aidemo.mcpgw.local.ping-devops.com/mcp');
  });
});
