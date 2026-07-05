// demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import QuickFlagsPill from '../QuickFlagsPill';

const ADMIN = { role: 'admin', username: 'demo-admin' };

function flag(id, value, extra = {}) {
  return { id, name: id, category: 'x', description: '', impact: '', type: typeof value === 'string' ? 'enum' : 'boolean', defaultValue: value, value, ...extra };
}

function flagsResponse(overrides = {}) {
  const base = {
    ff_mcp_gateway_jwks: flag('ff_mcp_gateway_jwks', true),
    ff_mcp_gateway_pinggateway: flag('ff_mcp_gateway_pinggateway', true),
    introspectionProvider: flag('introspectionProvider', 'pinggateway', { options: ['pinggateway', 'p1az'] }),
    ff_skip_token_exchange: flag('ff_skip_token_exchange', false),
    ff_authorize_simulated: flag('ff_authorize_simulated', false),
    ff_id_token_exchange: flag('ff_id_token_exchange', false),
    ff_token_auth_private_key_jwt: flag('ff_token_auth_private_key_jwt', false),
    ciba_enabled: flag('ciba_enabled', false),
    ff_heuristic_enabled: flag('ff_heuristic_enabled', true),
    ff_agent_results_panel: flag('ff_agent_results_panel', true),
    ...overrides,
  };
  return { flags: Object.values(base), categories: [] };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => flagsResponse() };
    }
    return { ok: true, status: 200, json: async () => ({ updated: true, flags: flagsResponse().flags }) };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuickFlagsPill', () => {
  it('pill shows JWKS mode from the loaded flag value', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /JWKS/ })).toBeTruthy());
  });

  it('pill shows Introspect when ff_mcp_gateway_jwks is false', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => flagsResponse({ ff_mcp_gateway_jwks: flag('ff_mcp_gateway_jwks', false) }),
    }));
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Introspect/ })).toBeTruthy());
  });

  it('clicking the pill opens the dropdown with the three groups', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => expect(screen.getByText('Token & Gateway')).toBeTruthy());
    expect(screen.getByText('AuthN / AuthZ')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('flipping the validation segmented control PATCHes the boolean', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: /🔎 Introspect/ }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(patch[1].body)).toEqual({ updates: { ff_mcp_gateway_jwks: false } });
    });
  });

  it('enum segmented control PATCHes the string value', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: 'P1AZ' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH');
      expect(JSON.parse(patch[1].body)).toEqual({ updates: { introspectionProvider: 'p1az' } });
    });
  });

  it('pinned flag renders locked and fires no PATCH', async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return {
          ok: true, status: 200,
          json: async () => flagsResponse({
            ff_mcp_gateway_pinggateway: flag('ff_mcp_gateway_pinggateway', true, { pinned: true, pinnedBy: 'FF_MCP_GATEWAY_PINGGATEWAY' }),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ updated: true, flags: [] }) };
    });
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    const demoGw = screen.getByRole('button', { name: 'Demo GW' });
    expect(demoGw.disabled).toBe(true);
    expect(demoGw.title).toMatch(/FF_MCP_GATEWAY_PINGGATEWAY/);
    fireEvent.click(demoGw);
    expect(fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH')).toBeUndefined();
  });

  // Any signed-in user (customer or admin) can flip flags since the WIP-landing
  // relaxation (canEdit = !!user && !adminDenied) — the gated state is signed-OUT.
  it('signed-out user sees disabled controls and the sign-in hint', async () => {
    render(<QuickFlagsPill user={null} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    expect(screen.getByText('Sign in to change flags')).toBeTruthy();
    expect(screen.getByRole('button', { name: /🔎 Introspect/ }).disabled).toBe(true);
  });

  it('PATCH 403 flips to the non-admin state', async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => flagsResponse() };
      }
      return { ok: false, status: 403, json: async () => ({ error: 'admin required' }) };
    });
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('button', { name: /🔎 Introspect/ }));
    await waitFor(() => expect(screen.getByText('Sign in to change flags')).toBeTruthy());
    await waitFor(() => {
      const jwksBtns = screen.getAllByRole('button', { name: /🔐 JWKS/ });
      const seg = jwksBtns.find((b) => b.className.includes('qfp-seg-btn'));
      expect(seg.className).toContain('qfp-seg-btn--active');
    });
  });

  it('GET failure renders the muted pill', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Flags/ })).toBeTruthy());
  });

  it('toggle control PATCHes the negated boolean', async () => {
    render(<QuickFlagsPill user={ADMIN} />);
    await waitFor(() => screen.getByRole('button', { name: /JWKS/ }));
    fireEvent.click(screen.getByRole('button', { name: /JWKS/ }));
    await waitFor(() => screen.getByText('Token & Gateway'));
    fireEvent.click(screen.getByRole('switch', { name: 'Skip Token Exchange' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, o]) => o && o.method === 'PATCH');
      expect(JSON.parse(patch[1].body)).toEqual({ updates: { ff_skip_token_exchange: true } });
    });
  });
});
