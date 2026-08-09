// demo_api_ui/src/components/StaleSessionBanner.test.jsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/cachedStatusService', () => ({
  getCachedJson: vi.fn(),
}));

import { getCachedJson } from '../services/cachedStatusService';
import StaleSessionBanner from './StaleSessionBanner';
import { useOAuthUrlCleanup } from '../hooks/useOAuthUrlCleanup';

// Mirrors real app wiring: a parent (App.js) calls useOAuthUrlCleanup() while
// StaleSessionBanner is mounted lower in the tree — both react to the same
// ?silent_reauth_failed=1 param on the same page load.
function AppShell() {
  useOAuthUrlCleanup();
  return <StaleSessionBanner />;
}

describe('StaleSessionBanner', () => {
  beforeEach(() => {
    getCachedJson.mockReset();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/dashboard');
  });

  it('shows the manual sign-in notice on a stale session', async () => {
    getCachedJson.mockResolvedValue({
      data: { staleSession: true, staleReason: 'tokens_missing' },
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppShell />
      </MemoryRouter>,
    );

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('renders nothing when the session is healthy', async () => {
    getCachedJson.mockResolvedValue({ data: { staleSession: false } });

    const { container } = render(<StaleSessionBanner />);

    await waitFor(() => expect(getCachedJson).toHaveBeenCalled());
    expect(container.querySelector('.stale-session-banner')).toBeNull();
  });

  // The silent prompt=none reauth was removed. It could not distinguish "PingOne
  // session expired" from "PingOne will never issue one", so a dead SSO session
  // produced login_required forever — 51 full-page redirects in one observed
  // session, which also swallowed clicks on the real Sign In button.
  it('never navigates on its own, even under StrictMode with a stale session', async () => {
    getCachedJson.mockResolvedValue({
      data: { staleSession: true, staleReason: 'tokens_missing' },
    });
    delete window.location;
    window.location = { ...window.location, href: '/dashboard', pathname: '/dashboard', search: '' };

    render(
      <React.StrictMode>
        <StaleSessionBanner />
      </React.StrictMode>,
    );

    await screen.findByRole('alert');
    expect(window.location.href).toBe('/dashboard');
    expect(window.location.href).not.toContain('silent-reauth');
  });
});
