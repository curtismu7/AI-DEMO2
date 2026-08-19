'use strict';

/**
 * WR-07 — heuristicBankingWr07.regression.test.js
 *
 * (a) Non-Error throws from the write tool call are surfaced and not swallowed.
 * (a2) Non-Error throws from the data store (before executeBffTool) propagate.
 * (b) The transfer description is sanitized before being passed to executeBffTool.
 * (b control) Benign labels pass through unchanged.
 *
 * Tests call dispatchBankingAction directly (exported via __test) — the WR-07
 * properties live in that layer, not the full processAgentMessage stack.
 */

const TEST_CONFIG = { ff_heuristic_enabled: 'true' };

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => TEST_CONFIG[key] ?? null),
  get: jest.fn((key) => TEST_CONFIG[key] ?? null),
}));

jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));

const mockExecuteBffTool = jest.fn();
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: (...args) => mockExecuteBffTool(...args),
  callMcpToolAsAgent: jest.fn(),
}));

const mockGetAccounts = jest.fn();
jest.mock('../../data/store', () => ({
  getAccountsByUserId: (...a) => mockGetAccounts(...a),
}));

jest.mock('../../services/agentBuilder', () => {
  const actual = jest.requireActual('../../services/agentBuilder');
  return {
    ...actual,
    createBankingAgent: jest.fn(async () => {
      throw new Error('LLM_FALLTHROUGH: heuristic write error must NOT reach the LLM path');
    }),
  };
});

const { dispatchBankingAction } = require('../../services/demoAgentLangGraphService');

const ctx = () => ({ userToken: 'tok-1', req: null, isAdmin: false });

describe('WR-07 — heuristic write error handling + description sanitization (regression)', () => {
  beforeEach(() => {
    mockExecuteBffTool.mockReset();
    mockGetAccounts.mockReset();
    mockGetAccounts.mockResolvedValue([
      { id: 'acc-chk', accountType: 'checking', balance: 5000 },
      { id: 'acc-sav', accountType: 'savings', balance: 1000 },
    ]);
  });

  test('Protected RAG dispatches code_search with the exact query and returns grounded hits', async () => {
    const req = { sessionID: 'session-1', body: { useCaseId: 'code-search' } };
    mockExecuteBffTool.mockResolvedValue('demo_api_server/services/agentMcpTokenService.js:1239-1260\nrequiredScopes');

    const result = await dispatchBankingAction(
      'code_search',
      { query: 'BFF MCP token exchange', limit: 5 },
      'user-1',
      { userToken: 'tok-1', req, isAdmin: false },
    );

    expect(mockExecuteBffTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'code_search',
      args: { query: 'BFF MCP token exchange', limit: 5 },
      userId: 'user-1',
      userToken: 'tok-1',
      req,
      sessionId: 'session-1',
    }));
    expect(result).toMatchObject({
      success: true,
      toolsCalled: ['code_search'],
    });
    expect(result.reply).toContain('agentMcpTokenService.js:1239-1260');
  });

  test('(a) a non-Error throw from the write tool call is surfaced and not swallowed', async () => {
    mockExecuteBffTool.mockImplementation(() => { throw 'string-failure-not-an-error'; });

    // The write-action catch in demoAgentLangGraphService.js resolves a structured
    // failure (rather than rejecting) so the Token Chain panel keeps tokenEvents on
    // NL failure (see commit 85af033578). The thrown value must still be surfaced —
    // here, in `message`/`reply` — not silently dropped.
    const result = await dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx());

    expect(result.success).toBe(false);
    expect(result.message).toBe('string-failure-not-an-error');
    expect(result.reply).toContain('string-failure-not-an-error');

    expect(mockExecuteBffTool).toHaveBeenCalledTimes(1);
  });

  test('(a2) a non-Error throw from the data store propagates — executeBffTool never reached', async () => {
    mockGetAccounts.mockImplementation(() => { throw 'ds-non-error-failure'; });

    // dispatchBankingAction re-throws non-Error from the outer catch for write actions.
    // The thrown value may be a string (not an Error), so we assert rejects rather than toThrow.
    await expect(
      dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx())
    ).rejects.toBeDefined();

    expect(mockExecuteBffTool).not.toHaveBeenCalled();
  });

  test('(b) transfer description built from injection-ish account labels is sanitized', async () => {
    mockGetAccounts.mockResolvedValue([
      { id: 'checking', accountType: '${process.env.SECRET}<b>', balance: 5000 },
      { id: 'savings', accountType: 'savings`rm -rf`', balance: 1000 },
    ]);
    mockExecuteBffTool.mockResolvedValue(JSON.stringify({ ok: true }));

    await dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx());

    expect(mockExecuteBffTool).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteBffTool.mock.calls[0][0];
    expect(callArgs.args.description).not.toMatch(/[`$<>{}\\]/);
    expect(callArgs.args.description).toContain('Transfer from');
    expect(callArgs.args.description).toContain('process.env.SECRETb');
    expect(callArgs.args.description).toContain('savingsrm -rf');
  });

  test('(b control) a benign account label passes through unchanged in the description', async () => {
    mockExecuteBffTool.mockResolvedValue(JSON.stringify({ ok: true }));

    await dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx());

    const callArgs = mockExecuteBffTool.mock.calls[0][0];
    expect(callArgs.args.description).toBe('Transfer from checking to savings');
  });
});
