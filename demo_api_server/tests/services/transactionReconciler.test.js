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

  test('corroborates mcp.tool hops against the traffic log', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'c1', type: 'rpc_response', method: 'tools/call', tool: 'create_withdrawal', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(out.sources.mcpTrafficLog.status).toBe('MATCH');
    expect(out.status).toBe('MATCH');
  });

  test('MISMATCH when an mcp.tool hop has no traffic-log counterpart', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'other', type: 'rpc_response', method: 'tools/call', tool: 'x', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpTrafficLog', side: 'ledger_only', op: 'create_withdrawal',
    }));
  });

  test('a witness with nothing to corroborate is MATCH, not MISMATCH', () => {
    auditStore.query.mockReturnValue([{ correlationId: 'other', operation: 'x', outcome: 'success' }]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'other', type: 'rpc_response', method: 'tools/call', tool: 'x', ok: true },
    ]);
    const out = reconcile(rec([{ service: 'demo-api-server', phase: 'ui.request' }]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
  });

  test('clean happy path: matching gateway.authorize and mcp.tool hops corroborated by both witnesses is MATCH with no diffs', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'c1', operation: 'get_balance', outcome: 'success', userId: 'u1', agentId: 'a1' },
    ]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { correlationId: 'c1', type: 'rpc_response', method: 'tools/call', tool: 'get_balance', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(out.status).toBe('MATCH');
    expect(out.diffs).toEqual([]);
    expect(out.sources.mcpAuditStore.status).toBe('MATCH');
    expect(out.sources.mcpTrafficLog.status).toBe('MATCH');
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

  test('SOURCE_UNAVAILABLE (not MISMATCH) when the gateway witness has rows but none carry a correlationId at all', () => {
    auditStore.query.mockReturnValue([
      { operation: 'get_balance', outcome: 'success', userId: 'u1', agentId: 'a1' },
      { operation: 'create_transfer', outcome: 'success', userId: 'u2', agentId: 'a2' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.sources.mcpAuditStore.reason).toBe('no_correlation_ids');
    expect(out.sources.mcpAuditStore.diffs).toEqual([]);
    expect(out.diffs).toEqual([]);
    expect(out.status).not.toBe('MISMATCH');
  });

  test('still MISMATCH when some gateway rows carry a correlationId but none match this transaction — the fix must not blunt real detection', () => {
    auditStore.query.mockReturnValue([
      { correlationId: 'other', operation: 'get_balance', outcome: 'success' },
      { operation: 'create_transfer', outcome: 'success' },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
    ]));
    expect(out.sources.mcpAuditStore.status).toBe('MISMATCH');
    expect(out.status).toBe('MISMATCH');
    expect(out.diffs).toContainEqual(expect.objectContaining({
      source: 'mcpAuditStore', side: 'ledger_only', op: 'get_balance',
    }));
  });

  test('SOURCE_UNAVAILABLE (not MISMATCH) when the traffic log has lines but none carry a correlationId at all', () => {
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { type: 'rpc_response', method: 'tools/call', tool: 'get_balance', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(out.sources.mcpTrafficLog.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.sources.mcpTrafficLog.reason).toBe('no_correlation_ids');
    expect(out.sources.mcpTrafficLog.diffs).toEqual([]);
    expect(out.diffs).toEqual([]);
    expect(out.status).not.toBe('MISMATCH');
  });

  test('overall SOURCE_UNAVAILABLE when both witnesses have rows but neither carries a correlationId', () => {
    auditStore.query.mockReturnValue([
      { operation: 'get_balance', outcome: 'success' },
    ]);
    trafficLogger.getMcpTrafficLog.mockReturnValue([
      { type: 'rpc_response', method: 'tools/call', tool: 'get_balance', ok: true },
    ]);
    const out = reconcile(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: { outcome: 'permit' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(out.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.diffs).toEqual([]);
    expect(out.sources.mcpAuditStore.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.sources.mcpTrafficLog.status).toBe('SOURCE_UNAVAILABLE');
  });
});
