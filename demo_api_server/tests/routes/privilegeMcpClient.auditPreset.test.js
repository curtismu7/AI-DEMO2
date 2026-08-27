'use strict';

// The /audit-agent page finds its gateway by matching the preset LABEL from
// GET /state, not by hardcoding a URL — so an operator can repoint
// PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT without a UI change. These tests pin the
// two things that contract depends on: the label the page greps for, and the
// env var that overrides the URL. Break either and the page silently falls back
// to "No audit gateway preset is configured" with no server-side error.

const express = require('express');
const request = require('supertest');

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-audit-preset-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

// Matches AUDIT_PRESET in demo_api_ui/src/pages/AuditAgentPage.jsx.
const AUDIT_PRESET = /pingone audit/i;

describe('privilege-mcp /state — audit gateway preset', () => {
  const savedAudit = process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT;

  afterEach(() => {
    if (savedAudit === undefined) delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT;
    else process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT = savedAudit;
  });

  it('offers an audit preset the page can find by label', async () => {
    delete process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT;
    const res = await request(buildApp()).get('/api/privilege-mcp/state');
    expect(res.status).toBe(200);
    const preset = (res.body.presets || []).find((p) => AUDIT_PRESET.test(p.label || ''));
    expect(preset).toBeDefined();
    // The audit application on the agentless gateway, not the agent frontends.
    expect(preset.mode).toBe('agentless');
    expect(preset.url).toMatch(/\/audit\/mcp$/);
  });

  it('lets the environment repoint the audit gateway', async () => {
    process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_AUDIT = 'https://example.test/other/mcp';
    const res = await request(buildApp()).get('/api/privilege-mcp/state');
    const preset = (res.body.presets || []).find((p) => AUDIT_PRESET.test(p.label || ''));
    expect(preset.url).toBe('https://example.test/other/mcp');
  });

  it('does not filter the tool list server-side — policy is the only narrowing', () => {
    // Guard against a future "helpful" allowlist: if the BFF ever filters tools
    // for this door, the page would show the same 3 tools whether the Privilege
    // policy worked or not, and the demo would prove nothing.
    const src = require('fs').readFileSync(
      require.resolve('../../routes/privilegeMcpClient'),
      'utf8',
    );
    expect(src).not.toMatch(/AUDIT_TOOL_ALLOWLIST|auditToolAllowlist/);
  });
});
