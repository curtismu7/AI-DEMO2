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

  it('defaults to the AI Gateway path when no URL override is set', async () => {
    // The old default named a per-owner gateway that no longer exists; the page
    // opened on a dead URL. Default mode is `privilege`, so this is its URL.
    delete process.env.PRIVILEGE_MCPGW_URL;
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.gatewayMode).toBe('privilege');
    expect(res.body.config.mcpUrl).toMatch(/^https:\/\/mcpgw\.ai-demo\.ping-devops\.com\/[\w.-]+\/mcp$/);
  });

  it('omits the banking preset when PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING is unset — the three paths are unaffected', async () => {
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.presets.some((p) => p.label.includes('banking'))).toBe(false);
    // Was pinned to the retired per-owner URL (/cmuir/mcp); the three paths are
    // what must survive, and they are identified by mode rather than hostname.
    expect(res.body.presets.map((p) => p.mode)).toEqual(
      expect.arrayContaining(['direct', 'privilege', 'facade']),
    );
  });

  it('adds a banking preset alongside the existing ones when PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING is set', async () => {
    process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING =
      'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp';

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: 'privilege',
          url: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp',
        }),
      ]),
    );
    // The three paths are still present alongside it.
    expect(res.body.presets.map((p) => p.mode)).toEqual(
      expect.arrayContaining(['direct', 'privilege', 'facade']),
    );
  });
});
