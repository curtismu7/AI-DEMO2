// banking_api_ui/src/hooks/__tests__/useAgentCCTokenPrefetch.test.js
//
// Regression guard for the 2026-05-12 fix: the agent-cc-preview prefetch
// must NOT fire on documentation-only pages (sequence diagrams, architecture
// flows). Hitting /api/tokens/agent-cc-preview on those pages produced 401
// noise in the DevTools console because the route has requireSession
// middleware and educational pages can be viewed without an MCP session.
//
// See banking_api_ui/src/utils/educationalPages.js for the path list.

import { act, renderHook } from '@testing-library/react';
import { useAgentCCTokenPrefetch } from '../useAgentCCTokenPrefetch';
import { useTokenChainOptional } from '../../context/TokenChainContext';

// Stub the TokenChain context so the hook has a non-null context to act on.
// Without this the hook short-circuits at `if (!tokenChain) return` and we
// can't observe the path-check branch. Declared as a jest.fn() (not a plain
// arrow) so individual tests can override its per-render return value via
// mockImplementation — needed below to simulate a context whose object
// identity changes every render but whose setTokenEvents callback does not.
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: jest.fn(() => ({
    events: [],
    setTokenEvents: jest.fn(),
  })),
}));

describe('useAgentCCTokenPrefetch — path gating', () => {
  let fetchMock;
  let locationSpy;

  beforeEach(() => {
    fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tokenEvents: [] }),
      }),
    );
    global.fetch = fetchMock;
    locationSpy = jest.spyOn(window, 'location', 'get');
  });

  afterEach(() => {
    locationSpy.mockRestore();
    delete global.fetch;
  });

  function setPath(pathname) {
    locationSpy.mockReturnValue({ pathname });
  }

  it.each([
    '/sequence-diagram',
    '/architecture',
    '/architecture/system',
    '/architecture/flow',
    '/architecture/token-flow',
    '/architecture/overview',
  ])('does NOT call /api/tokens/agent-cc-preview when on %s', async (path) => {
    setPath(path);
    await act(async () => {
      renderHook(() => useAgentCCTokenPrefetch());
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '/dashboard',
    '/admin',
    '/monitoring/token-chain',
    '/agent',
  ])('DOES call /api/tokens/agent-cc-preview when on %s', async (path) => {
    setPath(path);
    await act(async () => {
      renderHook(() => useAgentCCTokenPrefetch());
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tokens/agent-cc-preview',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});

// Regression guard for the "prefetch once on mount" bug: TokenChainContext's
// `value` is rebuilt via useMemo on nearly every provider state change (poll
// tick, SSE events, history writes), so `tokenChain` gets a new object
// identity on every one of those renders even though the underlying
// `setTokenEvents` callback (a useCallback([]) on the context) never changes.
// The effect must depend on that stable member, not the whole tokenChain
// object, or it re-fires and re-fetches on every such render.
describe('useAgentCCTokenPrefetch — stable dependency (no re-fetch loop)', () => {
  let fetchMock;
  let locationSpy;
  let stableSetTokenEvents;

  beforeEach(() => {
    fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tokenEvents: [] }),
      }),
    );
    global.fetch = fetchMock;
    locationSpy = jest.spyOn(window, 'location', 'get');
    locationSpy.mockReturnValue({ pathname: '/dashboard' });
    stableSetTokenEvents = jest.fn();
  });

  afterEach(() => {
    locationSpy.mockRestore();
    delete global.fetch;
    // Restore the default mock implementation so this test's override
    // doesn't leak into other describe blocks in this file.
    useTokenChainOptional.mockImplementation(() => ({
      events: [],
      setTokenEvents: jest.fn(),
    }));
  });

  it('does not re-fetch when tokenChain gets a new object identity but setTokenEvents is unchanged', async () => {
    // Simulate TokenChainContext's useMemo: a brand-new object every call,
    // but the same underlying setTokenEvents reference — exactly what the
    // real provider does on every poll/SSE/history-write render.
    let renderCount = 0;
    useTokenChainOptional.mockImplementation(() => {
      renderCount += 1;
      return {
        events: [],
        setTokenEvents: stableSetTokenEvents,
        // A field that changes every render, forcing a new object identity
        // even though setTokenEvents itself is stable.
        _renderTick: renderCount,
      };
    });

    const { rerender } = renderHook(() => useAgentCCTokenPrefetch());
    await act(async () => {});

    // Simulate several provider re-renders (poll tick / SSE / history write)
    // that each produce a new tokenChain object identity.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        rerender();
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
