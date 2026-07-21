// demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import McpInspectorPage from '../McpInspectorPage';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

function renderPage(initialPath = '/pingone-mcp-inspector') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <McpInspectorPage />
    </MemoryRouter>,
  );
}

const BANKING_TOOL = {
  name: 'get_account_balance',
  description: 'Get current balance for a specific account by ID.',
  inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] },
  requiredScopes: ['accounts:read'],
};

function mockBankingEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({ data: { tools: [BANKING_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBankingEndpoints();
});

test('defaults to the PingOne MCP source when no ?source= param is present, and renders the topbar title', async () => {
  mockPingOneEndpoints();
  renderPage();
  expect(screen.getByRole('heading', { name: 'MCP Inspector' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'PingOne MCP' })).toHaveClass('src-pill--active');
  expect(await screen.findByText('users.read')).toBeInTheDocument();
});

test('an explicit ?source=banking param selects the Banking MCP source', () => {
  renderPage('/pingone-mcp-inspector?source=banking');
  expect(screen.getByRole('button', { name: 'Banking MCP' })).toHaveClass('src-pill--active');
  expect(screen.getByRole('button', { name: 'PingOne MCP' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'API Calls' })).toBeInTheDocument();
});

test('selecting a Banking MCP tool populates the middle form, calling Execute posts to /api/mcp/inspector/invoke without a profile field', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({ data: { tools: [BANKING_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { balance: 4820.15 } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByText('get_account_balance'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    { tool: 'get_account_balance', params: { account_id: 'acc_1' } },
  ));
  expect(await screen.findByText(/4820.15/)).toBeInTheDocument();
});

test('does not render a profile picker or "+ Add server" control (dropped for the Banking MCP source)', async () => {
  renderPage('/pingone-mcp-inspector?source=banking');
  await screen.findByText('get_account_balance');
  expect(screen.queryByText('+ Add server')).toBeNull();
  expect(screen.queryByTitle('MCP server to inspect')).toBeNull();
});

test('Banking MCP source shows a step-up banner (not a blank tool list) when /tools returns mfa_required', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/tools') {
      return Promise.resolve({ data: { tools: [], mfa_required: true, step_up_method: 'email', _source: 'mfa_gate' } });
    }
    return Promise.resolve({ data: {} });
  });
  renderPage('/pingone-mcp-inspector?source=banking');
  expect(await screen.findByText('Step-up verification required.')).toBeInTheDocument();
  expect(screen.getByText(/MFA step-up \(email\)/)).toBeInTheDocument();
});

const PINGONE_TOOL = { name: 'users.read', description: 'Fetch one PingOne user by id.', inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } };

function mockPingOneEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/pingone-tools') {
      return Promise.resolve({ data: { enabled: true, tools: [PINGONE_TOOL], paramDefaults: {} } });
    }
    return Promise.resolve({ data: {} });
  });
}

test('switching to the PingOne MCP source shows its tools and topbar status', async () => {
  mockPingOneEndpoints();
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  expect(await screen.findByText('users.read')).toBeInTheDocument();
  expect(screen.getByText(/Connected — 1 tools/)).toBeInTheDocument();
});

test('calling a PingOne MCP tool posts to /api/mcp/inspector/pingone-invoke', async () => {
  mockPingOneEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { response: { id: '5e8e' }, request: {}, timingsMs: { roundTrip: 12 } } });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  fireEvent.click(await screen.findByText('users.read'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user-1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/pingone-invoke',
    { tool: 'users.read', params: { user_id: 'user-1' } },
  ));
});

const CAPTURED_CALL = {
  id: 'c1', method: 'GET', url: '/api/accounts/acc_1', success: true,
  response: { status: 200, body: { balance: 100 } }, request: { headers: {} }, durationMs: 38,
};

function mockFetchForApiCalls() {
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ calls: [CAPTURED_CALL], stats: { total: 1, success: 1, errors: 0 } }) });
  });
}

test('switching to the API Calls source shows captured calls', async () => {
  mockFetchForApiCalls();
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  expect(await screen.findByText('/api/accounts/acc_1')).toBeInTheDocument();
});

test('selecting a captured call shows its response body in read-only fields', async () => {
  mockFetchForApiCalls();
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  fireEvent.click(await screen.findByText('/api/accounts/acc_1'));
  expect(screen.getByDisplayValue('200')).toBeInTheDocument();
  expect(screen.getByText(/balance/)).toBeInTheDocument();
});

const CUSTOM_TOOL = {
  name: 'brave_web_search',
  description: 'Search the web via Brave Search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  requiredScopes: [],
};

function mockCustomServerEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/profiles') {
      return Promise.resolve({
        data: {
          profiles: [
            { id: 'default', label: 'Banking MCP', isDefault: true },
            { id: 'brave', label: 'Brave Search', isDefault: false },
          ],
          defaultProfileId: 'default',
        },
      });
    }
    if (url.startsWith('/api/mcp/inspector/tools')) {
      return Promise.resolve({ data: { tools: [CUSTOM_TOOL], _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
}

test('the Custom Server source loads saved profiles into the picker', async () => {
  mockCustomServerEndpoints();
  renderPage('/pingone-mcp-inspector?source=custom');
  expect(await screen.findByRole('option', { name: 'Brave Search' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Banking MCP (default)' })).toBeInTheDocument();
});

test('selecting a non-default profile requeries tools with a ?profile= param', async () => {
  mockCustomServerEndpoints();
  renderPage('/pingone-mcp-inspector?source=custom');
  await screen.findByRole('option', { name: 'Brave Search' });
  fireEvent.change(screen.getByTitle('MCP server to inspect'), { target: { value: 'brave' } });
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
    expect.stringContaining('/api/mcp/inspector/tools?profile=brave'),
  ));
  expect(await screen.findByText('brave_web_search')).toBeInTheDocument();
});

test('"+ Add server" posts a new profile and selects it', async () => {
  mockCustomServerEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { profile: { id: 'new-1', label: 'New Server' } } });
  renderPage('/pingone-mcp-inspector?source=custom');
  await screen.findByRole('option', { name: 'Brave Search' });
  fireEvent.click(screen.getByRole('button', { name: '+ Add server' }));
  fireEvent.change(screen.getByPlaceholderText('Label (e.g. Brave Search)'), { target: { value: 'New Server' } });
  fireEvent.change(screen.getByPlaceholderText('Server URL'), { target: { value: 'ws://localhost:9999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/profiles',
    { label: 'New Server', transport: 'http', url: 'ws://localhost:9999' },
  ));
});

test('Custom Server source (default profile) shows a step-up banner when /tools returns mfa_required', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/profiles') {
      return Promise.resolve({
        data: { profiles: [{ id: 'default', label: 'Banking MCP', isDefault: true }], defaultProfileId: 'default' },
      });
    }
    if (url.startsWith('/api/mcp/inspector/tools')) {
      return Promise.resolve({ data: { tools: [], mfa_required: true, step_up_method: 'email', _source: 'mfa_gate' } });
    }
    return Promise.resolve({ data: {} });
  });
  renderPage('/pingone-mcp-inspector?source=custom');
  expect(await screen.findByText('Step-up verification required.')).toBeInTheDocument();
  expect(screen.getByText(/MFA step-up \(email\)/)).toBeInTheDocument();
});
