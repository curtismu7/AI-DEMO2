import { describe, it, expect, beforeEach } from 'vitest';
import { tokenChainTraceStore } from '../tokenChainTraceStore';

describe('tokenChainTraceStore.ingestTokenEvent', () => {
  beforeEach(() => {
    tokenChainTraceStore.reset();
  });

  it('appends a new event without touching existing ones', () => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'user-token', status: 'active' }]);
    tokenChainTraceStore.ingestTokenEvent({ id: 'tools-list', status: 'success' });
    const state = tokenChainTraceStore.getState();
    expect(state.trace.tokenEvents.map((e) => e.id)).toEqual(['user-token', 'tools-list']);
  });

  it('replaces an existing event with the same id in place (status transition)', () => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'gw-authorize', status: 'waiting' }]);
    tokenChainTraceStore.ingestTokenEvent({ id: 'gw-authorize', status: 'permit' });
    const state = tokenChainTraceStore.getState();
    expect(state.trace.tokenEvents).toHaveLength(1);
    expect(state.trace.tokenEvents[0].status).toBe('permit');
  });
});
