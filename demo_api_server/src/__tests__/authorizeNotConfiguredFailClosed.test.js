/**
 * @file authorizeNotConfiguredFailClosed.test.js
 * Regression: with the PingOne-ONLY default (ff_authorize_simulated='false',
 * authorize_failover_mode='deny'), an environment where PingOne is NOT configured
 * (no decision endpoint) must FAIL CLOSED (503), not silently skip the gate and
 * run ungated. Uses a fresh isolated LMDB so configStore returns FIELD_DEFS
 * defaults; PINGONE_READY reads raw configStore.get (store-only), so process env
 * cannot accidentally mark it configured.
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

const txSvc = require('../../services/transactionAuthorizationService');
const mcpSvc = require('../../services/mcpToolAuthorizationService');

const runtimeSettings = { get: (k) => ({ stepUpAcrValue: 'mfa', stepUpMethod: 'ciba' }[k]) };

describe('strict PingOne + not configured → fail CLOSED', () => {
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
    const req = { session: { user: { role: 'customer' } } };
    const r = await mcpSvc.evaluateMcpFirstToolGate({
      req, tool: 'get_account_balance', agentToken: 'x.y.z', userSub: 'u1', toolParams: {},
    });
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('mcp_authorize_unavailable');
  });
});
