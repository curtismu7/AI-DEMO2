/**
 * @file TokenExchangeTesterPage.test.jsx
 * Mode toggle + login CTA when subject token is missing.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TokenExchangeTesterPage from '../TokenExchangeTesterPage';

vi.mock('../../components/shared/JsonHighlight', () => ({
  default: ({ value }) => <pre data-testid="json">{JSON.stringify(value)}</pre>,
}));

describe('TokenExchangeTesterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows login CTA when session-preview has no user token', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return { ok: false, status: 401, json: async () => ({ error: 'no' }) };
      }
      if (String(url).includes('agent-cc-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'agent-actor-token-prefetch', status: 'active', claims: { sub: 'agent' }, label: 'Agent CC' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<TokenExchangeTesterPage />);

    await waitFor(() => {
      expect(screen.getByText(/Log in to get user token/i)).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: /Customer Sign In/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/auth/oauth/user/login')
    );
  });

  it('toggles to 2-exchange and requires agent readiness', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('session-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'user-token', status: 'active', claims: { sub: 'u1', scope: 'read write' }, label: 'User' }],
          }),
        };
      }
      if (String(url).includes('agent-cc-preview')) {
        return {
          ok: true,
          json: async () => ({
            tokenEvents: [{ id: 'agent-cc-not-configured', status: 'skipped', explanation: 'Not configured' }],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    render(<TokenExchangeTesterPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exchange Token/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /2-exchange/i }));

    const runBtn = screen.getByRole('button', { name: /Run 2-Exchange/i });
    expect(runBtn).toBeDisabled();
    expect(screen.getByText(/Required for 2-exchange/i)).toBeTruthy();
  });
});
