'use strict';

/**
 * The PingOne environment is fixed server-side: PingOneUserService builds
 * baseUrl as /v1/environments/{PINGONE_ENVIRONMENT_ID}, and the hosted MCP
 * session is scoped the same way. Every admin call is therefore already
 * pointed at the right environment before it leaves the BFF.
 *
 * The admin agent did not know that. Running Demo step ADMIN2 ("List users")
 * produced "I need the ID of the PingOne environment you're working in" —
 * the model applying general PingOne knowledge, because nothing in its system
 * prompt said the environment was already decided. A demo step that stops to
 * ask for a value the server holds is a dead end.
 *
 * Two guards, because a prompt instruction only works if the model complies
 * and the admin agent's provider is configurable.
 */

const { buildAdminSystemPrompt } = require('../config/admin/systemPrompt');

describe('admin agent — environment is fixed server-side', () => {
  it('tells the model never to ask for or pass an environment ID', () => {
    const prompt = buildAdminSystemPrompt(null);
    expect(prompt).toMatch(/never ask the admin for an environment id/i);
    expect(prompt).toMatch(/never pass environmentid/i);
  });

  it('keeps that instruction when a customer is already selected', () => {
    const prompt = buildAdminSystemPrompt({ id: 'u1', name: 'Demo User' });
    expect(prompt).toMatch(/never ask the admin for an environment id/i);
  });

  // "show me all apps that start with Demo" returned all 46 apps: the prompt
  // only taught the sw-filter pattern for listUsers, so the model called
  // listApplications bare. The guidance must name the filter field for every
  // list tool, and must forbid filtering capped rows client-side.
  it('teaches the sw filter for applications and populations, not just users', () => {
    const prompt = buildAdminSystemPrompt(null);
    expect(prompt).toMatch(/username for\s+listUsers/i);
    expect(prompt).toMatch(/name for listApplications and listPopulations/i);
    expect(prompt).toMatch(/name sw "Demo"/);
    expect(prompt).toMatch(/never answer a prefix request by listing everything/i);
  });

  // Independent of the model: a model-supplied environmentId must never reach
  // the adapter — the wrapper replaces it with the CONFIGURED one. The first
  // version of this contract (#1520) dropped the argument entirely, but the
  // hosted MCP tool schemas require environmentId (listUsers fails -32602
  // without it — verified live 2026-08-10), so the drop broke every live call.
  // Injection preserves #1520's intent (the model never chooses the
  // environment) while satisfying the schema.
  //
  // This invokes execute() against a mocked adapter and inspects what the
  // adapter actually received. An earlier version asserted on the source text
  // of the destructuring instead — that passes on a string and proves nothing
  // about behaviour, and would survive a refactor that reintroduced the bug.
  it('replaces a model-supplied environmentId with the configured one', async () => {
    jest.resetModules();
    const savedEnvId = process.env.PINGONE_ENVIRONMENT_ID;
    process.env.PINGONE_ENVIRONMENT_ID = 'configured-env-id';
    try {
      const callTool = jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ _embedded: { users: [] } }) }],
      });
      jest.doMock('../services/mcpPingOneHttpAdapter', () => ({
        callTool,
        listTools: jest.fn().mockResolvedValue([]),
      }));

      const { execute } = require('../config/verticals/pingone-admin/tools');
      await execute(
        'call_pingone_tool',
        { name: 'listUsers', arguments: { environmentId: 'model-supplied-must-not-win', limit: 5 } },
        {},
      );

      expect(callTool).toHaveBeenCalledTimes(1);
      const [toolName, forwardedArgs] = callTool.mock.calls[0];
      expect(toolName).toBe('listUsers');
      // the schema-required argument is present, and it is OURS, not the model's
      expect(forwardedArgs.environmentId).toBe('configured-env-id');
      // the caller's other arguments must survive
      expect(forwardedArgs).toMatchObject({ limit: 5 });
    } finally {
      if (savedEnvId === undefined) delete process.env.PINGONE_ENVIRONMENT_ID;
      else process.env.PINGONE_ENVIRONMENT_ID = savedEnvId;
    }
  });

});
