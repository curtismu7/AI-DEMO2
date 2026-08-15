'use strict';

/**
 * CRITICAL-2 — RAR end-to-end integration test (NNP-1, UC14).
 *
 * Drives real claims with production field names (`amount`, `payee`) from
 * buildRarAuthorizationDetails through mcpToolAuthorizationService.evaluateMcpFirstToolGate
 * using the REAL simulatedAuthorizeService (not mocked) so any field-name mismatch
 * between the attested azd and the enforcement readers is caught here.
 *
 * This test is the one that would have caught CRITICAL-1 before the fix.
 *
 * Scenarios proven:
 *   1. amount > attested `amount` → DENY rar_amount_exceeded
 *   2. ToAccountId != attested `payee` → DENY rar_payee_not_permitted
 *   3. amount <= attested `amount` AND ToAccountId == attested `payee` → PERMIT (no RAR deny)
 *   4. Request-body `amount` does NOT relax the attested ceiling
 *      (enforcement reads from token azd, not toolParams.amount used as the ceiling)
 */

// configStore mock — must be declared before any require().
jest.mock('../services/configStore', () => ({
  get: jest.fn(),
  getEffective: jest.fn(),
  setRaw: jest.fn(),
}));

// Stub network/external dependencies that mcpToolAuthorizationService imports.
jest.mock('../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn().mockReturnValue(false),
}));

jest.mock('../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  verifyHitlReceipt: jest.fn(),
}));

// dataStore needed by groupPolicy; stub so no LMDB is opened during tests.
jest.mock('../data/store', () => ({
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
}));

process.env.NODE_ENV = 'test';

const configStore = require('../services/configStore');
// evaluateMcpFirstToolGate is the production code under test.
const { evaluateMcpFirstToolGate } = require('../services/mcpToolAuthorizationService');
// Import the REAL simulatedAuthorizeService to verify its resolveAuthorizeMode is called correctly.
// mcpToolAuthorizationService.js will require this same module (not mocked).
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal unsigned JWT with the given payload (header.payload.sig). */
function jwtWithPayload(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' }), 'utf8').toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${header}.${body}.sig`;
}

/**
 * Build an agent token JWT whose azd.authorization_details uses the PRODUCTION
 * field names emitted by buildRarAuthorizationDetails:
 *   `amount`  — attested ceiling (NOT max_amount)
 *   `payee`   — permitted destination as single string or array (NOT permitted_payees)
 *
 * This mirrors what agentMcpTokenService.buildTratContext() places in the TraT
 * and what the MCP server later reads from claims.azd.authorization_details.
 */
function buildAgentToken({ amount, payee, aud = 'https://mcp.example' } = {}) {
  const azd = {};
  if (amount !== undefined) {
    azd.authorization_details = [
      {
        type: 'banking_transaction',
        tool: 'create_transfer',
        actions: ['create_transfer'],
        amount,               // production field name from buildRarAuthorizationDetails
        ...(payee !== undefined ? { payee } : {}),  // production field name
      },
    ];
  }
  return jwtWithPayload({
    sub: 'user-sub',
    aud,
    act: { client_id: 'bff-client' },
    azd,
  });
}

