import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store, closeSse, sse } = vi.hoisted(() => ({
  store: { beginTrace: vi.fn(), ingestTokenEvent: vi.fn(), ingestAuthorize: vi.fn(), ingestAuthorizeEvaluations: vi.fn(), completeTrace: vi.fn() },
  closeSse: vi.fn(),
  sse: { handler: null },
}));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: store }));
vi.mock('../../services/mcpFlowSseClient', () => ({ openMcpFlowSse: vi.fn((id, fn) => { sse.handler = fn; return closeSse; }) }));
import { openMcpFlowSse } from '../../services/mcpFlowSseClient';
import { startFlowTracedRun } from '../flowTracedRun';

beforeEach(() => { vi.useFakeTimers(); sse.handler = null; Object.values(store).forEach((f) => f.mockReset()); closeSse.mockClear(); openMcpFlowSse.mockClear(); });
afterEach(() => vi.useRealTimers());

describe('startFlowTracedRun', () => {
  it('starts the trace with an id, clears the live token events and listens to that id\'s live stream', () => {
    const setTokenEvents = vi.fn();
    const run = startFlowTracedRun('pay a $2500 change fee', { setTokenEvents });
    expect(typeof run.flowTraceId).toBe('string');
    expect(run.flowTraceId.length).toBeGreaterThan(8);
    expect(store.beginTrace).toHaveBeenCalledWith({ prompt: 'pay a $2500 change fee', flowTraceId: run.flowTraceId });
    expect(setTokenEvents).toHaveBeenCalledWith(null, []);
    expect(openMcpFlowSse).toHaveBeenCalledWith(run.flowTraceId, expect.any(Function));
  });

  it('each run gets its own id', () => {
    expect(startFlowTracedRun('a').flowTraceId).not.toBe(startFlowTracedRun('b').flowTraceId);
  });

  it('live token events from the stream go into the trace tagged with the run id; other events are ignored', () => {
    const run = startFlowTracedRun('x');
    sse.handler({ type: 'token-event', id: 'gw-authorize', status: 'deny', label: 'PingOne Authorize' });
    expect(store.ingestTokenEvent).toHaveBeenCalledWith({ id: 'gw-authorize', status: 'deny', label: 'PingOne Authorize', flowTraceId: run.flowTraceId });
    sse.handler({ type: 'something-else' });
    sse.handler({ phase: 'stream_end' });
    expect(store.ingestTokenEvent).toHaveBeenCalledTimes(1);
  });

  it('an mcp-result event is announced to the page, tagged with the run id', () => {
    const run = startFlowTracedRun('x');
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener('mcp-tool-result-sse', on);
    sse.handler({ type: 'mcp-result', tool: 'pay_airline_fee', ok: false });
    window.removeEventListener('mcp-tool-result-sse', on);
    expect(seen).toEqual([{ type: 'mcp-result', tool: 'pay_airline_fee', ok: false, flowTraceId: run.flowTraceId }]);
  });

  it('a store that throws never breaks the run (display only)', () => {
    store.ingestTokenEvent.mockImplementation(() => { throw new Error('boom'); });
    startFlowTracedRun('x');
    expect(() => sse.handler({ type: 'token-event', id: 'a' })).not.toThrow();
  });

  describe('ingestResponse', () => {
    it('hands the reply\'s token events to the live view, using the first tool called', () => {
      const setTokenEvents = vi.fn();
      const run = startFlowTracedRun('x', { setTokenEvents });
      run.ingestResponse({ tokenEvents: [{ id: 'a' }], toolsCalled: ['get_loyalty_status'] });
      expect(setTokenEvents).toHaveBeenLastCalledWith('get_loyalty_status', [{ id: 'a' }]);
    });
    it('feeds the authorize decision(s) into the trace with this run\'s id', () => {
      const run = startFlowTracedRun('x');
      run.ingestResponse({ mcpAuthorizeEvaluation: { decision: 'DENY' }, mcpAuthorizeEvaluations: [{ decision: 'PERMIT' }] });
      expect(store.ingestAuthorize).toHaveBeenCalledWith({ decision: 'DENY' }, run.flowTraceId);
      expect(store.ingestAuthorizeEvaluations).toHaveBeenCalledWith([{ decision: 'PERMIT' }]);
    });
    it('a reply with none of these is fine', () => {
      const run = startFlowTracedRun('x', { setTokenEvents: vi.fn() });
      expect(() => run.ingestResponse({})).not.toThrow();
      expect(() => run.ingestResponse(null)).not.toThrow();
      expect(store.ingestAuthorize).not.toHaveBeenCalled();
    });
  });

  describe('settle / abandon', () => {
    it('completes the trace with the outcome and closes the stream only after a short delay (it lags the HTTP reply)', () => {
      const run = startFlowTracedRun('x');
      run.settle(true);
      expect(store.completeTrace).toHaveBeenCalledWith(true, run.flowTraceId, null);
      expect(closeSse).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(closeSse).toHaveBeenCalledTimes(1);
    });
    it('a refusal completes the trace as not ok with the reason', () => {
      const run = startFlowTracedRun('x');
      run.settle(false, 'tier ceiling');
      expect(store.completeTrace).toHaveBeenCalledWith(false, run.flowTraceId, 'tier ceiling');
    });
    it('settles once, however many times it is called', () => {
      const run = startFlowTracedRun('x');
      run.settle(true); run.settle(false, 'late');
      expect(store.completeTrace).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10000);
      expect(closeSse).toHaveBeenCalledTimes(1);
    });
    it('abandon closes the stream at once and never completes the trace (the run is being retried)', () => {
      const run = startFlowTracedRun('x');
      run.abandon();
      expect(closeSse).toHaveBeenCalledTimes(1);
      run.settle(true);
      expect(store.completeTrace).not.toHaveBeenCalled();
    });
  });
});
