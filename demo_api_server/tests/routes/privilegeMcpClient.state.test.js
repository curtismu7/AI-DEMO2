const request = require('supertest');
const app = require('../../server');

describe('GET /api/privilege-mcp/state — mcpUrl default', () => {
  const original = process.env.PRIVILEGE_MCPGW_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = original;
  });

  it('seeds config.mcpUrl from PRIVILEGE_MCPGW_URL when set', async () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://local.ping-devops.com:8623/mcp';

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe('https://local.ping-devops.com:8623/mcp');
  });

  it('leaves config.mcpUrl empty when PRIVILEGE_MCPGW_URL is unset', async () => {
    delete process.env.PRIVILEGE_MCPGW_URL;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe('');
  });
});
