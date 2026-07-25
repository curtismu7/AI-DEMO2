// demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayTester from '../AgentGatewayTester';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const ACTIVE_GATEWAY = { name: 'Demo Agent Gateway', authzBackend: 'simulated', usePingGateway: false, simulated: true, url: 'http://gateway.local' };

function mockDefaultEndpoints() {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp-gateway/rate-limit-status') return Promise.resolve({ data: { aligned: false, rateLimitLayer: 'off', bffFlag: false } });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [], _source: 'static' } });
    if (url === '/api/authorize/rules') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDefaultEndpoints();
});

test('renders the topbar title and status text once the gateway loads', async () => {
  render(<AgentGatewayTester />);
  expect(screen.getByRole('heading', { name: 'Agent Gateway Tester' })).toBeInTheDocument();
  expect(await screen.findByText('Demo Agent Gateway | Authz: simulated')).toBeInTheDocument();
});

test('toggles between Tools and Config sub-tabs in the left column', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  expect(screen.queryByText('Demo Presets')).toBeNull();
  // "Config" is only reachable once the tools list has rendered at least once.
  fireEvent.click(screen.getByText('Config'));
  expect(screen.getByText('Demo Presets')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Tools'));
  expect(screen.queryByText('Demo Presets')).toBeNull();
});

test('selecting a tool populates the middle form with its name and an argument template', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  const toolRow = await screen.findByText('get_account_balance');
  fireEvent.click(toolRow);
  expect(screen.getByText('Get balance.')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: '' }, null, 2));
});

test('shows the empty-state message before any tool is selected or executed', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  expect(screen.getByText('Select a tool from the tree to send through the Agent Gateway.')).toBeInTheDocument();
  expect(screen.getByText('Select a tool, then execute it to see results.')).toBeInTheDocument();
});

test('clicking Execute posts to /api/mcp-gateway/test with the tool name and parsed args, shows the result', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { ok: true, result: { accounts: [] }, durationMs: 42 } });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
    '/api/mcp-gateway/test',
    { tool: 'get_my_accounts', args: {} },
  ));
  expect(await screen.findByText('200 OK')).toBeInTheDocument();
});

test('clicking Refresh in the topbar actions re-fetches gateway state', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  const callsBefore = apiClient.get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(apiClient.get.mock.calls.length).toBeGreaterThan(callsBefore));
  expect(apiClient.get).toHaveBeenCalledWith('/api/mcp-gateway/active');
});

test('the Form tab renders the gateway test result as labeled fields', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({ data: { ok: true, result: { currency: 'USD', count: 2 }, durationMs: 42 } });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');
  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByText('Currency')).toBeInTheDocument();
  expect(screen.getByText('USD')).toBeInTheDocument();
  expect(screen.getByText('Count')).toBeInTheDocument();
});

test('running get_my_accounts captures the account id and autofills it into get_account_balance', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: { ok: true, result: { success: true, accounts: [{ id: 'acct-123', accountType: 'checking', accountNumber: '****9876' }] }, durationMs: 10 },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-123' }, null, 2));
});

test('the captured-values dropdown patches a different account id into the arguments JSON', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: {
      ok: true,
      result: {
        success: true,
        accounts: [
          { id: 'acct-checking', accountType: 'checking', accountNumber: '****1111' },
          { id: 'acct-savings', accountType: 'savings', accountNumber: '****2222' },
        ],
      },
      durationMs: 10,
    },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-checking' }, null, 2));

  fireEvent.change(screen.getByLabelText('Insert captured value'), { target: { value: 'acct-savings' } });
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-savings' }, null, 2));
});

test('Run chain executes the three tools in order, carrying the account id forward', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
          { name: 'get_sensitive_account_details', description: 'Sensitive details.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: [] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accounts: [{ id: 'acct-1', accountType: 'checking' }] }, durationMs: 5 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accountId: 'acct-1', balance: 500 }, durationMs: 6 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accounts: [{ id: 'acct-1', routingNumber: '021000021' }] }, durationMs: 7 } });

  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  fireEvent.click(screen.getByText('Config'));
  fireEvent.click(screen.getByText(/Run chain/));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
  expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} });
  expect(apiClient.post).toHaveBeenNthCalledWith(2, '/api/mcp-gateway/test', { tool: 'get_account_balance', args: { account_id: 'acct-1' } });
  expect(apiClient.post).toHaveBeenNthCalledWith(3, '/api/mcp-gateway/test', { tool: 'get_sensitive_account_details', args: { account_id: 'acct-1' } });
});

test('order badges mark the chained tools 1, 2, 3 in the tool tree', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: '', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: '', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
          { name: 'get_sensitive_account_details', description: '', inputSchema: { type: 'object', properties: {}, required: [] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  await screen.findByText('get_my_accounts');
  const row1 = screen.getByText('get_my_accounts').closest('.inspector-shell-tree-item');
  const row2 = screen.getByText('get_account_balance').closest('.inspector-shell-tree-item');
  const row3 = screen.getByText('get_sensitive_account_details').closest('.inspector-shell-tree-item');
  expect(row1).toHaveTextContent('1');
  expect(row2).toHaveTextContent('2');
  expect(row3).toHaveTextContent('3');
});
