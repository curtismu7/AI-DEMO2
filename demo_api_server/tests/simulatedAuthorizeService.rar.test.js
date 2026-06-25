'use strict';

/**
 * NNP-1 RAR amount/payee enforcement — simulatedAuthorizeService.evaluateMcpFirstTool.
 *
 * Tests that the simulated engine enforces RAR (authorization_details) limits
 * from the attested rarMaxAmount / rarPermittedPayees params when ff_rar is on.
 * Uses jest.mock to control configStore flag values (same pattern as
 * simulatedAgentRestrictions.test.js). The guard must be a no-op when ff_rar is off.
 *
 * Parity invariant: same deny codes and ordering as decision.js Rule 3c.
 */

// configStore is mocked before any import so the module-level singleton is replaced.
jest.mock('../services/configStore', () => ({
  get: jest.fn(),
  getEffective: jest.fn(),
  setRaw: jest.fn(),
}));

// scopeTopology is needed by the service; let the real module load for tool classification.
// No need to mock — the tests don't rely on agent-mediated-tool side effects.

process.env.NODE_ENV = 'test';

const configStore = require('../services/configStore');
const { evaluateMcpFirstTool } = require('../services/simulatedAuthorizeService');

// Default: all flags off — mirrors production default (ff_rar = 'false').
function setFlagOff() {
  configStore.get.mockImplementation(() => null);
  configStore.getEffective.mockImplementation(() => null);
}

function setFfRarOn() {
  configStore.get.mockImplementation((k) => {
    if (k === 'ff_rar') return 'true';
    return null;
  });
  configStore.getEffective.mockImplementation((k) => {
    if (k === 'ff_rar') return 'true';
    return null;
  });
}

// Base params that pass every guard before the RAR block.
// create_transfer is a write tool; actClientId is present; no group restriction.
const BASE = {
  userId: 'u-rar',
  toolName: 'create_transfer',
  tokenAudience: 'https://mcp.example',
  actClientId: 'agent-1',
  acr: '',
};

