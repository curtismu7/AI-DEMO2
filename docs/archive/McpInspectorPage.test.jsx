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

test('an explicit ?source=banking param selects the AI Demo MCP source', () => {
  renderPage('/pingone-mcp-inspector?source=banking');
  expect(screen.getByRole('button', { name: 'AI Demo MCP' })).toHaveClass('src-pill--active');
  expect(screen.getByRole('button', { name: 'PingOne MCP' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'API Calls' })).toBeInTheDocument();
});

test('selecting an AI Demo MCP tool populates the middle form, calling Execute posts to /api/mcp/inspector/invoke without a profile field', async () => {
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

test('does not render a profile picker or "+ Add server" control (dropped for the AI Demo MCP source)', async () => {
  renderPage('/pingone-mcp-inspector?source=banking');
  await screen.findByText('get_account_balance');
  expect(screen.queryByText('+ Add server')).toBeNull();
  expect(screen.queryByTitle('MCP server to inspect')).toBeNull();
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
            { id: 'default', label: 'AIDemo MCP', isDefault: true },
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
  expect(screen.getByRole('option', { name: 'AIDemo MCP (default)' })).toBeInTheDocument();
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
        data: { profiles: [{ id: 'default', label: 'AIDemo MCP', isDefault: true }], defaultProfileId: 'default' },
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

test('the Form tab renders the Banking MCP response as labeled fields', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { currency: 'USD', available: 4820.15 } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText(/4820.15/);
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Currency')).toBeInTheDocument();
  expect(screen.getByText('USD')).toBeInTheDocument();
  expect(screen.getByText('Available')).toBeInTheDocument();
});

test('the Form tab renders the PingOne MCP response as labeled fields', async () => {
  mockPingOneEndpoints();
  apiClient.post.mockResolvedValueOnce({
    data: { response: { handle: 'jdoe', enabled: true }, request: {}, timingsMs: { roundTrip: 12 } },
  });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'PingOne MCP' }));
  fireEvent.click(await screen.findByText('users.read'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'user-1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Handle')).toBeInTheDocument();
  expect(screen.getByText('jdoe')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument();
});

test('the Form tab renders a captured API call response body as labeled fields', async () => {
  const formCall = {
    id: 'c2', method: 'GET', url: '/api/accounts/acc_2', success: true,
    response: { status: 200, body: { notes: 'checking account', pending: false } },
    request: { headers: {} }, durationMs: 21,
  };
  global.fetch = vi.fn((url, opts) => {
    if (opts?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ calls: [formCall], stats: { total: 1, success: 1, errors: 0 } }) });
  });
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: 'API Calls' }));
  fireEvent.click(await screen.findByText('/api/accounts/acc_2'));
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Notes')).toBeInTheDocument();
  expect(screen.getByText('checking account')).toBeInTheDocument();
  expect(screen.getByText('Pending')).toBeInTheDocument();
});

test('an explicit ?source=protocol param selects the Protocol source and lists its capability methods', async () => {
  renderPage('/pingone-mcp-inspector?source=protocol');
  expect(screen.getByRole('button', { name: 'Protocol' })).toHaveClass('src-pill--active');
  // Other sources' hooks still mount alongside Protocol (existing pattern — every
  // source's hook mounts unconditionally) and fire their own background fetches;
  // await one so those settle inside this test's lifecycle instead of leaking a
  // pending state update into the next test.
  expect(await screen.findByText('resources/list')).toBeInTheDocument();
  expect(screen.getByText('resources/read')).toBeInTheDocument();
  expect(screen.getByText('prompts/list')).toBeInTheDocument();
  expect(screen.getByText('prompts/get')).toBeInTheDocument();
  expect(screen.getByText('completion/complete')).toBeInTheDocument();
  expect(screen.getByText('logging/setLevel')).toBeInTheDocument();
  expect(screen.getByText('server/discover')).toBeInTheDocument();
});

test('Protocol source: selecting server/discover needs no params and posts an empty params object', async () => {
  apiClient.post.mockResolvedValueOnce({
    data: { result: { resultType: 'success', supportedVersions: ['2025-11-25', '2026-07-28'], capabilities: {} }, frames: {} },
  });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(await screen.findByText('server/discover'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'server/discover', params: {} },
  ));
});

test('Protocol source: a "Modern (2026-07-28)" toggle attaches params._meta to the Execute POST body', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: { resources: [] }, frames: {} } });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(await screen.findByText('resources/list'));
  fireEvent.click(screen.getByLabelText(/Modern \(2026-07-28\)/));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'resources/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
  ));
});

