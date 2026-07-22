import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
vi.mock('../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ placement: 'middle', setSurfaceHostEl: mockSetSurfaceHostEl }),
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
      <LiveUseCaseWorkbenchPage />
    </MemoryRouter>
  );
}

/** Select a card then click its Run button. */
async function runCardMatching(titleRe) {
  const title = await screen.findByText(titleRe);
  const card = title.closest('.luw-card');
  expect(card).toBeTruthy();
  await userEvent.click(card);
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
      expect(screen.getByText(/Delegated access with proof/)).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases', { params: { vertical: 'banking' } });
    expect(screen.getByText(/Authz denied/)).toBeInTheDocument();
    expect(screen.getByText('Demo script')).toBeInTheDocument();
    expect(screen.getByLabelText('Banking glance')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Policy')).toBeInTheDocument();
  });

  it('filters cards via the search box', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/Delegated access with proof/));
    const search = screen.getByPlaceholderText(/Filter use cases/i);
    await userEvent.type(search, 'authz');
    await waitFor(() => {
      expect(screen.queryByText(/Delegated access with proof/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Authz denied/)).toBeInTheDocument();
  });

  it('registers a narrow agent host on mount so the real single agent portals in', async () => {
    renderPage();
    await waitFor(() => screen.getByText(/Delegated access with proof/));
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
