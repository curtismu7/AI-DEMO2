'use strict';

/**
 * agentPathAudit.regression.test.js — Bug #2 Part C REDO (agent-path attribution)
 *
 * Prior Part C (commit ad3790e1) only set `req.agentPath = 'heuristic' |
 * 'reason_loop_3006'` inside processAgentMessage. That assignment is DEAD with
 * respect to the inbound delegation audit: the GLOBAL delegationAuditMiddleware
 * (server.js) builds + logs the /api/demo-agent/message audit event BEFORE
 * the route handler runs processAgentMessage, so req.agentPath is always null
 * in that audit.
 *
 * The redo emits an EXPLICIT `delegation_action` audit from INSIDE
 * processAgentMessage, AFTER the path is known, via the already-exported
 * logDelegationEvent(req, eventType, details). These tests prove that real
 * behavior — which the prior test (buildAuditEvent field-contract only) missed.
 *
 * Test pattern (CLAUDE.md regression): configStore mocked with TEST_CONFIG;
 * data store, appEventService, nlIntentParser, agentReasoningClient and the
 * delegationAuditLogger middleware are mocked. Deterministic, no network.
 */

const TEST_CONFIG = { ff_heuristic_enabled: 'true', helix_api_key: 'test-key' };

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => TEST_CONFIG[key] ?? null),
}));

jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));

// The seam under test: logDelegationEvent must be CALLED from inside
// processAgentMessage once the path is known. The service file imports only
// logDelegationEvent from this module — a bare factory is correct here.
const mockLogDelegationEvent = jest.fn();
jest.mock('../middleware/delegationAuditLogger', () => ({
  logDelegationEvent: (...args) => mockLogDelegationEvent(...args),
}));

const mockParseHeuristic = jest.fn();
jest.mock('../services/nlIntentParser', () => ({
  parseHeuristic: (...a) => mockParseHeuristic(...a),
  // Multi-vertical routing: the service resolves the active vertical's context
  // on every path. Banking default → { verticalId: 'banking', verticalCtx: null }.
  resolveVerticalRouting: () => ({ verticalId: 'banking', verticalCtx: null }),
  buildCatalogMessage: () => 'I can help with your banking tasks.',
}));

const mockGetAccounts = jest.fn();
jest.mock('../data/store', () => ({
  getAccountsByUserId: (...a) => mockGetAccounts(...a),
}));

const mockRunReasonLoop = jest.fn();
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: (...a) => mockRunReasonLoop(...a),
}));

// executeBffTool (called by the heuristic read path) needs token resolution + tool definitions.
// Stub them so tests stay deterministic without network / DB.
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn().mockResolvedValue({ token: 'mock-agent-tok', tokenEvents: [] }),
}));
jest.mock('../services/agentBuilder', () => ({
  getBankingToolDefinitions: jest.fn(() => [
    {
      name: 'get_my_accounts',
      description: 'List accounts',
      schema: null,
      invoke: jest.fn().mockResolvedValue(JSON.stringify({
        accounts: [{ id: 'acc-chk', accountType: 'checking', accountNumber: '1111', balance: 5000, currency: 'USD' }],
      })),
    },
  ]),
  MAX_TOOL_ITERATIONS: 5,
}));

const { processAgentMessage } = require('../services/demoAgentLangGraphService');

describe('Bug #2 Part C redo — explicit agent-path delegation_action audit', () => {
  beforeEach(() => {
    mockLogDelegationEvent.mockReset();
    mockParseHeuristic.mockReset();
    mockGetAccounts.mockReset();
    mockRunReasonLoop.mockReset();
  });

  test('heuristic path emits delegation_action with agentPath "heuristic"', async () => {
    // parseHeuristic matches an "accounts" intent → executeHeuristicBanking
    // returns a result → processAgentMessage returns on the heuristic seam.
    mockParseHeuristic.mockReturnValue({
      kind: 'banking',
      banking: { action: 'accounts', params: {} },
    });
    mockGetAccounts.mockResolvedValue([
      { id: 'acc-chk', accountType: 'checking', accountNumber: '1111', balance: 5000 },
    ]);

    const req = { session: {} };
    const result = await processAgentMessage({
      message: 'show my accounts',
      userId: 'user-1',
      userToken: 'tok-1',
      sessionId: 'sess-1',
      req,
    });

    expect(result.success).toBe(true);
    expect(mockRunReasonLoop).not.toHaveBeenCalled();
    expect(mockLogDelegationEvent).toHaveBeenCalledWith(
      req,
      'delegation_action',
      expect.objectContaining({ agentPath: 'heuristic' }),
    );
  });

  test('reason-loop path emits delegation_action with agentPath "reason_loop_3006"', async () => {
    // parseHeuristic returns null → no heuristic match → falls through to the
    // :3006 reason loop. runReasonLoop mocked to a clean answer.
    mockParseHeuristic.mockReturnValue(null);
    mockRunReasonLoop.mockResolvedValue({ ok: true, answer: 'Hello from the agent.' });

    const req = { session: {} };
    const result = await processAgentMessage({
      message: 'tell me a joke',
      userId: 'user-1',
      userToken: 'tok-1',
      sessionId: 'sess-1',
      req,
    });

    expect(result.success).toBe(true);
    expect(mockRunReasonLoop).toHaveBeenCalledTimes(1);
    expect(mockLogDelegationEvent).toHaveBeenCalledWith(
      req,
      'delegation_action',
      expect.objectContaining({ agentPath: 'reason_loop_3006' }),
    );
  });

  test('null req is safe — no logDelegationEvent call and no throw (heuristic path)', async () => {
    mockParseHeuristic.mockReturnValue({
      kind: 'banking',
      banking: { action: 'accounts', params: {} },
    });
    mockGetAccounts.mockResolvedValue([
      { id: 'acc-chk', accountType: 'checking', accountNumber: '1111', balance: 5000 },
    ]);

    // No req passed → processAgentMessage defaults req = null.
    await expect(
      processAgentMessage({
        message: 'show my accounts',
        userId: 'user-1',
        userToken: 'tok-1',
        sessionId: 'sess-1',
      }),
    ).resolves.toBeDefined();

    expect(mockLogDelegationEvent).not.toHaveBeenCalled();
  });

  test('null req is safe — no logDelegationEvent call and no throw (reason-loop path)', async () => {
    mockParseHeuristic.mockReturnValue(null);
    mockRunReasonLoop.mockResolvedValue({ ok: true, answer: 'Hello.' });

    await expect(
      processAgentMessage({
        message: 'tell me a joke',
        userId: 'user-1',
        userToken: 'tok-1',
        sessionId: 'sess-1',
      }),
    ).resolves.toBeDefined();

    expect(mockLogDelegationEvent).not.toHaveBeenCalled();
  });
});
