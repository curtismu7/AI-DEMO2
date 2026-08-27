import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProofOfEnforcementProvider } from '../context/ProofOfEnforcementContext';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import LiveUseCaseWorkbenchPage from '../pages/LiveUseCaseWorkbenchPage';

vi.mock('../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));
vi.mock('../components/VerticalSwitcher', () => ({
  default: function VerticalSwitcherStub() { return null; },
}));
const mockSetSurfaceHostEl = vi.fn();
const mockSetToolbarHostEl = vi.fn();
vi.mock('../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ placement: 'middle', setSurfaceHostEl: mockSetSurfaceHostEl, setToolbarHostEl: mockSetToolbarHostEl }),
}));
// TokenChainTraceRail (already rendered by the page since Task 4) also calls
// getState/subscribe/reset on this store, so the mock must stub those too or
// the rail crashes on mount for every test in this file, not just the new one.
const mockStore = vi.hoisted(() => ({
  beginTrace: vi.fn(),
  ingestTokenEvents: vi.fn(),
  ingestTokenEvent: vi.fn(),
  ingestAuthorize: vi.fn(),
  completeTrace: vi.fn(),
  getState: vi.fn(() => ({ trace: { tokenEvents: [], phases: [] }, steps: [] })),
  subscribe: vi.fn(() => () => {}),
  reset: vi.fn(),
}));
vi.mock('../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: mockStore,
}));

import apiClient from '../services/apiClient';

const MOCK_USE_CASES = [
  { id: 'UC1', useCaseId: 'delegated-access-with-proof', track: 'foundations',
    title: 'Delegated access with proof', trigger: { type: 'chip', text: 'show my balance' },
    expectedOutcome: 'PERMIT', maturity: 'works' },
  { id: 'UC6', useCaseId: 'authz-denied', track: 'controls',
    title: 'Authz denied', trigger: { type: 'chip', text: 'transfer $2500 from checking to savings' },
    expectedOutcome: 'DENY', maturity: 'works' },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ProofOfEnforcementProvider>
        <LiveUseCaseWorkbenchPage />
      </ProofOfEnforcementProvider>
    </MemoryRouter>
  );
}

/**
 * Click the Run button on a card (visible without selecting first). A use
 * case can legitimately render in more than one section (e.g. Demo script +
 * its track), so this matches the first occurrence — any of the duplicates
 * is the same use case and Run behaves identically.
 */
async function runCardMatching(titleRe) {
  const titles = await screen.findAllByText(titleRe);
  const card = titles[0].closest('.luw-card');
  expect(card).toBeTruthy();
  const runBtn = within(card).getByRole('button', { name: /run/i });
  await userEvent.click(runBtn);
}

