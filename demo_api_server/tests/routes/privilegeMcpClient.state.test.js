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

  it('offers the Privilege banking preset by default, pointed at openapi2 — the three paths are unaffected', async () => {
    // Dark from 2026-09-01 to 2026-09-08: the preset was env-gated into
    // invisibility because its only URL named a torn-down gateway. `openapi2` is
    // the banking Agentic App on the current gateway, so it now has a real
    // default — an operator should not need to know an env var exists to pick
    // the banking door.
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    // Distinct from "Direct — Banking (oauth-mcp)", a different, always-on door.
    const banking = res.body.presets.find(
      (p) => p.mode === 'privilege' && p.label.toLowerCase().includes('banking'),
    );
    expect(banking).toBeDefined();
    expect(banking.url).toBe('https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp');
    // The regression that made it dark: never the retired per-owner gateway.
    expect(banking.url).not.toContain('cmuir-agentless-mcpgw');
    // The three paths must survive, identified by mode rather than hostname.
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

  it('always offers the sibling Direct doors (Brave, Banking, PingOne Admin) alongside the default OpenSearch one', async () => {
    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    const directLabels = res.body.presets.filter((p) => p.mode === 'direct').map((p) => p.label);
    expect(directLabels).toEqual(
      expect.arrayContaining([
        '1 · Direct — no Privilege in the path',
        'Direct — Brave Search',
        'Direct — Banking (oauth-mcp)',
        'Direct — PingOne Admin',
      ]),
    );
  });

  it('offers the sibling opensearch/brave Agentic Apps for both Privilege and Façade mode', async () => {
    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    const privilegeLabels = res.body.presets.filter((p) => p.mode === 'privilege').map((p) => p.label);
    expect(privilegeLabels).toEqual(expect.arrayContaining(['Privilege — opensearch', 'Privilege — brave']));

    const facadeLabels = res.body.presets.filter((p) => p.mode === 'facade').map((p) => p.label);
    expect(facadeLabels).toEqual(expect.arrayContaining(['Façade — opensearch', 'Façade — brave']));

    // Each app is a distinct URL, not three copies of the same default app.
    const privilegeUrls = res.body.presets.filter((p) => p.mode === 'privilege').map((p) => p.url);
    expect(new Set(privilegeUrls).size).toBe(privilegeUrls.length);
  });
});