test('Protocol source: the Modern toggle is off by default — resources/list still posts an unmodified params object', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: { resources: [] }, frames: {} } });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(await screen.findByText('resources/list'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'resources/list', params: {} },
  ));
});

test('Protocol source: shows an honest note that header-based routing is an HTTP-transport-only requirement not exercised by this WS-based tester', async () => {
  renderPage('/pingone-mcp-inspector?source=protocol');
  expect(await screen.findByText(/header-based routing/i)).toBeInTheDocument();
  expect(screen.getByText(/gateway-header-routing\.test\.ts/)).toBeInTheDocument();
});

test('Protocol source: selecting resources/read shows a uri field; Execute posts to /api/mcp/inspector/rpc', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: { contents: [] }, frames: {} } });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(screen.getByText('resources/read'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'banking://accounts' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'resources/read', params: { uri: 'banking://accounts' } },
  ));
});

test('Protocol source: selecting logging/setLevel shows a level dropdown; Execute posts the chosen level', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: {}, frames: {} } });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(screen.getByText('logging/setLevel'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'warning' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'logging/setLevel', params: { level: 'warning' } },
  ));
});

test('Protocol source: resources/list needs no params and posts an empty params object', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: { resources: [] }, frames: {} } });
  renderPage('/pingone-mcp-inspector?source=protocol');
  fireEvent.click(screen.getByText('resources/list'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/rpc',
    { method: 'resources/list', params: {} },
  ));
});

test('Protocol source: shows a read-only Sampling/Roots note with no Execute control for them', async () => {
  renderPage('/pingone-mcp-inspector?source=protocol');
  // See the ?source=protocol test above for why this awaits (other sources'
  // background fetches settling inside this test's lifecycle).
  expect(await screen.findByText('Sampling & Roots')).toBeInTheDocument();
  expect(screen.getByText(/server-initiated/)).toBeInTheDocument();
  expect(screen.getByText(/mcpWebSocketClient\.samplingRoots\.test\.js/)).toBeInTheDocument();
});

test('AI Demo MCP: an "Attach progress token" toggle includes meta.progressToken in the Execute POST body', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: {} } });
  renderPage('/pingone-mcp-inspector?source=banking');
  // getByRole('button', ...), not getByText: the left tree's History footer
  // (a module-level store shared across tests in this file) also renders past
  // "get_account_balance" invocations as plain text by this point in the suite.
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getByLabelText(/Attach progress token/));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    { tool: 'get_account_balance', params: { account_id: 'acc_1' }, meta: { progressToken: expect.any(String) } },
  ));
});

test('AI Demo MCP: a "Modern (2026-07-28)" toggle includes meta[\'io.modelcontextprotocol/protocolVersion\'] in the Execute POST body', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: {} } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getByLabelText(/Modern \(2026-07-28\)/));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    {
      tool: 'get_account_balance',
      params: { account_id: 'acc_1' },
      meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    },
  ));
});

test('AI Demo MCP: Modern toggle and progress-token toggle together merge into one meta object', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { result: {} } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getByLabelText(/Attach progress token/));
  fireEvent.click(screen.getByLabelText(/Modern \(2026-07-28\)/));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    {
      tool: 'get_account_balance',
      params: { account_id: 'acc_1' },
      meta: {
        progressToken: expect.any(String),
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      },
    },
  ));
});

test('AI Demo MCP: default (Modern toggle off) still posts without a meta field — unchanged Legacy behavior', async () => {
  apiClient.post.mockResolvedValueOnce({ data: { balance: 4820.15 } });
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp/inspector/invoke',
    { tool: 'get_account_balance', params: { account_id: 'acc_1' } },
  ));
});

test('AI Demo MCP: checking Modern shows an honest note that this tester bypasses the MCP gateway (no real MRTR elicitation demo)', async () => {
  renderPage('/pingone-mcp-inspector?source=banking');
  fireEvent.click(await screen.findByRole('button', { name: 'get_account_balance' }));
  fireEvent.click(screen.getByLabelText(/Modern \(2026-07-28\)/));
  expect(screen.getByText(/bypasses/i)).toBeInTheDocument();
  expect(screen.getByText(/-32022/)).toBeInTheDocument();
});

test('the Form tab renders the Custom Server response as labeled fields', async () => {
  mockCustomServerEndpoints();
  apiClient.post.mockResolvedValueOnce({ data: { query: 'weather today', results: 3 } });
  renderPage('/pingone-mcp-inspector?source=custom');
  fireEvent.click(await screen.findByText('brave_web_search'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'weather today' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Query')).toBeInTheDocument();
  expect(screen.getByText('weather today')).toBeInTheDocument();
  expect(screen.getByText('Results')).toBeInTheDocument();
});