describe('LiveUseCaseWorkbenchPage', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.post.mockReset();
    mockSetSurfaceHostEl.mockClear();
    apiClient.get.mockResolvedValue({ data: { useCases: MOCK_USE_CASES } });
  });

  it('fetches the real catalog and renders Mock A demo cards + glance', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/Delegated access with proof/).length).toBeGreaterThan(0);
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases', { params: { vertical: 'banking' } });
    expect(screen.getAllByText(/Authz denied/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Demo script').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Banking glance')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Verdict')).toBeInTheDocument();
  });

  it('shows a Run button on every runnable card without requiring selection', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Delegated access with proof/).length).toBeGreaterThan(0));
    const cards = screen.getAllByText(/Run in agent/i);
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it('filters cards via the search box', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Delegated access with proof/).length).toBeGreaterThan(0));
    const search = screen.getByPlaceholderText(/Filter use cases/i);
    await userEvent.type(search, 'authz');
    await waitFor(() => {
      // Scoped to card titles — the currently-selected use case's live-run
      // header (.ucph__title) legitimately keeps showing regardless of the
      // search box; only the pickable card list should be filtered.
      expect(
        screen.queryAllByText(/Delegated access with proof/, { selector: '.luw-card__title' }),
      ).toHaveLength(0);
    });
    expect(screen.getAllByText(/Authz denied/).length).toBeGreaterThan(0);
  });

  it('registers a narrow agent host on mount so the real single agent portals in', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/Delegated access with proof/).length).toBeGreaterThan(0));
    expect(mockSetSurfaceHostEl).toHaveBeenCalled();
    const registeredEl = mockSetSurfaceHostEl.mock.calls
      .map((call) => call[0])
      .find((arg) => arg instanceof HTMLElement);
    expect(registeredEl).toBeInstanceOf(HTMLElement);
  });

  it('running a chip use case posts, switches vertical, and fires the real agent via banking-agent-prefill', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/use-cases/demo/run') {
        return Promise.resolve({ data: { useCaseId: 'delegated-access-with-proof', triggerText: 'show my balance', type: 'chip', vertical: 'banking' } });
      }
      if (url === '/api/verticals/active') return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    renderPage();
    await runCardMatching(/Delegated access with proof/);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/use-cases/demo/run', { useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
    });
    expect(apiClient.post).toHaveBeenCalledWith('/api/verticals/active', { id: 'banking' });
    await waitFor(() => {
      const fired = dispatchSpy.mock.calls.some(([e]) => e.type === 'banking-agent-prefill' && e.detail?.message === 'show my balance' && e.detail?.autoSend === true);
      expect(fired).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('PERMIT')).toBeInTheDocument();
    });
  });

  it('an older Run trigger resolving after a newer one does not fire the stale prefill (finding #75)', async () => {
    // Reproduced via the 'demo-script' BroadcastChannel path (teleprompter /
    // popped-out 2nd screen) rather than tile clicks: the tile's Run button
    // disables itself while a run is in flight, but a second BroadcastChannel
    // 'run' message is not gated by that state at all, so two overlapping
    // handleRunChip chains are the real-world trigger for this race.
    //
    // Uses an in-process fake BroadcastChannel (same technique as
    // LiveUseCaseWorkbenchPage.test.jsx's TestBroadcastChannel) instead of
    // jsdom's real one — Node's native BroadcastChannel broadcasts across
    // ALL worker threads in the process by channel name, which would leak
    // messages into unrelated test files running in sibling vitest workers.
    class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.listeners = [];
        FakeBroadcastChannel.channels[name] = FakeBroadcastChannel.channels[name] || [];
        FakeBroadcastChannel.channels[name].push(this);
      }
      addEventListener(type, cb) { if (type === 'message') this.listeners.push(cb); }
      removeEventListener(type, cb) { this.listeners = this.listeners.filter((l) => l !== cb); }
      postMessage(data) {
        (FakeBroadcastChannel.channels[this.name] || []).forEach((ch) => {
          if (ch === this) return;
          ch.listeners.forEach((cb) => cb({ data }));
        });
      }
      close() {
        FakeBroadcastChannel.channels[this.name] = (FakeBroadcastChannel.channels[this.name] || []).filter((ch) => ch !== this);
      }
    }
    FakeBroadcastChannel.channels = {};
    const originalBroadcastChannel = global.BroadcastChannel;
    global.BroadcastChannel = FakeBroadcastChannel;

    try {
      apiClient.get.mockResolvedValue({ data: { useCases: MOCK_USE_CASES } });

      // A's chain resolves slowly (deferred), B's resolves fast — simulating
      // A being triggered first but B's response landing first.
      let resolveARun;
      const aRunPromise = new Promise((resolve) => { resolveARun = resolve; });
      apiClient.post.mockImplementation((url, body) => {
        if (url === '/api/use-cases/demo/run') {
          if (body.useCaseId === 'delegated-access-with-proof') {
            return aRunPromise.then(() => ({ data: { useCaseId: 'delegated-access-with-proof', triggerText: 'A stale message', type: 'chip', vertical: 'banking' } }));
          }
          return Promise.resolve({ data: { useCaseId: 'authz-denied', triggerText: 'B fresh message', type: 'chip', vertical: 'banking' } });
        }
        if (url === '/api/verticals/active') return Promise.resolve({ data: {} });
        return Promise.reject(new Error(`unexpected POST ${url}`));
      });
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      renderPage();
      await waitFor(() => expect(screen.getAllByText(/Delegated access with proof/).length).toBeGreaterThan(0));

      const sender = new BroadcastChannel('demo-script');
      // A: triggered first (slow). Posting once here is a race: the page's
      // listener closes over `useCases` and drops any message whose ucId it
      // cannot find, and that effect re-subscribes only after the fetch
      // populates useCases — a separate commit from the text this test already
      // waited for. A message landing in the gap is silently discarded and the
      // run never starts ("Number of calls: 0"). Re-post until the run is
      // actually observed, and only while it has not been, so the retry cannot
      // start a second overlapping A chain.
      await waitFor(() => {
        if (apiClient.post.mock.calls.length === 0) {
          sender.postMessage({ type: 'run', ucId: 'UC1' });
        }
        expect(apiClient.post).toHaveBeenCalledWith('/api/use-cases/demo/run', { useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
      });
      // B: triggered second (fast), before A resolves. Same delivery race — the
      // effect re-subscribes whenever handleRunSelected's identity changes,
      // which A's run just caused — so retry until B's run is observed too.
      await waitFor(() => {
        const bPosted = apiClient.post.mock.calls.some(
          ([url, body]) => url === '/api/use-cases/demo/run' && body?.useCaseId === 'authz-denied',
        );
        if (!bPosted) sender.postMessage({ type: 'run', ucId: 'UC6' });
        expect(apiClient.post).toHaveBeenCalledWith('/api/use-cases/demo/run', { useCaseId: 'authz-denied', vertical: 'banking' });
      });

      // Let B's chain fully resolve and dispatch first.
      await waitFor(() => {
        const fired = dispatchSpy.mock.calls.some(([e]) => e.type === 'banking-agent-prefill' && e.detail?.message === 'B fresh message');
        expect(fired).toBe(true);
      });

      // Now let A's stale chain resolve.
      resolveARun();
      // Give any (incorrect) stale dispatch a tick to happen.
      await new Promise((r) => setTimeout(r, 10));
      sender.close();

      const prefillCalls = dispatchSpy.mock.calls.filter(([e]) => e.type === 'banking-agent-prefill');
      expect(prefillCalls).toHaveLength(1);
      expect(prefillCalls[0][0].detail.message).toBe('B fresh message');
    } finally {
      global.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('running an attack use case posts the sim, remaps its events onto the rail\'s pipeline ids, and surfaces the real Authorize decision', async () => {
    const ATTACK_UC = { id: 'UC5', useCaseId: 'insufficient-scope', track: 'attacks',
      title: 'Wrong / insufficient scope', trigger: { type: 'attack', sim: 'insufficient-scope' },
      expectedOutcome: 'DENY_403', maturity: 'works' };
    apiClient.get.mockResolvedValue({ data: { useCases: [ATTACK_UC] } });
    apiClient.post.mockResolvedValue({
      data: {
        sim: 'insufficient-scope', useCaseId: 'insufficient-scope', status: 403,
        tokenChainEvents: [
          { id: 'user-token', status: 'active', claims: { sub: 'user-1' } },
          { id: 'sim-exchange-ok', status: 'active', claims: { sub: 'user-1', aud: 'gw' } },
          { id: 'sim-gateway-deny', status: 'error', error: 'insufficient_scope', httpStatus: 403 },
        ],
        authorize: { engine: 'PingOne Authorize', decision: 'DENY', outcome: 'DENY', decisionId: 'dec-1' },
      },
    });

    renderPage();
    await runCardMatching(/Wrong \/ insufficient scope/);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'insufficient-scope' });
    });
    expect(mockStore.beginTrace).toHaveBeenCalled();
    expect(mockStore.ingestTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exchanged-token', claims: { sub: 'user-1', aud: 'gw' } }),
    );
    expect(mockStore.ingestTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-token' }),
    );
    expect(mockStore.ingestTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sim-gateway-deny' }),
    );
    expect(mockStore.ingestAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'DENY', outcome: 'DENY' }),
    );
    expect(mockStore.completeTrace).toHaveBeenCalledWith(false);
  });
});
