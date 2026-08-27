const request = require('supertest');
const app = require('../../server');

describe('GET /api/privilege-mcp/state — mcpUrl default', () => {
  const original = process.env.PRIVILEGE_MCPGW_URL;
  const originalAgentless = process.env.PRIVILEGE_AGENTLESS_MCPGW_URL;
  const originalBanking = process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING;

  afterEach(() => {
    if (original === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = original;
    if (originalAgentless === undefined) delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL;
    else process.env.PRIVILEGE_AGENTLESS_MCPGW_URL = originalAgentless;
    if (originalBanking === undefined) delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING;
    else process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING = originalBanking;
  });

  it('seeds config.mcpUrl from PRIVILEGE_MCPGW_URL when set', async () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://local.ping-devops.com:8623/mcp';

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe('https://local.ping-devops.com:8623/mcp');
  });

  it('uses the deployed Agentless gateway when no URL override is set', async () => {
    delete process.env.PRIVILEGE_MCPGW_URL;
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe(
      'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp',
    );
  });

  it('omits the banking preset when PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING is unset — existing cmuir preset unaffected', async () => {
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.presets.some((p) => p.label.includes('banking'))).toBe(false);
    expect(res.body.presets.some((p) => p.url.includes('/cmuir/mcp'))).toBe(true);
  });

  it('adds a banking preset alongside the existing ones when PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING is set', async () => {
    process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING =
      'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp';

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: 'agentless',
          url: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp',
        }),
      ]),
    );
    // Existing presets still present, unchanged.
    expect(res.body.presets.some((p) => p.url.includes('/cmuir/mcp'))).toBe(true);
  });
});
