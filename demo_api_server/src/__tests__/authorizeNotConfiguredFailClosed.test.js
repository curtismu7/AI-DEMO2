/**
 * @file authorizeNotConfiguredFailClosed.test.js
 * Regression guards around an environment where PingOne Authorize is NOT
 * configured (no decision endpoint):
 *
 *  1. DEFAULT posture (authorize_mode unset → FIELD_DEFS 'pingone', fail-closed;
 *     P1AZ hardening amendment §B): the not-configured path must FAIL CLOSED
 *     (503), never silently run the in-process mock — an operator must not
 *     believe real PingOne Authorize is enforcing when it never ran.
 *
 *  2. EXPLICIT fallback opt-in (authorize_mode='pingone_fallback_simulated'):
 *     the gate RUNS via the simulated engine (never ran:false / ungated) — this
 *     is now a deliberate operator choice, not the default.
 *
 * Uses a fresh isolated LMDB so configStore returns FIELD_DEFS defaults;
 * PINGONE_READY reads raw configStore.get (store-only), so process env cannot
 * accidentally mark it configured.
 */
const os = require('node:os');
const path = require('node:path');

// Isolated LMDB so configStore returns FIELD_DEFS defaults. Restore the original
// after this file so the override can't leak to sibling suites in the same worker.
const _origLmdbPath = process.env.LMDB_PATH;
process.env.LMDB_PATH = path.join(os.tmpdir(), `authz-nc-test-${process.pid}-${Date.now()}`);
afterAll(() => {
  if (_origLmdbPath === undefined) delete process.env.LMDB_PATH;
  else process.env.LMDB_PATH = _origLmdbPath;
});

const configStore = require('../../services/configStore');
const txSvc = require('../../services/transactionAuthorizationService');
const mcpSvc = require('../../services/mcpToolAuthorizationService');

const runtimeSettings = { get: (k) => ({ stepUpAcrValue: 'mfa', stepUpMethod: 'ciba' }[k]) };
const req = { session: { user: { role: 'customer' } } };

describe('explicit authorize_mode=pingone_fallback_simulated + not configured → simulated engine (opt-in)', () => {
  beforeAll(async () => {
    await configStore.setConfig({ authorize_mode: 'pingone_fallback_simulated' });
  });
  afterAll(async () => {
    await configStore.setConfig({ authorize_mode: 'pingone' });
  });

  it('transaction path evaluates via the simulated engine (not ran:false skip, not 503)', async () => {
    const r = await txSvc.evaluateTransactionPolicy({
      runtimeSettings, userRole: 'customer', userId: 'u1', amount: 50, type: 'withdrawal', acr: '',
    });
    expect(r.ran).toBe(true);
    // $50 withdrawal is under every simulated threshold → permitted by the
    // in-process engine. The point: the gate RAN and produced a decision.
    expect(r.permit).toBe(true);
    expect(r.evaluation.engine).toBe('simulated');
  });

  it('MCP first-tool path runs the simulated engine (not ran:false skip, not unavailable)', async () => {
    const r = await mcpSvc.evaluateMcpFirstToolGate({
      req, tool: 'get_account_balance', agentToken: 'x.y.z', userSub: 'u1', toolParams: {},
    });
    expect(r.ran).toBe(true);
    // The simulated engine may PERMIT or policy-block depending on its rules,
    // but it must never report the engine as unavailable (that would mean the
    // gate failed closed instead of falling back).
    expect(r.block?.body?.error ?? 'permit').not.toBe('mcp_authorize_unavailable');
  });
});

describe('DEFAULT (authorize_mode unset → pingone) + not configured → FAIL CLOSED, never silent mock', () => {
  it('transaction path returns 503 deny by default, not a silent simulated permit', async () => {
    const r = await txSvc.evaluateTransactionPolicy({
      runtimeSettings, userRole: 'customer', userId: 'u1', amount: 50, type: 'transfer', acr: '',
    });
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.failover_mode).toBe('deny');
  });

  it('MCP first-tool path returns 503 unavailable by default, not a silent simulated run', async () => {
    const r = await mcpSvc.evaluateMcpFirstToolGate({
      req, tool: 'get_account_balance', agentToken: 'x.y.z', userSub: 'u1', toolParams: {},
    });
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('mcp_authorize_unavailable');
  });
});

describe("strict PingOne (explicit authorize_mode='pingone') + not configured → fail CLOSED", () => {
  beforeAll(async () => {
    await configStore.setConfig({ authorize_mode: 'pingone' });
  });
  afterAll(async () => {
    await configStore.setConfig({ authorize_mode: 'pingone_fallback_simulated' });
  });

  it('transaction path returns 503 deny (not ran:false skip)', async () => {
    const r = await txSvc.evaluateTransactionPolicy({
      runtimeSettings, userRole: 'customer', userId: 'u1', amount: 50, type: 'transfer', acr: '',
    });
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.failover_mode).toBe('deny');
    expect(r.block.body.authorizeFallback.effectiveAction).toBe('denied');
  });

  it('MCP first-tool path returns 503 (not ran:false skip)', async () => {
    const r = await mcpSvc.evaluateMcpFirstToolGate({
      req, tool: 'get_account_balance', agentToken: 'x.y.z', userSub: 'u1', toolParams: {},
    });
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('mcp_authorize_unavailable');
  });
});
