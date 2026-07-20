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
  expect(screen.getByText('Demo Presets')).not.toBeVisible();
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
  fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
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
