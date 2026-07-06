'use strict';

process.env.AGUI_STORE_FALLBACK = 'true';

const { agentRunStore } = require('../services/agentRunStore');

describe('agentRun HITL suspend wiring', () => {
  beforeEach(async () => {
    await agentRunStore.deleteRunState('run-hitl-1');
  });

  test('persists suspended_hitl with userId when RUN_FINISHED interrupt is recorded', async () => {
    const { _recordTraceEvents } = require('../routes/agentRun').__test;
    const chunk = Buffer.from(
      'data: {"type":"RUN_FINISHED","runId":"run-hitl-1","threadId":"t-1","outcome":{"type":"interrupt","interrupts":[{"id":"int-1"}]}}\n\n',
    );

    _recordTraceEvents('run-hitl-1', chunk, 'user-sub-abc');
    await new Promise((r) => setImmediate(r));

    const state = await agentRunStore.getRunState('run-hitl-1');
    expect(state).toEqual({
      status: 'suspended_hitl',
      userId: 'user-sub-abc',
      threadId: 't-1',
      interrupt: { id: 'int-1' },
    });
  });
});
