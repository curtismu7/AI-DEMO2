/**
 * @file authorizePolicyNotFound.gates.test.js
 * Gate-level policy-not-found handling (spec:
 * docs/superpowers/specs/2026-07-11-p1az-policy-not-found-design.md):
 *  - NOT_APPLICABLE (successful P1AZ response, no policy matched) → block with
 *    error='policy_not_found' in EVERY failover mode (the engine worked; this
 *    is code/policy drift, not an outage).
 *  - 404 (endpoint missing) respects failover: deny → policy_not_found block;
 *    fallback_simulated → simulated engine keeps the demo alive, the
 *    authorizeFallback signal carries reason='policy_not_found'.
 */

'use strict';

jest.mock('../../services/pingOneAuthorizeService');

// configStore double: per-test key/value map, getEffective falls through to get.
const _cfg = {};
jest.mock('../../services/configStore', () => ({
  get: jest.fn((k) => (_cfg[k] !== undefined ? _cfg[k] : null)),
  getEffective: jest.fn((k) => (_cfg[k] !== undefined ? _cfg[k] : null)),
  set: jest.fn(),
}));

const pingOne = require('../../services/pingOneAuthorizeService');
const txSvc = require('../../services/transactionAuthorizationService');
const mcpSvc = require('../../services/mcpToolAuthorizationService');

const MESSAGE = 'Policy not found, please contact administrator.';
const runtimeSettings = { get: (k) => ({ stepUpAcrValue: 'mfa', stepUpMethod: 'ciba' }[k]) };

const setCfg = (map) => {
  Object.keys(_cfg).forEach((k) => delete _cfg[k]);
  Object.assign(_cfg, map);
};

const txArgs = { runtimeSettings, userRole: 'customer', userId: 'u1', amount: 50, type: 'withdrawal', acr: '' };

const notFoundErr = () =>
  Object.assign(new Error('PingOne Authorize decision endpoint evaluation failed (404): NOT_FOUND'), {
    code: 'policy_not_found',
    status: 404,
  });

beforeEach(() => {
  jest.clearAllMocks();
  pingOne.isMcpDelegationDecisionReady = jest.fn(() => true);
});

describe('transaction gate', () => {
  it('NOT_APPLICABLE → 503 policy_not_found (strict pingone mode)', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_decision_endpoint_id: 'ep-1' });
    pingOne.evaluateTransaction.mockResolvedValue({ decision: 'DENY', policyNotFound: true, raw: {}, path: 'decision-endpoint' });
    const r = await txSvc.evaluateTransactionPolicy(txArgs);
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('policy_not_found');
    expect(r.block.body.error_description).toBe(MESSAGE);
  });

  it('NOT_APPLICABLE → policy_not_found even in fallback_simulated mode (no fallback for a working engine)', async () => {
    setCfg({ authorize_mode: 'pingone_fallback_simulated', authorize_decision_endpoint_id: 'ep-1' });
    pingOne.evaluateTransaction.mockResolvedValue({ decision: 'DENY', policyNotFound: true, raw: {}, path: 'decision-endpoint' });
    const r = await txSvc.evaluateTransactionPolicy(txArgs);
    expect(r.block.body.error).toBe('policy_not_found');
  });

  it('404 + failover=deny → 503 policy_not_found with signal reason', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_decision_endpoint_id: 'ep-1' });
    pingOne.evaluateTransaction.mockRejectedValue(notFoundErr());
    const r = await txSvc.evaluateTransactionPolicy(txArgs);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('policy_not_found');
    expect(r.block.body.error_description).toBe(MESSAGE);
    expect(r.block.body.authorizeFallback.reason).toBe('policy_not_found');
  });

  it('404 + failover=fallback_simulated → simulated engine ran, signal reason=policy_not_found', async () => {
    setCfg({ authorize_mode: 'pingone_fallback_simulated', authorize_decision_endpoint_id: 'ep-1' });
    pingOne.evaluateTransaction.mockRejectedValue(notFoundErr());
    const r = await txSvc.evaluateTransactionPolicy(txArgs);
    expect(r.ran).toBe(true);
    // $50 withdrawal is under every simulated threshold → permit via fallback.
    expect(r.permit).toBe(true);
    expect(r.evaluation.engine).toBe('fallback_simulated');
    expect(r.evaluation.authorizeFallback.reason).toBe('policy_not_found');
  });

  it('plain DENY unchanged (regression)', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_decision_endpoint_id: 'ep-1' });
    pingOne.evaluateTransaction.mockResolvedValue({ decision: 'DENY', raw: {}, path: 'decision-endpoint' });
    const r = await txSvc.evaluateTransactionPolicy(txArgs);
    expect(r.block.status).toBe(403);
    expect(r.block.body.error).toBe('transaction_denied');
  });
});

describe('MCP first-tool gate', () => {
  const req = { session: { user: { role: 'customer' } } };
  const gateArgs = { req, tool: 'get_account_balance', agentToken: 'x.y.z', userSub: 'u1', toolParams: {} };

  it('NOT_APPLICABLE → 503 policy_not_found block', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_mcp_decision_endpoint_id: 'ep-mcp' });
    pingOne.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY', policyNotFound: true, raw: {}, decisionId: 'd1' });
    const r = await mcpSvc.evaluateMcpFirstToolGate(gateArgs);
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('policy_not_found');
    expect(r.block.body.error_description).toBe(MESSAGE);
  });

  it('404 + failover=deny → 503 policy_not_found block with signal reason', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_mcp_decision_endpoint_id: 'ep-mcp' });
    pingOne.evaluateMcpToolDelegation.mockRejectedValue(notFoundErr());
    const r = await mcpSvc.evaluateMcpFirstToolGate(gateArgs);
    expect(r.ran).toBe(true);
    expect(r.block.status).toBe(503);
    expect(r.block.body.error).toBe('policy_not_found');
    expect(r.block.body.authorizeFallback.reason).toBe('policy_not_found');
  });

  it('plain DENY unchanged (regression)', async () => {
    setCfg({ authorize_mode: 'pingone', authorize_mcp_decision_endpoint_id: 'ep-mcp' });
    pingOne.evaluateMcpToolDelegation.mockResolvedValue({ decision: 'DENY', raw: {}, decisionId: 'd1' });
    const r = await mcpSvc.evaluateMcpFirstToolGate(gateArgs);
    expect(r.block.status).toBe(403);
    expect(r.block.body.error).toBe('mcp_authorization_denied');
  });
});
