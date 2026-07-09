'use strict';

jest.mock('../services/agentRunStore', () => {
  const { EventEmitter } = require('events');
  const state = new Map();
  const emitter = new EventEmitter();
  const agentRunStore = {
    async setRunState(runId, value) { state.set(runId, value); },
    async getRunState(runId) { return state.get(runId) || null; },
    async deleteRunState(runId) { state.delete(runId); },
    async publishConsent(runId, payload) { emitter.emit(`consent:${runId}`, payload); },
    async subscribeConsent(runId, handler) {
      const channel = `consent:${runId}`;
      emitter.on(channel, handler);
      return () => { emitter.off(channel, handler); };
    },
  };
  return { agentRunStore };
});

const { agentRunStore } = require('../services/agentRunStore');
const { _recordTraceEvents, _ensureHitlConsentSubscription, _cleanupHitlConsentSubscription } =
  require('../routes/agentRun').__test;

describe('agentRun HITL suspend wiring', () => {
  beforeEach(async () => {
    await agentRunStore.deleteRunState('run-hitl-1');
    await _cleanupHitlConsentSubscription('run-hitl-sub');
  });

  test('persists suspended_hitl with userId when RUN_FINISHED interrupt is recorded', async () => {
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
