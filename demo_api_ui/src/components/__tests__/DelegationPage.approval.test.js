import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DelegationPage from '../DelegationPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ pageManifest: null }),
}));
vi.mock('../../context/DemoTourContext', () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));
vi.mock('../../services/agentAuthorizationService', () => ({
  getAgentAuthStatus: vi.fn().mockResolvedValue({ authorized: false, enforced: false }),
  setAgentAuthorization: vi.fn(),
}));
vi.mock('../../utils/authUi', () => ({ requestSilentReauth: vi.fn() }));

const PENDING_DELEGATION = {
  id: 'deleg-1',
  delegate_email: 'dana@example.com',
  scopes: ['create_transfer'],
  granted_at: '2026-07-22T00:00:00.000Z',
  pendingApproval: { status: 'pending', amount: 600, tool: 'submit_expense' },
};

function mockFetchSequence() {
  global.fetch = jest.fn((url) => {
    if (url === '/api/delegation') {
      return Promise.resolve({ json: () => Promise.resolve({ delegations: [PENDING_DELEGATION] }) });
    }
    if (url === '/api/delegation/history') {
      return Promise.resolve({ json: () => Promise.resolve({ history: [] }) });
    }
    if (url === '/api/delegation/deleg-1/approve') {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
}

describe('DelegationPage — manager approve/deny row', () => {
  beforeEach(() => mockFetchSequence());
  afterEach(() => { delete global.fetch; });

  it('shows an Approve/Deny row for a delegation with a pending approval', async () => {
    render(<DelegationPage user={{ id: 'manager-1' }} />);
    await waitFor(() => expect(screen.getByText(/dana@example.com/)).toBeInTheDocument());
    expect(screen.getByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('calls the approve endpoint and reloads on click', async () => {
    render(<DelegationPage user={{ id: 'manager-1' }} />);
    await waitFor(() => expect(screen.getByText(/dana@example.com/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/delegation/deleg-1/approve', expect.objectContaining({ method: 'POST' }));
    });
  });
});
