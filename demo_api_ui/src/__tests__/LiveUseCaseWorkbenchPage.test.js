import { render, screen, waitFor } from '@testing-library/react';
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

describe('LiveUseCaseWorkbenchPage', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.get.mockResolvedValue({ data: { useCases: MOCK_USE_CASES } });
  });

  it('fetches the real catalog for the active vertical and renders tracks + rows', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Delegated access with proof/)).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases', { params: { vertical: 'banking' } });
    expect(screen.getByText(/Authz denied/)).toBeInTheDocument();
    expect(screen.getByText('PERMIT')).toBeInTheDocument();
    expect(screen.getByText('DENY')).toBeInTheDocument();
  });

  it('filters rows via the search box', async () => {
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
    // The host-registration effect (mirroring UserDashboard.js) fires more than once
    // during mount — an initial call with the pre-ref-attach null, a functional
    // cleanup-updater call, then the call carrying the actual attached DOM node.
    // Find the call that actually carries the element rather than assuming index 0.
    const registeredEl = mockSetSurfaceHostEl.mock.calls
      .map((call) => call[0])
      .find((arg) => arg instanceof HTMLElement);
    expect(registeredEl).toBeInstanceOf(HTMLElement);
  });
});