/** configStore returns simulated-mode ON + ff_rar ON. */
function configWithRarOn(k) {
  if (k === 'ff_authorize_mcp_first_tool') return 'true';
  if (k === 'ff_rar') return 'true';
  if (k === 'ff_authorize_real') return 'true';
  if (k === 'mcp_resource_uri') return 'https://mcp.example';
  if (k === 'authorize_mode') return 'simulated';
  return null;
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  configStore.get.mockImplementation(configWithRarOn);
  configStore.getEffective.mockImplementation(configWithRarOn);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RAR end-to-end: mcpToolAuthorizationService → simulatedAuthorizeService (production field names)', () => {

  // Scenario 1: tool amount EXCEEDS attested `amount` → DENY rar_amount_exceeded
  it('CRITICAL-1 regression: tool amount > attested azd.amount → DENY rar_amount_exceeded', async () => {
    // The token carries azd.authorization_details[0].amount = 100 (production field name).
    // The tool call requests amount = 500 → must be denied.
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 100 }),
      userSub: 'user-sub',
      toolParams: { amount: 500, to_account_id: 'acct-001' },
    });
    expect(r.ran).toBe(true);
    expect(r.permit).toBeFalsy();
    expect(r.block).toBeTruthy();
    // The deny reason must be rar_amount_exceeded (not a generic deny)
    const body = r.block?.body ?? r.rawDecision ?? r;
    const reasonStr = JSON.stringify(body);
    expect(reasonStr).toContain('rar_amount_exceeded');
  });

  // Scenario 2: ToAccountId != attested `payee` → DENY rar_payee_not_permitted
  it('CRITICAL-1 regression: ToAccountId != attested azd.payee → DENY rar_payee_not_permitted', async () => {
    // Token carries payee = 'acct-001'; tool call targets 'acct-999'.
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 500, payee: 'acct-001' }),
      userSub: 'user-sub',
      // amount is within ceiling (50 < 500) but payee is wrong
      toolParams: { amount: 50, to_account_id: 'acct-999' },
    });
    expect(r.ran).toBe(true);
    expect(r.permit).toBeFalsy();
    expect(r.block).toBeTruthy();
    const reasonStr = JSON.stringify(r.block?.body ?? r);
    expect(reasonStr).toContain('rar_payee_not_permitted');
  });

  // Scenario 3: within ceiling AND permitted payee → no RAR deny (PERMIT)
  it('amount <= attested amount AND ToAccountId == attested payee → PERMIT (no RAR deny)', async () => {
    // Token: amount=200, payee='acct-001'. Tool: amount=50, to_account_id='acct-001'.
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 200, payee: 'acct-001' }),
      userSub: 'user-sub',
      toolParams: { amount: 50, to_account_id: 'acct-001' },
    });
    expect(r.ran).toBe(true);
    // Should not be a RAR deny
    const reasonStr = JSON.stringify(r);
    expect(reasonStr).not.toContain('rar_amount_exceeded');
    expect(reasonStr).not.toContain('rar_payee_not_permitted');
    // Decision must be permit (amount 50 < all thresholds: confirm=250, step-up=500)
    expect(r.permit).toBe(true);
  });

  // Scenario 4: a large toolParams.amount does NOT relax an attested ceiling of 100
  // (proves enforcement reads from azd, not body — this is the security invariant)
  it('Security: toolParams.amount cannot relax attested azd.amount ceiling', async () => {
    // The token attests amount=100. The tool call sends amount=500.
    // If enforcement incorrectly used a body-supplied max, this would pass; it must DENY.
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 100 }),
      userSub: 'user-sub',
      toolParams: { amount: 500 },
    });
    expect(r.ran).toBe(true);
    expect(r.permit).toBeFalsy();
    const reasonStr = JSON.stringify(r.block?.body ?? r);
    expect(reasonStr).toContain('rar_amount_exceeded');
  });

  // Scenario 5: payee as array (buildRarAuthorizationDetails always emits a single string,
  // but the normalisation code in mcpToolAuthorizationService must handle array too).
  it('attested payee as array — ToAccountId in array → PERMIT', async () => {
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 200, payee: ['acct-001', 'acct-002'] }),
      userSub: 'user-sub',
      toolParams: { amount: 50, to_account_id: 'acct-002' },
    });
    expect(r.ran).toBe(true);
    const reasonStr = JSON.stringify(r);
    expect(reasonStr).not.toContain('rar_payee_not_permitted');
    expect(r.permit).toBe(true);
  });

  // Scenario 6: ff_rar OFF → enforcement is inert even with production field names present.
  // Use a small amount (10) well below all thresholds so the decision flows to PERMIT
  // without triggering step-up/HITL, proving only that the RAR block is truly inert.
  it('ff_rar OFF → RAR enforcement is inert (attested amount exceeded but no RAR deny)', async () => {
    configStore.get.mockImplementation((k) => {
      if (k === 'ff_authorize_mcp_first_tool') return 'true';
      if (k === 'ff_rar') return 'false';
      if (k === 'ff_authorize_real') return 'true';
      if (k === 'mcp_resource_uri') return 'https://mcp.example';
      if (k === 'authorize_mode') return 'simulated';
      return null;
    });
    configStore.getEffective.mockImplementation(configStore.get);
    // amount=10 is below all thresholds (confirm=250, step-up=500, deny=2000)
    // so if ff_rar is OFF the RAR ceiling (attested=5) is not enforced → PERMIT.
    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: 'create_transfer',
      agentToken: buildAgentToken({ amount: 5 }),
      userSub: 'user-sub',
      toolParams: { amount: 10, to_account_id: 'acct-001' },
    });
    expect(r.ran).toBe(true);
    const reasonStr = JSON.stringify(r);
    expect(reasonStr).not.toContain('rar_amount_exceeded');
    // amount=10 < confirm(250) → straight PERMIT
    expect(r.permit).toBe(true);
  });
});
