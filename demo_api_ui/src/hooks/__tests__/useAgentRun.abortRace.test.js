/**
 * useAgentRun — abort-race regression test.
 *
 * useAgentRun is instantiated exactly once per AIAgent (a single shared
 * `abortRef`), so every send path (typed message, chip, HITL resume) shares
 * one AbortController ref. When a new run() supersedes an older in-flight
 * run, run() aborts the previous controller and installs its own. The older
 * run's stream loop then unwinds asynchronously and — before the fix below —
 * its `finally` block unconditionally nulled `abortRef.current`, even though
 * that ref had already been reassigned to the newer (still-active) run's
 * controller. That silently broke `abort()` (called on logout/unmount) for
 * the remainder of the newer run.
 *
 * This test simulates: run A starts and hangs mid-stream; run B starts,
 * which aborts A and installs its own controller; A's stream loop then
 * rejects with AbortError and unwinds through the finally block. We assert
 * that the hook's exposed `abort()` can still cancel B's controller
 * afterward (not a no-op), and that `isRunning` still reflects B.
 */
import { renderHook, act } from '@testing-library/react';
import { useAgentRun } from '../useAgentRun';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../services/mcpFlowSseClient', () => ({
  openMcpFlowSse: vi.fn(() => () => {}),
}));
vi.mock('../../services/agentFlowDiagramService', () => ({
  agentFlowDiagram: { applyServerEvent: vi.fn() },
}));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    bindFlowTrace: vi.fn(),
    ingestTokenEvent: vi.fn(),
    completeTrace: vi.fn(),
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('useAgentRun — abort race between superseding runs', () => {
  let signals;
  let origFetch;

  beforeEach(() => {
    signals = [];
    origFetch = global.fetch;
    // Each fetch() call resolves immediately (ok response) but the body
    // stream's reader.read() hangs until this call's AbortSignal fires —
    // mirroring how a real fetch() body stream errors when its controller
    // is aborted mid-read.
    global.fetch = vi.fn((_url, opts) => {
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
            if (signal.aborted) {
              abortErr();
              return;
            }
            signal.addEventListener('abort', abortErr, { once: true });
          }),
        releaseLock: () => {},
      };
      return Promise.resolve({
        ok: true,
        body: { getReader: () => reader },
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('abort() still cancels the newer run after an older superseded run finishes cleanup', async () => {
    const { result } = renderHook(() => useAgentRun({}));

    let runAPromise;
    act(() => {
      runAPromise = result.current.run({ threadId: 't', runId: 'A', messages: [] });
    });
    // Let run A get past `await fetch(...)` and into the hanging `await reader.read()`.
    await flush();

    let runBPromise;
    act(() => {
      // Starting B aborts A's controller (signals[0]) and installs B's controller (signals[1]).
      runBPromise = result.current.run({ threadId: 't', runId: 'B', messages: [] });
    });
    await flush();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true); // A was aborted by B, as before the fix.
    expect(signals[1].aborted).toBe(false); // B is still active.

    // Let A's stream loop unwind (its pending read() rejected with AbortError)
    // and run its finally block.
    await act(async () => {
      await runAPromise;
    });

    // The bug: A's finally unconditionally nulled abortRef.current, wiping out
    // B's controller even though B is still the active run.
    expect(result.current.isRunning).toBe(true);

    act(() => {
      result.current.abort();
    });

    // abort() must still be able to cancel B's controller — not a silent no-op.
    expect(signals[1].aborted).toBe(true);

    // Clean up the still-pending run B promise so it doesn't leak into other tests.
    await act(async () => {
      await runBPromise;
    });
  });
});

// Regression: abort() is also the AIAgent unmount-cleanup handler, which fires
// on every unmount — including React StrictMode's mount/unmount/remount probe
// on a component that never called run(). completeTrace(false) used to fire
// unconditionally, painting the token-chain trace singleton with outcome
// "error" before the user had done anything, so a brand-new session's Token
// Chain panel showed a red "RUN ERROR" badge with zero real activity behind it.
describe('useAgentRun — abort() with nothing in flight', () => {
  it('does not mark the trace as errored when no run was ever started', () => {
    tokenChainTraceStore.completeTrace.mockClear();
    const { result } = renderHook(() => useAgentRun({}));

    act(() => {
      result.current.abort();
    });

    expect(tokenChainTraceStore.completeTrace).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(false);
  });
});
