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

  test('wires subscribeConsent and forwards consent as CUSTOM SSE event', async () => {
    const { _ensureHitlConsentSubscription, _cleanupHitlConsentSubscription } =
      require('../routes/agentRun').__test;
    const mockRes = { writableEnded: false, write: jest.fn() };

    await _ensureHitlConsentSubscription('run-hitl-sub', mockRes);
    await agentRunStore.publishConsent('run-hitl-sub', { approved: true });
    await new Promise((r) => setImmediate(r));

    expect(mockRes.write).toHaveBeenCalled();
    const payload = mockRes.write.mock.calls[0][0];
    expect(payload).toContain('"name":"hitl_consent"');
    expect(payload).toContain('"approved":true');

    await _cleanupHitlConsentSubscription('run-hitl-sub');
  });
});
