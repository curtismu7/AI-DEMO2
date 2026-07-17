// demo_api_ui/src/components/StaleSessionBanner.test.jsx
import React from 'react';
import { render, waitFor } from '@testing-library/react';
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

  it('does not redirect again when landing with ?silent_reauth_failed=1 alongside the URL-cleanup hook (regression: infinite reauth loop)', async () => {
    window.history.replaceState(null, '', '/dashboard?silent_reauth_failed=1');
    getCachedJson.mockResolvedValue({
      data: { staleSession: true, staleReason: 'tokens_missing' },
    });

    const { findByRole } = render(
      <MemoryRouter initialEntries={['/dashboard?silent_reauth_failed=1']}>
        <AppShell />
      </MemoryRouter>,
    );

    // The manual "Sign in again" banner must appear instead of a redirect back
    // into the silent-reauth flow (the URL-cleanup hook legitimately stripping
    // the query param is fine — re-navigating to /silent-reauth is not).
    await findByRole('alert');
    expect(window.location.href).not.toContain('/api/auth/oauth/user/silent-reauth');
  });

  it('attempts a silent reauth redirect on a fresh stale session with no failure marker', async () => {
    getCachedJson.mockResolvedValue({
      data: { staleSession: true, staleReason: 'tokens_missing' },
    });
    delete window.location;
    window.location = { ...window.location, href: '/dashboard', pathname: '/dashboard', search: '' };

    render(<StaleSessionBanner />);

    await waitFor(() =>
      expect(window.location.href).toContain('/api/auth/oauth/user/silent-reauth'),
    );
  });
});
