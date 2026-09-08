const request = require('supertest');
const app = require('../../server');

describe('POST /api/privilege-mcp/config — blank values do not overwrite', () => {
  const originalClientId = process.env.PRIVILEGE_SSO_CLIENT_ID;
  const originalMcpUrl = process.env.PRIVILEGE_MCPGW_URL;

  beforeEach(() => {
    process.env.PRIVILEGE_SSO_CLIENT_ID = 'seeded-client-id';
    process.env.PRIVILEGE_MCPGW_URL = 'https://gateway.example.com/mcp';
  });

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.PRIVILEGE_SSO_CLIENT_ID;
    else process.env.PRIVILEGE_SSO_CLIENT_ID = originalClientId;
    if (originalMcpUrl === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = originalMcpUrl;
  });

  // clientId is no longer seeded from PRIVILEGE_SSO_CLIENT_ID — that is a
  // client_credentials worker client, not a browser app, and PingOne answers its
  // /as/authorize with a bare NOT_FOUND. So the value this protects is one the
  // OPERATOR set; the blank-does-not-overwrite rule itself is unchanged.
  it('a blank clientId does not wipe one the operator already set', async () => {
    // One agent, so both posts land on the same BFF session — config is stored
    // per session, and a bare request() gets a fresh cookie each time.
    const agent = request.agent(app);
    await agent
      .post('/api/privilege-mcp/config')
      .send({ clientId: 'operator-supplied-id' })
      .expect(200);

    const res = await agent
      .post('/api/privilege-mcp/config')
      .send({ mcpUrl: '', clientId: '', scopes: 'openid profile email' })
      .expect(200);

    expect(res.body.config.clientId).toBe('operator-supplied-id');
    expect(res.body.config.mcpUrl).toBe('https://gateway.example.com/mcp');
    expect(res.body.config.scopes).toBe('openid profile email');
  });

  it('does not seed clientId from the Privilege SSO worker client', async () => {
    const res = await request(app).get('/api/privilege-mcp/state').expect(200);
    for (const [mode, cfg] of Object.entries(res.body.gatewayConfigs || {})) {
      expect([mode, cfg.clientId]).not.toEqual([mode, 'seeded-client-id']);
    }
    // ...and the page is told what supplies the client instead, so a blank
    // field reads as "handled" rather than "missing".
    expect(res.body.clientHints.privilege).toMatch(/dynamic/i);
    expect(res.body.clientHints.facade).toMatch(/broker/i);
  });

  it('still applies a non-blank value', async () => {
    const res = await request(app)
      .post('/api/privilege-mcp/config')
      .send({ clientId: 'operator-supplied-id' })
      .expect(200);

    expect(res.body.config.clientId).toBe('operator-supplied-id');
  });

  it('stores each path\'s settings independently', async () => {
    // Switching path must not drag the previous path's URL or client id along:
    // the three are different front doors and a crossed credential fails in a
    // way that reads like a broken gateway.
    const browser = request.agent(app);
    const directUrl = 'https://ai-demo.example/mcp-facade/opensearch/mcp';
    const direct = await browser
      .post('/api/privilege-mcp/config')
      .send({ gatewayMode: 'direct', mcpUrl: directUrl, clientId: 'direct-client' })
      .expect(200);

    expect(direct.body.gatewayMode).toBe('direct');
    expect(direct.body.config).toMatchObject({ mcpUrl: directUrl, clientId: 'direct-client' });

    const facade = await browser
      .post('/api/privilege-mcp/config')
      .send({ gatewayMode: 'facade', mcpUrl: 'https://ai-demo.example/mcp-facade/privilege-gateway/app/mcp', clientId: 'facade-client' })
      .expect(200);

    expect(facade.body.gatewayMode).toBe('facade');
    expect(facade.body.config).toMatchObject({
      mcpUrl: 'https://ai-demo.example/mcp-facade/privilege-gateway/app/mcp',
      clientId: 'facade-client',
    });
    expect(facade.body.gatewayConfigs.direct).toMatchObject({ mcpUrl: directUrl, clientId: 'direct-client' });
    expect(facade.body.gatewayConfigs.facade).toMatchObject({
      mcpUrl: 'https://ai-demo.example/mcp-facade/privilege-gateway/app/mcp',
      clientId: 'facade-client',
    });
  });

  it('restores a mode\'s own token on switch-back instead of forcing a redundant re-auth', async () => {
    // session.oauth is a single slot shared across all three modes — switching
    // away used to leave the outgoing mode's token in place (falsely reporting
    // "authenticated" for a mode that never issued it) or silently drop it
    // (forcing the sign-in modal every time you returned to a mode you were
    // already signed into). Both are covered here.
    const browser = request.agent(app);

    // Bearer header seeds session.oauth.accessToken directly (see
    // getClientSession) — a fast stand-in for completing the real OAuth dance.
    const privilege = await browser
      .post('/api/privilege-mcp/config')
      .set('Authorization', 'Bearer privilege-token')
      .send({ gatewayMode: 'privilege', mcpUrl: 'https://gw.example/mcp' })
      .expect(200);
    expect(privilege.body.oauth.authenticated).toBe(true);

    // Switch to façade, never signed in there — must NOT inherit privilege's
    // token (the real gateway rejects a foreign-audience token outright).
    const facade = await browser
      .post('/api/privilege-mcp/config')
      .send({ gatewayMode: 'facade', mcpUrl: 'https://ai-demo.example/mcp-facade/privilege-gateway/app/mcp' })
      .expect(200);
    expect(facade.body.oauth.authenticated).toBe(false);

    // Switch back to privilege — its earlier token must come back on its own,
    // with no fresh Authorization header on this request.
    const backToPrivilege = await browser
      .post('/api/privilege-mcp/config')
      .send({ gatewayMode: 'privilege' })
      .expect(200);
    expect(backToPrivilege.body.oauth.authenticated).toBe(true);
  });

  it('does not restore an expired stash as authenticated', async () => {
    // A token stashed hours ago (this demo runs for hours with lots of mode
    // switching) can easily have expired by the time you switch back to that
    // mode. Reporting authenticated: true anyway hands tools/list a dead
    // token instead of the frontend getting a fresh one via /auth/start.
    const MCP_URL = 'https://gw.example/mcp';
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (String(url) === MCP_URL) {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ authorization_uri: 'https://auth.example/authorize', token_uri: 'https://auth.example/token' }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ access_token: 'access-1', expires_in: -100 }) };
    });

    try {
      const browser = request.agent(app);
      await browser.post('/api/privilege-mcp/config').send({ gatewayMode: 'privilege', mcpUrl: MCP_URL, clientId: 'client-abc' }).expect(200);
      const start = await browser.post('/api/privilege-mcp/auth/start').send({}).expect(200);
      const state = new URL(start.body.authUrl).searchParams.get('state');
      await browser.get(`/api/privilege-mcp/auth/callback?code=code-1&state=${encodeURIComponent(state)}`).expect(302);

      await browser.post('/api/privilege-mcp/config').send({ gatewayMode: 'facade' }).expect(200);
      const backToPrivilege = await browser.post('/api/privilege-mcp/config').send({ gatewayMode: 'privilege' }).expect(200);
      expect(backToPrivilege.body.oauth.authenticated).toBe(false);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('falls back to the current path when handed an unknown mode', async () => {
    const browser = request.agent(app);
    const res = await browser
      .post('/api/privilege-mcp/config')
      .send({ gatewayMode: 'agent', mcpUrl: 'https://example/mcp' })
      .expect(200);

    // 'agent' was retired; silently accepting it would put the page on a path
    // that no longer exists.
    expect(['direct', 'privilege', 'facade']).toContain(res.body.gatewayMode);
    expect(res.body.gatewayMode).not.toBe('agent');
  });
});
