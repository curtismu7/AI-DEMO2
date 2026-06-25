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

// Stub the TokenChain context so the hook has a non-null context to act on.
// Without this the hook short-circuits at `if (!tokenChain) return` and we
// can't observe the path-check branch.
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({
    events: [],
    setTokenEvents: jest.fn(),
  }),
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
