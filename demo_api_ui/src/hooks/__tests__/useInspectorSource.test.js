import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The six Inspector sources, at the seam that broke them.
 *
 * Four of the six tabs used to render "No tools available" with no explanation:
 * three pointed at BFF routes that were permanent `{ methods: [] }` stubs, and
 * PingOne returned a 200 carrying `error: true` that the page discarded. These
 * tests pin the endpoints each source reads and the fact that a refusal
 * surfaces as a banner instead of an empty list.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('../../services/apiClient', () => ({
  default: { get: (...a) => get(...a), post: (...a) => post(...a) },
}));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/formatAxiosError', () => ({ formatAxiosError: (e, f) => e?.message || f }));
vi.mock('../../services/mcpCallStore', () => ({
  getCalls: () => [],
  subscribe: () => () => {},
  appendMcpCall: vi.fn(),
}));

import { useInspectorSource } from '../useInspectorSource';

// Renders the hook and exposes what the page would read off it.
function Probe({ sourceKey }) {
  const s = useInspectorSource(sourceKey);
  return (
    <div>
      <span data-testid="count">{s.tools.length}</span>
      <span data-testid="mode">{s.mode}</span>
      <span data-testid="banner">{s.banner?.message || ''}</span>
      <span data-testid="loginUrl">{s.banner?.loginUrl || ''}</span>
      <span data-testid="first">{s.tools[0]?.[s.config.toolKey] || ''}</span>
    </div>
  );
}

const renderSource = (key) => render(<Probe sourceKey={key} />);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: {} });
});

describe('source endpoints', () => {
  it.each([
    ['banking', '/api/mcp/inspector/tools'],
    ['pingone', '/api/mcp/inspector/pingone-tools'],
    ['gateway', '/api/mcp/inspector/gateway-tools'],
    ['protocol', '/api/mcp/inspector/protocol-methods'],
    ['api', '/api/api-calls?limit=100'],
  ])('%s reads %s', async (key, endpoint) => {
    renderSource(key);
    await waitFor(() => expect(get).toHaveBeenCalledWith(endpoint));
  });

  it('custom loads profiles first, then that profile\'s tools', async () => {
    get.mockImplementation((url) => {
      if (url === '/api/mcp/inspector/profiles') {
        return Promise.resolve({ data: { profiles: [{ id: 'p1', label: 'Weather' }], defaultProfileId: 'banking' } });
      }
      return Promise.resolve({ data: { tools: [] } });
    });
    renderSource('custom');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/profiles'));
    // defaultProfileId is the banking path, so no ?profile= is appended for it.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/tools'));
  });
});

describe('reading tools out of each payload shape', () => {
  it('takes `methods` for Protocol, not just `tools`', async () => {
    get.mockResolvedValue({ data: { methods: [{ method: 'resources/list' }] } });
    renderSource('protocol');
    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('resources/list'));
  });

  it('shapes captured API calls into selectable entries, newest first', async () => {
    get.mockResolvedValue({
      data: { calls: [
        { method: 'get', url: '/api/one', response: { status: 200 }, durationMs: 5 },
        { method: 'post', url: '/api/two', response: { status: 500 }, durationMs: 9 },
      ] },
    });
    renderSource('api');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('mode')).toHaveTextContent('calls');
    expect(screen.getByTestId('first')).toHaveTextContent('POST /api/two');
  });
});

describe('a refusal becomes a banner, not an empty list', () => {
  it('surfaces PingOne\'s 200-with-error and its sign-in URL', async () => {
    // The exact shape /pingone-tools returns when the admin PKCE login is
    // outstanding. Before this, the page showed only "No tools available".
    get.mockResolvedValue({
      data: {
        enabled: true,
        error: true,
        authRequired: true,
        loginUrl: '/api/mcp/inspector/pingone-admin/login',
        reason: 'Sign in to PingOne as an admin to list the hosted PingOne MCP tools.',
        tools: [],
      },
    });
    renderSource('pingone');
    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('Sign in to PingOne'));
    expect(screen.getByTestId('loginUrl')).toHaveTextContent('/api/mcp/inspector/pingone-admin/login');
  });

  it('surfaces a feature flag that is turned off', async () => {
    get.mockResolvedValue({ data: { enabled: false, reason: 'Live querying is turned off.', tools: [] } });
    renderSource('pingone');
    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('Live querying is turned off.'));
  });

  it('surfaces a transport failure with the login URL off the error body', async () => {
    get.mockRejectedValue({
      message: 'admin session required',
      response: { data: { loginUrl: '/login' } },
    });
    renderSource('custom');
    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('admin session required'));
  });

  it('stays quiet on a healthy payload', async () => {
    get.mockResolvedValue({ data: { tools: [{ name: 'get_my_accounts' }] } });
    renderSource('banking');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(screen.getByTestId('banner')).toHaveTextContent('');
  });
});
