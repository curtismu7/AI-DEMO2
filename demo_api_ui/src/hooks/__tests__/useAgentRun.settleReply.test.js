/**
 * useAgentRun — the Agent request flow rail's reply step must settle whenever a
 * run ends, not only on RUN_FINISHED / RUN_ERROR. A cancelled run (Start Over,
 * logout, unmount) or a stream that closes with no terminal event otherwise left
 * the shared diagram "running" with a pending reply (Greptile P2 on #3129).
 */
import { renderHook, act } from '@testing-library/react';
import { useAgentRun } from '../useAgentRun';
import { agentFlowDiagram } from '../../services/agentFlowDiagramService';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../services/mcpFlowSseClient', () => ({
  openMcpFlowSse: vi.fn(() => () => {}),
}));
vi.mock('../../services/agentFlowDiagramService', () => ({
  agentFlowDiagram: { applyServerEvent: vi.fn(), completeReply: vi.fn() },
}));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    bindFlowTrace: vi.fn(),
    ingestTokenEvent: vi.fn(),
    completeTrace: vi.fn(),
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** fetch() whose body read hangs until the run's AbortSignal fires. */
function hangingFetch(signals) {
  return vi.fn((_url, opts) => {
    const signal = opts.signal;
    signals.push(signal);
    const reader = {
      read: () =>
        new Promise((_resolve, reject) => {
          const abortErr = () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          };
          if (signal.aborted) { abortErr(); return; }
          signal.addEventListener('abort', abortErr, { once: true });
        }),
      releaseLock: () => {},
    };
    return Promise.resolve({ ok: true, body: { getReader: () => reader }, json: async () => ({}) });
  });
}

describe('useAgentRun — settles the flow reply when a run ends without a terminal event', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = global.fetch;
    agentFlowDiagram.completeReply.mockClear();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('abort() of an in-flight run marks the reply failed', async () => {
    const signals = [];
    global.fetch = hangingFetch(signals);
    const { result } = renderHook(() => useAgentRun({}));

    let runPromise;
    act(() => { runPromise = result.current.run({ threadId: 't', runId: 'A', messages: [] }); });
    await flush();

    act(() => { result.current.abort(); });
    await act(async () => { await runPromise; });

    expect(agentFlowDiagram.completeReply).toHaveBeenCalledWith(false);
  });

  it('a run superseded by a newer one does not settle the reply the newer run owns', async () => {
    const signals = [];
    global.fetch = hangingFetch(signals);
    const { result } = renderHook(() => useAgentRun({}));

    let runAPromise;
    act(() => { runAPromise = result.current.run({ threadId: 't', runId: 'A', messages: [] }); });
    await flush();
    let runBPromise;
    act(() => { runBPromise = result.current.run({ threadId: 't', runId: 'B', messages: [] }); });
    await flush();
    await act(async () => { await runAPromise; }); // A unwinds after B took over

    expect(agentFlowDiagram.completeReply).not.toHaveBeenCalled();

    act(() => { result.current.abort(); });
    await act(async () => { await runBPromise; });
  });

  it('a stream that closes with no RUN_FINISHED / RUN_ERROR marks the reply failed', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }) },
      json: async () => ({}),
    }));
    const { result } = renderHook(() => useAgentRun({}));

    await act(async () => { await result.current.run({ threadId: 't', runId: 'A', messages: [] }); });

    expect(agentFlowDiagram.completeReply).toHaveBeenCalledWith(false);
  });

  it('a non-OK response marks the reply failed', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => ({}) }));
    const { result } = renderHook(() => useAgentRun({}));

    await act(async () => { await result.current.run({ threadId: 't', runId: 'A', messages: [] }); });

    expect(agentFlowDiagram.completeReply).toHaveBeenCalledWith(false);
  });
});

// Regression: agentFlowDiagram.completeReply() above settles a SEPARATE store
// from tokenChainTraceStore — nothing else on this AG-UI path called
// completeTrace() on a normal finish, so trace.outcome stayed null forever
// (only abort() ever settled it). SystemFlowMap/TokenChainTraceRail could
// still infer completion from the reply text itself, but the replay history
// and anything reading trace.outcome directly never saw the run settle.
describe('useAgentRun — settles tokenChainTraceStore on RUN_FINISHED / RUN_ERROR', () => {
  function sseFetch(eventLine) {
    let served = false;
    return vi.fn(() => Promise.resolve({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (served) return { done: true };
            served = true;
            return { done: false, value: new TextEncoder().encode(`data: ${eventLine}\n\n`) };
          },
          releaseLock: () => {},
        }),
      },
      json: async () => ({}),
    }));
  }

  beforeEach(() => {
    tokenChainTraceStore.completeTrace.mockClear();
  });

  it('a successful RUN_FINISHED completes the trace as ok', async () => {
    global.fetch = sseFetch(JSON.stringify({ type: 'RUN_FINISHED', outcome: { type: 'success' } }));
    const { result } = renderHook(() => useAgentRun({}));

    await act(async () => { await result.current.run({ threadId: 't', runId: 'A', messages: [] }); });

    expect(tokenChainTraceStore.completeTrace).toHaveBeenCalledWith(true, expect.any(String));
  });

  it('an interrupt (HITL pause) RUN_FINISHED does not complete the trace', async () => {
    global.fetch = sseFetch(JSON.stringify({ type: 'RUN_FINISHED', outcome: { type: 'interrupt', interrupts: [{}] } }));
    const { result } = renderHook(() => useAgentRun({}));

    await act(async () => { await result.current.run({ threadId: 't', runId: 'A', messages: [] }); });

    expect(tokenChainTraceStore.completeTrace).not.toHaveBeenCalled();
  });

  it('a RUN_ERROR completes the trace as failed', async () => {
    global.fetch = sseFetch(JSON.stringify({ type: 'RUN_ERROR', message: 'boom' }));
    const { result } = renderHook(() => useAgentRun({}));

    await act(async () => { await result.current.run({ threadId: 't', runId: 'A', messages: [] }); });

    expect(tokenChainTraceStore.completeTrace).toHaveBeenCalledWith(false, expect.any(String));
  });
});
