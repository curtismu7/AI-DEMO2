'use strict';

/**
 * WR-07 — heuristicBankingWr07.integration.test.js
 *
 * Integration counterpart: real configStore. Tests call dispatchBankingAction
 * directly to avoid vertical-routing fragility in the full processAgentMessage stack.
 */

// configStore NOT mocked.

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

const ctx = () => ({ userToken: 'integration-tok-1', req: null, isAdmin: false });

describe('WR-07 — propagation + sanitization via real configStore (integration)', () => {
  beforeEach(() => {
    mockExecuteBffTool.mockReset();
    mockGetAccounts.mockReset();
    mockGetAccounts.mockResolvedValue([
      { id: 'acc-chk', accountType: 'checking', balance: 5000 },
      { id: 'acc-sav', accountType: 'savings', balance: 1000 },
    ]);
  });

  test('non-Error throw from data store propagates out of dispatchBankingAction', async () => {
    mockGetAccounts.mockImplementation(() => { throw { mcpCode: -32000 }; });

    await expect(
      dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 50 }, 'integration-user-1', ctx())
    ).rejects.toBeDefined();

    expect(mockExecuteBffTool).not.toHaveBeenCalled();
  });

  test('injection-ish account label is sanitized in the persisted description', async () => {
    mockGetAccounts.mockResolvedValue([
      { id: 'checking', accountType: 'chk<script>', balance: 5000 },
      { id: 'savings', accountType: 'savings', balance: 1000 },
    ]);
    mockExecuteBffTool.mockResolvedValue(JSON.stringify({ ok: true }));

    await dispatchBankingAction('transfer', { fromId: 'checking', toId: 'savings', amount: 50 }, 'integration-user-1', ctx());

    const callArgs = mockExecuteBffTool.mock.calls[0][0];
    expect(callArgs.args.description).not.toMatch(/[`$<>{}\\]/);
    expect(callArgs.args.description).toContain('Transfer from chkscript to savings');
  });
});
