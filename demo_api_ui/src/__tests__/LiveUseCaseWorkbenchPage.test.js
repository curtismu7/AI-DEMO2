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
});
