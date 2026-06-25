'use strict';

/**
 * Issue #402 — banking write path must recognise the unified pipeline's
 * mcp_-prefixed authorize-gate HITL/step-up codes, not just the bare forms.
 *
 * Before the shared classifier, dispatchBankingAction inline-checked only
 * `result.error === 'hitl_required'`, so an `mcp_hitl_required` block from the
 * BFF gate fell through to a generic "Transfer failed: mcp_hitl_required"
 * instead of opening the consent modal. These assert parity with the vertical
 * path: both now route detection through classifyMcpToolResult.
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

const { dispatchBankingAction } = require('../../services/demoAgentLangGraphService');

const ctx = () => ({ userToken: 'tok-1', req: null, isAdmin: false });

describe('banking write HITL/step-up code normalisation (issue #402)', () => {
  beforeEach(() => {
    mockExecuteBffTool.mockReset();
    mockGetAccounts.mockReset();
    mockGetAccounts.mockResolvedValue([
      { id: 'acc-chk', accountType: 'checking', balance: 5000 },
      { id: 'acc-sav', accountType: 'savings', balance: 1000 },
    ]);
  });

  test('transfer: mcp_hitl_required gate block → consent envelope (not a generic failure)', async () => {
    mockExecuteBffTool.mockResolvedValue(
      JSON.stringify({ error: 'mcp_hitl_required', error_description: 'Human approval required.', challengeId: 'chal-1' }),
    );

    const out = await dispatchBankingAction(
      'transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx(),
    );

    expect(out.success).toBe(false);
    expect(out.error).toBe('hitl_required'); // normalised from mcp_hitl_required
    expect(out.hitl).toEqual({ type: 'consent' });
    expect(out.reply).toBe('Human approval required.'); // error_description surfaced
    expect(out.transactionType).toBe('transfer');
    expect(out.reply).not.toMatch(/Transfer failed/);
  });

  test('deposit: mcp_step_up_required gate block → step-up reply (not a generic failure)', async () => {
    mockExecuteBffTool.mockResolvedValue(
      JSON.stringify({ error: 'mcp_step_up_required', error_description: 'Step-up required.' }),
    );

    const out = await dispatchBankingAction(
      'deposit', { toId: 'checking', amount: 50 }, 'user-1', ctx(),
    );

    expect(out.success).toBe(false);
    expect(out.reply).toBe('Step-up required.');
    expect(out.reply).not.toMatch(/Deposit failed/);
  });

  test('withdraw: bare hitl_required still works (no regression)', async () => {
    mockExecuteBffTool.mockResolvedValue(
      JSON.stringify({ error: 'hitl_required', hitl: { type: 'consent' }, hitl_threshold_usd: 250 }),
    );

    const out = await dispatchBankingAction(
      'withdraw', { fromId: 'checking', amount: 300 }, 'user-1', ctx(),
    );

    expect(out.success).toBe(false);
    expect(out.error).toBe('hitl_required');
    expect(out.hitl_threshold_usd).toBe(250);
    expect(out.transactionType).toBe('withdrawal');
  });

  test('transfer: a genuine tool error still renders as "Transfer failed: <reason>"', async () => {
    mockExecuteBffTool.mockResolvedValue(
      JSON.stringify({ error: 'insufficient_funds', message: 'Not enough money.' }),
    );

    const out = await dispatchBankingAction(
      'transfer', { fromId: 'checking', toId: 'savings', amount: 100 }, 'user-1', ctx(),
    );

    expect(out.success).toBe(false);
    expect(out.reply).toBe('Transfer failed: Not enough money.');
  });
});
