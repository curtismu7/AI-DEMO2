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

  it('keeps the env-seeded clientId when the client posts a blank one', async () => {
    const res = await request(app)
      .post('/api/privilege-mcp/config')
      .send({ mcpUrl: '', clientId: '', scopes: 'openid profile email' })
      .expect(200);

    expect(res.body.config.clientId).toBe('seeded-client-id');
    expect(res.body.config.mcpUrl).toBe('https://gateway.example.com/mcp');
    expect(res.body.config.scopes).toBe('openid profile email');
  });

  it('still applies a non-blank value', async () => {
    const res = await request(app)
      .post('/api/privilege-mcp/config')
      .send({ clientId: 'operator-supplied-id' })
      .expect(200);

    expect(res.body.config.clientId).toBe('operator-supplied-id');
  });
});