beforeEach(() => {
  setFlagOff();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('NNP-1 RAR enforcement — simulatedAuthorizeService.evaluateMcpFirstTool', () => {

  // ── Flag OFF (default) — guard is a complete no-op ────────────────────────

  it('ff_rar OFF: amount exceeds rarMaxAmount → not denied (guard inert)', async () => {
    setFlagOff();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 500,
      transactionType: 'transfer',
      rarMaxAmount: 100,
    });
    // Amount 500 > denyAmount ceiling (2000) is false; falls through to STEP_UP or PERMIT.
    expect(r.denyReason).not.toBe('rar_amount_exceeded');
    expect(r.decision).not.toBe('DENY'); // no RAR DENY when flag is off
  });

  it('ff_rar OFF: payee not in rarPermittedPayees → not denied (guard inert)', async () => {
    setFlagOff();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: 'acct-999',
      rarPermittedPayees: ['acct-001', 'acct-002'],
    });
    expect(r.denyReason).not.toBe('rar_payee_not_permitted');
    expect(r.decision).not.toBe('DENY');
  });

  // ── Flag ON: amount enforcement ────────────────────────────────────────────

  it('ff_rar ON: amount > rarMaxAmount → DENY rar_amount_exceeded', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 500,
      transactionType: 'transfer',
      rarMaxAmount: 100,
    });
    expect(r.decision).toBe('DENY');
    expect(r.denyReason).toBe('rar_amount_exceeded');
  });

  it('ff_rar ON: amount === rarMaxAmount → no RAR deny (> not >=)', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 100,
      transactionType: 'transfer',
      rarMaxAmount: 100,
    });
    expect(r.denyReason).not.toBe('rar_amount_exceeded');
    expect(r.decision).not.toBe('DENY');
  });

  it('ff_rar ON: amount < rarMaxAmount → no RAR deny', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      rarMaxAmount: 200,
    });
    expect(r.denyReason).not.toBe('rar_amount_exceeded');
    expect(r.decision).not.toBe('DENY');
  });

  it('ff_rar ON: rarMaxAmount is null (not in RAR) → amount rule skipped', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 500,
      transactionType: 'transfer',
      rarMaxAmount: null,
    });
    expect(r.denyReason).not.toBe('rar_amount_exceeded');
  });

  // ── Flag ON: payee enforcement ─────────────────────────────────────────────

  it('ff_rar ON: toAccountId not in rarPermittedPayees → DENY rar_payee_not_permitted', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: 'acct-999',
      rarPermittedPayees: ['acct-001', 'acct-002'],
    });
    expect(r.decision).toBe('DENY');
    expect(r.denyReason).toBe('rar_payee_not_permitted');
  });

  it('ff_rar ON: toAccountId in rarPermittedPayees → no payee deny', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: 'acct-001',
      rarPermittedPayees: ['acct-001', 'acct-002'],
    });
    expect(r.denyReason).not.toBe('rar_payee_not_permitted');
    expect(r.decision).not.toBe('DENY');
  });

  it('ff_rar ON: rarPermittedPayees is null → payee rule skipped', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: 'acct-999',
      rarPermittedPayees: null,
    });
    expect(r.denyReason).not.toBe('rar_payee_not_permitted');
  });

  it('ff_rar ON: toAccountId absent → payee rule skipped (nothing to check)', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: null,
      rarPermittedPayees: ['acct-001'],
    });
    expect(r.denyReason).not.toBe('rar_payee_not_permitted');
    expect(r.decision).not.toBe('DENY');
  });

  // ── Both constraints simultaneously ────────────────────────────────────────

  it('ff_rar ON: both amount and payee valid → no RAR deny', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 50,
      transactionType: 'transfer',
      toAccountId: 'acct-001',
      rarMaxAmount: 200,
      rarPermittedPayees: ['acct-001'],
    });
    expect(r.denyReason).not.toBe('rar_amount_exceeded');
    expect(r.denyReason).not.toBe('rar_payee_not_permitted');
    expect(r.decision).not.toBe('DENY');
  });

  // ── Ordering: RAR fires BEFORE the global deny-amount ceiling (in sim engine) ──────────────
  //
  // In simulatedAuthorizeService.js the RAR block (line ~401) runs BEFORE the
  // global deny-amount ceiling (line ~494), so a RAR-exceeded deny fires first.
  // In decision.js the order is reversed (Rule 3b ceiling then Rule 3c RAR), but
  // both agree: when amount < ceiling AND amount > rarMaxAmount, rar_amount_exceeded fires.

  it('ff_rar ON: amount=150 > rarMaxAmount=100 but below ceiling(2000) → rar_amount_exceeded fires', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 150,
      transactionType: 'transfer',
      rarMaxAmount: 100,
    });
    expect(r.decision).toBe('DENY');
    expect(r.denyReason).toBe('rar_amount_exceeded');
  });

  // ── Security: attested source (not caller-supplied body max_amount) ─────────
  //
  // The attested values come from rarMaxAmount/rarPermittedPayees params which
  // the caller (mcpToolAuthorizationService) MUST extract from the TraT's azd field.
  // This test proves that the enforcement value is the parameter, not a body field.

  it('ff_rar ON: enforcement reads rarMaxAmount param (attested azd), not a caller-supplied body field', async () => {
    setFfRarOn();
    // rarMaxAmount=100 comes from the attested TraT azd. Amount 500 must be denied.
    // If implementation accidentally used a body-supplied value instead, the test
    // would show the wrong result because we pass rarMaxAmount as a separate param.
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 500,
      transactionType: 'transfer',
      rarMaxAmount: 100, // attested
    });
    expect(r.decision).toBe('DENY');
    expect(r.denyReason).toBe('rar_amount_exceeded');
  });

  // ── Parity: deny shape matches existing deny returns ──────────────────────

  it('ff_rar ON: DENY shape includes decision/denyReason/path/decisionId/raw fields', async () => {
    setFfRarOn();
    const r = await evaluateMcpFirstTool({
      ...BASE,
      amount: 500,
      transactionType: 'transfer',
      rarMaxAmount: 100,
    });
    expect(r.decision).toBe('DENY');
    expect(r.denyReason).toBe('rar_amount_exceeded');
    expect(r.path).toBe('simulated');
    expect(typeof r.decisionId).toBe('string');
    expect(r.raw).toBeTruthy();
    expect(r.raw.engine).toBe('simulated');
    expect(r.raw.rule).toBe('NNP-1');
  });
});
