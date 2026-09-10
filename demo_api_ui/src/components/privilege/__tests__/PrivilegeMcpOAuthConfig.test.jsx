// PrivilegeMcpOAuthConfig — illustrative OAuth config admin page for banking-mcp.
// Covers: loads saved config on mount, Save PUTs the form and never
// re-displays the secret, Test Connection POSTs and shows the live result
// (a 401 is an honest, expected result per privilege/CURRENT-CONFIGURATION.md,
// not a rendering error).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrivilegeMcpOAuthConfig from '../PrivilegeMcpOAuthConfig';

function jsonResponse(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

const EMPTY_CONFIG = {
  clientId: '', issuer: '', tokenEndpoint: '', scopes: '', audience: '', hasClientSecret: false,
};

describe('PrivilegeMcpOAuthConfig', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.endsWith('/api/mcp-oauth-config')) return jsonResponse(EMPTY_CONFIG);
      return jsonResponse({});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the known-blocker callout so the page never implies this works today', async () => {
    render(<PrivilegeMcpOAuthConfig />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText(/platform blocker/i)).toBeInTheDocument();
  });

  it('loads the saved config on mount', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.endsWith('/api/mcp-oauth-config')) {
        return jsonResponse({ ...EMPTY_CONFIG, clientId: 'saved-client', hasClientSecret: true });
      }
      return jsonResponse({});
    });

    render(<PrivilegeMcpOAuthConfig />);

    expect(await screen.findByDisplayValue('saved-client')).toBeInTheDocument();
  });

  it('Save PUTs the form values and the response never puts the secret back on screen', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts && opts.method === 'PUT') {
        return jsonResponse({ ...EMPTY_CONFIG, clientId: 'client-1', hasClientSecret: true });
      }
      return jsonResponse(EMPTY_CONFIG);
    });

    render(<PrivilegeMcpOAuthConfig />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText(/client secret/i), { target: { value: 'super-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall[1].body).clientId).toBe('client-1');
    });

    expect(screen.queryByText('super-secret')).not.toBeInTheDocument();
  });

  it('Test Connection shows the live status even when it is a 401', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (url.endsWith('/api/mcp-oauth-config/test')) {
        return jsonResponse({ step: 'mcp', status: 401, body: { error: 'invalid_token' } });
      }
      return jsonResponse(EMPTY_CONFIG);
    });

    render(<PrivilegeMcpOAuthConfig />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/401/)).toBeInTheDocument();
    expect(screen.getByText(/invalid_token/)).toBeInTheDocument();
  });
});
