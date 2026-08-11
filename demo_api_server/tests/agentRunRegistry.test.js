// LMDB_PATH is overridden to an isolated dir in tests/setup.js — see
// services/lmdb/openEnv.js's own comment on that env var.
const { startRun, endRun, listActiveRuns } = require('../services/agentRunRegistry');

describe('agentRunRegistry', () => {
  test('a started run appears in listActiveRuns for its own agentKey', async () => {
    const runId = startRun('agent-a', { tool: 'reorder', userId: 'u1' });
    const active = listActiveRuns('agent-a');
    expect(active.some((r) => r.runId === runId && r.tool === 'reorder')).toBe(true);
    endRun(runId);
  });

  test('endRun removes it', () => {
    const runId = startRun('agent-b', { tool: 'create_transfer', userId: 'u2' });
    endRun(runId);
    expect(listActiveRuns('agent-b').some((r) => r.runId === runId)).toBe(false);
  });

  test('listActiveRuns is scoped to its own agentKey', () => {
    const runId = startRun('agent-c', { tool: 'pay_bill', userId: 'u3' });
    expect(listActiveRuns('agent-d')).toEqual([]);
    endRun(runId);
  });

  test('an unknown runId is a safe no-op', () => {
    expect(() => endRun('not-a-real-run-id')).not.toThrow();
  });

  test('newest run for an agentKey sorts first', async () => {
    const first = startRun('agent-e', { tool: 'reorder', userId: 'u1' });
    await new Promise((r) => setTimeout(r, 5));
    const second = startRun('agent-e', { tool: 'checkout', userId: 'u1' });
    const active = listActiveRuns('agent-e');
    expect(active[0].runId).toBe(second);
    expect(active[1].runId).toBe(first);
    endRun(first); endRun(second);
  });
});
