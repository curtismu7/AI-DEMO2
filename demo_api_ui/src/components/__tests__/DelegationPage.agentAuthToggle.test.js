/**
 * AgentAuthorizationCard's toggle swallowed any setAgentAuthorization
 * failure with `catch { setWorking(false); }` -- no toast, no console.error,
 * no state revert. The badge stayed on its stale value with zero feedback
 * that a security-relevant control failed to update. It also never cleared
 * `working` on SUCCESS, so the button stayed stuck on "Updating..." forever
 * after a toggle that actually worked.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DelegationPage from '../DelegationPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ pageManifest: null }),
}));
vi.mock('../../context/DemoTourContext', () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));
const getAgentAuthStatus = vi.fn();
const setAgentAuthorization = vi.fn();
vi.mock('../../services/agentAuthorizationService', () => ({
  getAgentAuthStatus: (...a) => getAgentAuthStatus(...a),
  setAgentAuthorization: (...a) => setAgentAuthorization(...a),
}));
vi.mock('../../utils/authUi', () => ({ requestSilentReauth: vi.fn() }));
const notifyErrorMock = vi.fn();
vi.mock('../../utils/appToast', () => ({ notifyError: (...a) => notifyErrorMock(...a) }));

function mockFetchSequence() {
  global.fetch = vi.fn((url) => {
    if (url === '/api/delegation') return Promise.resolve({ json: () => Promise.resolve({ delegations: [] }) });
    if (url === '/api/delegation/history') return Promise.resolve({ json: () => Promise.resolve({ history: [] }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
}

describe('AgentAuthorizationCard — toggle failure/success handling', () => {
  beforeEach(() => {
    mockFetchSequence();
    notifyErrorMock.mockClear();
    getAgentAuthStatus.mockResolvedValue({ authorized: false, enforced: false });
  });
  afterEach(() => { delete global.fetch; });

  it('surfaces the failure and re-enables the button instead of staying silently stuck', async () => {
    setAgentAuthorization.mockRejectedValue(new Error('Agent authorization failed (500)'));
    render(<DelegationPage user={{ id: 'u1' }} />);

    const btn = await screen.findByRole('button', { name: /authorize agent/i });
    fireEvent.click(btn);

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalledWith('Agent authorization failed (500)'));
    // Button re-enabled and label reverted -- not stuck on "Updating..."
    await waitFor(() => expect(screen.getByRole('button', { name: /authorize agent/i })).not.toBeDisabled());
    // The badge must not have flipped to "authorized" on a failed call.
    expect(screen.getByText(/agent revoked/i)).toBeInTheDocument();
  });

  it('clears the working state and updates the badge on success', async () => {
    setAgentAuthorization.mockResolvedValue({ ok: true, reauthRequired: false });
    render(<DelegationPage user={{ id: 'u1' }} />);

    const btn = await screen.findByRole('button', { name: /authorize agent/i });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText(/agent authorized/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /revoke agent access/i })).not.toBeDisabled();
    expect(notifyErrorMock).not.toHaveBeenCalled();
  });
});
