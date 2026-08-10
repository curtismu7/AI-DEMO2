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

  // Independent of the model: the wrapper must DROP environmentId rather than
  // forward it, so a model that ignores the instruction still works.
  //
  // This invokes execute() against a mocked adapter and inspects what the
  // adapter actually received. An earlier version asserted on the source text
  // of the destructuring instead — that passes on a string and proves nothing
  // about behaviour, and would survive a refactor that reintroduced the bug.
  it('strips environmentId before the adapter is called', async () => {
    jest.resetModules();
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
      { name: 'listUsers', arguments: { environmentId: 'should-not-be-forwarded', limit: 5 } },
      {},
    );

    expect(callTool).toHaveBeenCalledTimes(1);
    const [toolName, forwardedArgs] = callTool.mock.calls[0];
    expect(toolName).toBe('listUsers');
    expect(forwardedArgs).not.toHaveProperty('environmentId');
    // the caller's other arguments must survive
    expect(forwardedArgs).toMatchObject({ limit: 5 });
  });

});
