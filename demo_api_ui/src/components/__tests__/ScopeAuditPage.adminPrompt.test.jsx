/**
 * A customer/guest session hitting the admin-gated scope-audit API used to
 * render the BFF's own 403 ("insufficient_scope") under a "Failed to connect
 * to PingOne" headline — a local role check dressed up as a PingOne outage.
 * 401/403 must render the admin SignInPrompt instead; the connectivity
 * headline is reserved for genuine upstream failures.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ScopeAuditPage from '../ScopeAuditPage';

vi.mock('../CapabilityCallout', () => ({ default: () => null }));

describe('ScopeAuditPage — admin-required prompt on 401/403', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('renders the admin sign-in prompt on 403, not the connectivity error', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'insufficient_scope' }),
      }),
    );

    render(<ScopeAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));

    await screen.findByText(/admin sign-in required/i);
    expect(screen.queryByText(/failed to connect to pingone/i)).toBeNull();
  });

  it('keeps the connectivity error for a genuine upstream failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'PingOne scope audit: upstream timeout' }),
      }),
    );

    render(<ScopeAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));

    await screen.findByText(/failed to connect to pingone/i);
    expect(screen.queryByText(/admin sign-in required/i)).toBeNull();
  });
});
