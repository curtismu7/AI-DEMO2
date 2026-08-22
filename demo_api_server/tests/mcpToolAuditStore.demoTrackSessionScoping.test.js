'use strict';
/**
 * Regression: recordToolCall's Guided Demo Track observation
 * (services/demoTrackService.js's observeToolCall) landed in the shared
 * `_default` run bucket regardless of which presenter session made the tool
 * call, because recordToolCall never received or forwarded a sessionId.
 * Caught by Greptile review on PR #2240 — the other two observation hooks
 * (observeDecision, observeAttackSim) were fixed to key off req.sessionID,
 * but this one, reached via the LangChain tool-invocation path
 * (agentBuilder.js -> mcpToolRegistry.js's tools -> callMcpToolInternal ->
 * recordMcpToolCall), was missed.
 *
 * Fix: thread sessionId through that whole chain into recordToolCall, which
 * now forwards it to observeToolCall.
 */

const auditStore = require('../services/mcpToolAuditStore');
const demoTrack = require('../services/demoTrackService');

describe('mcpToolAuditStore.recordToolCall — demo track session scoping', () => {
  beforeEach(() => {
    demoTrack._resetForTests('session-a');
    demoTrack._resetForTests('session-b');
    demoTrack._resetForTests(); // default bucket
  });

  test('a tool-call PERMIT is stamped on the calling session\'s run, not the shared default', () => {
    auditStore.recordToolCall({
      userId: 'user-a',
      toolName: 'get_account_balance',
      success: true,
      duration: 12,
      sessionId: 'session-a',
    });

    const stateA = demoTrack.getState('session-a');
    expect(stateA.run.slots['delegated-access:green']).toMatchObject({
      verdict: 'PERMIT',
      via: 'get_account_balance',
    });

    // Session B and the shared default bucket are untouched.
    expect(demoTrack.getState('session-b').run.slots['delegated-access:green']).toBeUndefined();
    expect(demoTrack.getState().run.slots['delegated-access:green']).toBeUndefined();
  });

  test('two sessions calling the same tool each advance only their own run', () => {
    auditStore.recordToolCall({ userId: 'user-a', toolName: 'get_account_balance', success: true, duration: 1, sessionId: 'session-a' });
    auditStore.recordToolCall({ userId: 'user-b', toolName: 'get_account_balance', success: true, duration: 1, sessionId: 'session-b' });

    const runA = demoTrack.getState('session-a').run;
    const runB = demoTrack.getState('session-b').run;
    expect(runA.runId).not.toBe(runB.runId);
    expect(runA.slots['delegated-access:green'].verdict).toBe('PERMIT');
    expect(runB.slots['delegated-access:green'].verdict).toBe('PERMIT');
  });
});
