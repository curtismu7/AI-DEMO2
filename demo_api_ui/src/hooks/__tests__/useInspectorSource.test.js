import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
      <span data-testid="toolsSource">{s.toolsSource || ''}</span>
      <span data-testid="banner">{s.banner?.message || ''}</span>
      <span data-testid="toolsBanner">{s.toolsBanner?.message || ''}</span>
      <button data-testid="exec" onClick={() => s.handleExecute({ tool: { name: 'get_my_accounts' }, params: {} })}>exec</button>
      <span data-testid="loginUrl">{s.banner?.loginUrl || ''}</span>
      <span data-testid="first">{s.tools[0]?.[s.config.toolKey] || ''}</span>
      <span data-testid="toolsKey">{s.toolsKey ?? 'none'}</span>
      <span data-testid="selectedProfileId">{s.selectedProfileId}</span>
      <button data-testid="reload" onClick={() => s.loadProfiles('new-id')}>reload</button>
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

  it('exposes the tools response _source as toolsSource', async () => {
    get.mockResolvedValue({ data: { tools: [], _source: 'mcp_server' } });
    renderSource('banking');
    await waitFor(() => expect(screen.getByTestId('toolsSource')).toHaveTextContent('mcp_server'));
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

  it('loadProfiles re-fetches the profile list and can select one by id (e.g. one just added)', async () => {
    get.mockImplementation((url) => {
      if (url === '/api/mcp/inspector/profiles') {
        return Promise.resolve({
          data: { profiles: [{ id: 'p1', label: 'Weather' }, { id: 'new-id', label: 'New' }], defaultProfileId: 'banking' },
        });
      }
      return Promise.resolve({ data: { tools: [] } });
    });
    renderSource('custom');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/profiles'));
    get.mockClear();

    fireEvent.click(screen.getByTestId('reload'));

    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/profiles'));
    await waitFor(() => expect(screen.getByTestId('selectedProfileId')).toHaveTextContent('new-id'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/tools?profile=new-id'));
  });
});

describe('the Privilege/PingOne admin login round-trip lands back as ?profile= / ?..._error=', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/pingone-mcp-inspector');
  });

  it('selects the door that was just logged into on success (no error param)', async () => {
    window.history.pushState({}, '', '/pingone-mcp-inspector?source=custom&profile=built-in-privilege-grafana');
    get.mockImplementation((url) => {
      if (url === '/api/mcp/inspector/profiles') {
        return Promise.resolve({
          data: { profiles: [{ id: 'built-in-privilege-grafana', label: 'Privilege: Grafana' }], defaultProfileId: 'default-banking' },
        });
      }
      return Promise.resolve({ data: { tools: [] } });
    });

    renderSource('custom');

    await waitFor(() => expect(screen.getByTestId('selectedProfileId')).toHaveTextContent('built-in-privilege-grafana'));
    expect(window.location.search).not.toContain('profile=');
  });

  it('surfaces a failed login instead of silently looking like "sign in required" again', async () => {
    window.history.pushState({}, '', '/pingone-mcp-inspector?source=custom&profile=built-in-privilege-grafana&privilege_error=invalid_state');
    get.mockResolvedValue({ data: { profiles: [], defaultProfileId: 'default-banking' } });

    renderSource('custom');

    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('invalid_state'));
    expect(window.location.search).not.toContain('privilege_error=');
    expect(window.location.search).not.toContain('profile=');
  });

  it('does the same for a failed PingOne admin login', async () => {
    window.history.pushState({}, '', '/pingone-mcp-inspector?source=custom&pingone_admin_error=access_denied');
    get.mockResolvedValue({ data: { profiles: [], defaultProfileId: 'default-banking' } });

    renderSource('custom');

    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('access_denied'));
  });

  it('does nothing on a plain load with no redirect params', async () => {
    get.mockResolvedValue({ data: { profiles: [], defaultProfileId: 'default-banking' } });
    renderSource('custom');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/mcp/inspector/profiles'));
    expect(screen.getByTestId('banner')).toHaveTextContent('');
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

  it('keeps invoke failures out of toolsBanner (they must not flip the page to Unavailable)', async () => {
    get.mockResolvedValue({ data: { tools: [{ name: 'get_my_accounts' }] } });
    post.mockRejectedValue({ message: 'invoke exploded' });
    renderSource('banking');
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByTestId('exec'));
    await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('invoke exploded'));
    expect(screen.getByTestId('toolsBanner')).toHaveTextContent('');
  });

  it('a tools-load failure sets toolsBanner', async () => {
    get.mockRejectedValue({ message: 'tools down' });
    renderSource('banking');
    await waitFor(() => expect(screen.getByTestId('toolsBanner')).toHaveTextContent('tools down'));
  });
});

describe('hook order', () => {
  // Tab switching re-renders ONE mounted component with a new sourceKey. A
  // conditional hook anywhere in the hook fails here with React's
  // "Should have a queue" / "Rendered more hooks" error.
  it('survives switching through every source on a single mounted component', () => {
    const keys = ['banking', 'pingone', 'api', 'custom', 'gateway', 'protocol'];
    const { rerender } = render(<Probe sourceKey={keys[0]} />);
    for (const k of [...keys.slice(1), ...keys.slice().reverse()]) {
      expect(() => rerender(<Probe sourceKey={k} />)).not.toThrow();
    }
  });
});

describe('toolsKey: which source the loaded tools belong to', () => {
  it('names the source once its tools have loaded, and not before', async () => {
    get.mockResolvedValue({ data: { tools: [{ name: 'get_my_accounts' }] } });
    renderSource('banking');
    expect(screen.getByTestId('toolsKey')).toHaveTextContent('none');
    await waitFor(() => expect(screen.getByTestId('toolsKey')).toHaveTextContent('banking:'));
  });

  it('after a source switch it keeps naming the OLD source until the new tools arrive (the page must not pick from stale tools)', async () => {
    get.mockResolvedValue({ data: { tools: [{ name: 'get_my_accounts' }] } });
    const { rerender } = renderSource('banking');
    await waitFor(() => expect(screen.getByTestId('toolsKey')).toHaveTextContent('banking:'));

    let release;
    get.mockImplementation(() => new Promise((res) => { release = () => res({ data: { tools: [{ name: 'get_weather_summary' }] } }); }));
    rerender(<Probe sourceKey="gateway" />);
    // Rendered with the new source, still holding the previous source's tools and key.
    expect(screen.getByTestId('toolsKey')).toHaveTextContent('banking:');
    expect(screen.getByTestId('first')).toHaveTextContent('get_my_accounts');
    await waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    await waitFor(() => expect(screen.getByTestId('toolsKey')).toHaveTextContent('gateway:'));
    expect(screen.getByTestId('first')).toHaveTextContent('get_weather_summary');
  });

  it('is set even when the load fails, so the page can tell an empty source from a stale one', async () => {
    get.mockRejectedValue(new Error('boom'));
    renderSource('gateway');
    await waitFor(() => expect(screen.getByTestId('toolsKey')).toHaveTextContent('gateway:'));
  });
});
