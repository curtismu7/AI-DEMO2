'use strict';

jest.mock('../../services/lmdb/mcpAuditStore.lmdb', () => ({ query: jest.fn() }));
jest.mock('../../services/mcpTrafficLogger', () => ({ getMcpTrafficLog: jest.fn() }));

const auditStore = require('../../services/lmdb/mcpAuditStore.lmdb');
const trafficLogger = require('../../services/mcpTrafficLogger');
const { reconcile } = require('../../services/transactionReconciler');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ...h })) };
}

describe('transactionReconciler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditStore.query.mockReturnValue([]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([]);
  });

  test('MATCH when the gateway witness agrees with the ledger', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success', userId: 'u1', agentId: 'a1' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
  });

  test('MISMATCH when the ledger has a gateway hop the witness never saw', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'other', operation: 'get_balance', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'create_transfer', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpAuditStore', side: 'ledger_only', op: 'create_transfer',
    }));
  });

  test('MISMATCH when the witness saw a call the ledger has no hop for', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'create_transfer', outcome: 'success' },
      { correlationId: 'other', operation: 'x', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'demo-api-server', phase: 'ui.request' },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpAuditStore', side: 'witness_only', op: 'create_transfer',
    }));
  });

  test('SOURCE_UNAVAILABLE when every witness store is empty — a fresh restart is not tampering', () => {
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.diffs).toEqual([]);
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
  });

  test('SOURCE_UNAVAILABLE when a witness throws', () => {
    auditStore.query.mockImplementation(() => { throw new Error('lmdb down'); });
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.diffs).toEqual([]);
  });

  test('corroborates authz decisions against the traffic log', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'c1', type: 'authorize_response', tool: 'create_withdrawal', ok: false },
    ]);
    const out = reconcile(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: { outcome: 'deny' } },
    ]));
    expect(out.sources.mcpTrafficLog.status).toBe('MATCH');
    expect(out.status).toBe('MATCH');
  });

  test('MISMATCH when an authz hop has no traffic-log counterpart', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'other', type: 'authorize_response', tool: 'x', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: { outcome: 'deny' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpTrafficLog', side: 'ledger_only', op: 'create_withdrawal',
    }));
  });

  test('a witness with nothing to corroborate is MATCH, not MISMATCH', () => {
    auditStore.query.mockReturnValue([{ correlationId: 'other', operation: 'x', outcome: 'success' }]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([{ correlationId: 'other', type: 'authorize_response', tool: 'x' }]);
    const out = reconcile(rec([{ service: 'demo-api-server', phase: 'ui.request' }]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
  });

  test('duplicate ops are compared by count, so a replayed call surfaces', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success' },
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({ side: 'witness_only', op: 'get_balance' }));
  });
});
