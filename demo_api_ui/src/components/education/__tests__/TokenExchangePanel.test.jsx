import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TokenExchangePanel from '../TokenExchangePanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';
import bffAxios from '../../../services/bffAxios';

vi.mock('../../../services/bffAxios', () => ({ default: { get: vi.fn() } }));

function renderPanel() {
  return render(
    <EducationUIProvider>
      <TokenExchangePanel isOpen onClose={() => {}} initialTabId="live" />
    </EducationUIProvider>
  );
}

function mockSessionPreview(tokenEvents, authenticated = true) {
  bffAxios.get.mockImplementation(async (url) => ({ data: url === '/api/auth/session'
    ? { authenticated }
    : { tokenEvents } }));
}

describe('TokenExchangePanel — Live Tokens tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows decoded session claims when OAuth status omits the raw token', async () => {
    mockSessionPreview([
      { id: 'user-token', status: 'active', claims: { sub: 'u10', scope: 'read write' }, hiddenClaims: ['may_act'] },
    ]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('User Token — decoded claims')).toBeInTheDocument());
    expect(screen.getByText(/u10/)).toBeInTheDocument();
    expect(screen.queryByText(/please sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may_act is absent/i)).not.toBeInTheDocument();
    expect(bffAxios.get).toHaveBeenCalledWith('/api/tokens/session-preview');
    expect(bffAxios.get).toHaveBeenCalledWith('/api/auth/session');
  });

  it('asks for sign-in when session preview has no user token', async () => {
    mockSessionPreview([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/No session token available — please sign in/)).toBeInTheDocument());
  });

  it('recognizes an active opaque user token without decoded claims', async () => {
    mockSessionPreview([
      { id: 'user-token', status: 'active', claims: null },
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Active user token; decoded claims are unavailable/)).toBeInTheDocument());
    expect(screen.queryByText(/please sign in/i)).not.toBeInTheDocument();
  });

  it('does not call an expired OAuth token active when generic session status rejects it', async () => {
    mockSessionPreview([{ id: 'user-token', status: 'active', claims: { sub: 'expired' } }], false);
    renderPanel();

    await waitFor(() => expect(screen.getByText(/No session token available — please sign in/)).toBeInTheDocument());
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument();
    expect(bffAxios.get).not.toHaveBeenCalledWith('/api/tokens/session-preview');
  });
});
