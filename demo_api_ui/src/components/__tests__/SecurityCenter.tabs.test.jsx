// demo_api_ui/src/components/__tests__/SecurityCenter.tabs.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SecurityCenter from '../SecurityCenter';

vi.mock('../../services/configService', () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({ pingone_environment_id: 'env-123' }),
}));

vi.mock('../../utils/appToast', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const USER = { firstName: 'Ada', lastName: 'Byron', username: 'ada' };

// The component talks to the BFF with bare fetch, so route by URL.
function mockFetch({ devices = [], session = {} } = {}) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          authType: 'oauth',
          user: { email: 'ada@example.com' },
          sessionStoreHealthy: true,
          ...session,
        }),
      });
    }
    if (String(url).includes('/api/auth/mfa/devices')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ devices }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

const PLACEHOLDER = 'This feature is not available in this demo.';

beforeEach(() => {
  mockFetch();
});

describe('SecurityCenter tabs', () => {
  // The defect this pins: only the MFA tab was implemented, so Overview,
  // Password and Sessions all fell through to the placeholder.
  it('renders no "not available" placeholder on any tab', async () => {
    render(<SecurityCenter user={USER} />);
    await waitFor(() => expect(screen.getByText('Signed in as')).toBeInTheDocument());

    for (const tab of ['Password', 'Sessions', 'MFA', 'Overview']) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      await waitFor(() => expect(screen.queryByText(PLACEHOLDER)).not.toBeInTheDocument());
    }
  });

  it('overview reports the real device count and sign-in method', async () => {
    mockFetch({ devices: [{ id: 'd1', type: 'TOTP' }, { id: 'd2', type: 'SMS' }] });
    render(<SecurityCenter user={USER} />);

    await waitFor(() => expect(screen.getByText('2 devices registered')).toBeInTheDocument());
    expect(screen.getByText('PingOne (OAuth / OIDC)')).toBeInTheDocument();
    expect(screen.getByText('Ada Byron')).toBeInTheDocument();
  });

  it('overview warns when no MFA device is registered', async () => {
    mockFetch({ devices: [] });
    render(<SecurityCenter user={USER} />);
    await waitFor(() => expect(screen.getByText('No devices registered')).toBeInTheDocument());
  });

  it('password tab links to PingOne self-service for a federated user', async () => {
    render(<SecurityCenter user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));

    const link = await screen.findByRole('link', { name: /Manage password in PingOne/ });
    expect(link).toHaveAttribute('href', 'https://apps.pingone.com/env-123/myaccount');
  });

  it('sessions tab shows the current session and is explicit that it is the only one', async () => {
    render(<SecurityCenter user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    await waitFor(() => expect(screen.getByText('Signed in')).toBeInTheDocument());
    expect(screen.getByText(/current session only/)).toBeInTheDocument();
  });

  it('surfaces a degraded session store rather than claiming healthy', async () => {
    mockFetch({ session: { sessionStoreHealthy: false } });
    render(<SecurityCenter user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    await waitFor(() => expect(screen.getByText('Degraded')).toBeInTheDocument());
  });

  // The BFF sends `req._sessionStoreHealthy ?? null`, so null means "not
  // reported" — painting that green would claim a health check that never ran.
  it('shows unknown, not healthy, when the BFF reports null store health', async () => {
    mockFetch({ session: { sessionStoreHealthy: null } });
    render(<SecurityCenter user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument());
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('shows healthy only on an explicit true', async () => {
    mockFetch({ session: { sessionStoreHealthy: true } });
    render(<SecurityCenter user={USER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    await waitFor(() => expect(screen.getByText('Healthy')).toBeInTheDocument());
  });
});
