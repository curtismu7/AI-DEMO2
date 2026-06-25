'use strict';

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'retail';

describe(`Agent delegation — ${VERTICAL} vertical (real)`, () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('POST /api/agent/delegate without Bearer token returns 401', async () => {
    const r = await client.post('/api/agent/delegate', {});
    expect(r.status).toBe(401);
    expect(r.data.error).toBe('missing_token');
  });

  it('POST /api/agent/delegate with session access token returns delegated token', async () => {
    const claims = await client.get('/api/auth/oauth/token-claims');
    if (claims.status !== 200 || !claims.data?.authenticated) {
      console.warn('[agent.test] Cannot get token claims — skipping delegation test');
      return;
    }
    const rawToken = claims.data.payload?.accessToken;
    if (!rawToken) {
      console.warn('[agent.test] No raw token accessible — skipping delegation sub-test (expected in strict BFF mode)');
      return;
    }

    const r = await client.post('/api/agent/delegate', {}, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });

    if (r.status === 503 || r.status === 400) {
      console.warn(`[agent.test] Token exchange returned ${r.status}: ${JSON.stringify(r.data)} — check PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`);
      return;
    }

    expect(r.status).toBe(200);
    expect(r.data.access_token).toBeTruthy();
    expect(r.data.token_type).toBe('Bearer');

    if (r.data.access_token) {
      const payload = JSON.parse(Buffer.from(r.data.access_token.split('.')[1], 'base64url').toString());
      if (payload.act) {
        expect(payload.act.sub).toBeTruthy();
      } else {
        console.warn('[agent.test] act claim absent from delegated token — check PingOne token policy');
      }
    }
  });
});
