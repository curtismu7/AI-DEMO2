'use strict';

jest.mock('../../services/bffMcpToolExecutor', () => ({ executeBffTool: jest.fn() }));
const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const plugin = require('../../config/verticals/oauth-teaching');

beforeEach(() => executeBffTool.mockReset());

describe('oauth-teaching P4 — registration', () => {
  it('marks the three demonstrate tools (and the demonstrate alias) as local', () => {
    ['demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl', 'demonstrate']
      .forEach((n) => expect(plugin.isLocalTool(n)).toBe(true));
  });

  it('advertises the three tools with an inputSchema', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(
      ['demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl']));
    plugin.getTools()
      .filter((t) => t.name.startsWith('demonstrate_'))
      .forEach((t) => expect(t.inputSchema).toBeDefined());
  });

  it('routes demonstrate phrases to the right tool', () => {
    const hs = plugin.getHeuristics();
    const route = (msg) => { const h = hs.find((x) => x.re.test(msg)); return h && h.action; };
    expect(route('demonstrate a real token exchange')).toBe('demonstrate_token_exchange');
    expect(route('demonstrate a scope denial')).toBe('demonstrate_scope_denial');
    expect(route('demonstrate hitl with a real transfer')).toBe('demonstrate_hitl');
  });
});

describe('oauth-teaching P4 — not signed in', () => {
  it.each([
    ['demonstrate_token_exchange'],
    ['demonstrate_scope_denial'],
    ['demonstrate_hitl'],
  ])('%s returns a sign-in prompt and never calls the pipeline', async (tool) => {
    const out = await plugin.executeTool(tool, {}, { userToken: null });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/sign\s*in/i);
    expect(executeBffTool).not.toHaveBeenCalled();
  });
});

describe('demonstrate_token_exchange — signed in', () => {
  it('calls get_my_accounts, narrates the exchange, and preserves token events', async () => {
    executeBffTool.mockImplementation(async ({ name, tokenEvents }) => {
      expect(name).toBe('get_my_accounts');
      tokenEvents.push({ id: 'user-token', label: 'T1' });
      tokenEvents.push({ id: 'mcp-exchange', label: 'T2' });
      return JSON.stringify({ accounts: [{ id: 'a1' }, { id: 'a2' }] });
    });
    const tokenEvents = [];
    const out = await plugin.executeTool('demonstrate_token_exchange', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents, sessionId: 's1' });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/RFC 8693/);
    expect(executeBffTool).toHaveBeenCalledTimes(1);
    expect(tokenEvents).toHaveLength(2);
  });

  it('surfaces an error honestly when the exchange fails', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ error: 'mcp_error', message: 'boom' }));
    const out = await plugin.executeTool('demonstrate_token_exchange', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/error/i);
    expect(out.result.text).toMatch(/mcp_error/);
  });
});

describe('demonstrate_scope_denial — signed in', () => {
  it('narrates the real denial and the missing scope', async () => {
    executeBffTool.mockImplementation(async ({ name }) => {
      expect(name).toBe('get_investment_balance');
      return JSON.stringify({ error: 'insufficient_scope', required_scopes: ['invest:read'] });
    });
    const out = await plugin.executeTool('demonstrate_scope_denial', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/denied/i);
    expect(out.result.text).toMatch(/invest:read/);
  });

  it('is honest when the call is unexpectedly permitted (no fake denial)', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ balance: 1000 }));
    const out = await plugin.executeTool('demonstrate_scope_denial', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/permitted|already carries/i);
    expect(out.result.text).not.toMatch(/denied/i);
  });
});

describe('demonstrate_hitl — signed in', () => {
  // get_my_accounts succeeds; create_transfer returns the pipeline 428 body.
  function mockAccountsThenTransfer(transferResult) {
    executeBffTool.mockImplementation(async ({ name, args }) => {
      if (name === 'get_my_accounts') return JSON.stringify({ accounts: [{ id: 'a1' }, { id: 'a2' }] });
      if (name === 'create_transfer') { mockAccountsThenTransfer.lastArgs = args; return JSON.stringify(transferResult); }
      throw new Error(`unexpected tool ${name}`);
    });
  }

  it('translates the pipeline 428 into the UI hitl_required + hitlChallengeId shape', async () => {
    mockAccountsThenTransfer({ error: 'mcp_hitl_required', challengeId: 'chal-9', taskId: 'chal-9' });
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.error).toBe('hitl_required');
    expect(out.result.hitlChallengeId).toBe('chal-9');
    expect(out.result.hitl).toEqual({ type: 'consent' });
    expect(out.result.text).toMatch(/300/);
    // amount comes from the constant, not params
    expect(mockAccountsThenTransfer.lastArgs.amount).toBe(300);
    expect(mockAccountsThenTransfer.lastArgs.from_account_id).toBe('a1');
    expect(mockAccountsThenTransfer.lastArgs.to_account_id).toBe('a2');
    expect(mockAccountsThenTransfer.lastArgs._hitl_challenge_id).toBeUndefined();
  });

  it('echoes _hitl_challenge_id on the approve-retry and narrates the executed transfer', async () => {
    mockAccountsThenTransfer({ ok: true, transactionId: 'tx-1' });
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1', hitlChallengeId: 'chal-9' });
    expect(mockAccountsThenTransfer.lastArgs._hitl_challenge_id).toBe('chal-9');
    expect(out.result.error).toBeUndefined();
    expect(out.result.text).toMatch(/executed|went through|moved/i);
  });

  it('returns an honest message when fewer than two accounts exist', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ accounts: [{ id: 'a1' }] }));
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/two of your accounts/i);
    expect(out.result.error).toBeUndefined();
  });
});
