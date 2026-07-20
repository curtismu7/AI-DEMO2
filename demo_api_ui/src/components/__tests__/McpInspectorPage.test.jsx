// demo_api_ui/src/components/__tests__/McpInspectorPage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import McpInspectorPage from '../McpInspectorPage';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

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

test('defaults to the Banking MCP source and renders its topbar title', async () => {
  render(<McpInspectorPage />);
  expect(screen.getByRole('heading', { name: 'MCP Inspector' })).toBeInTheDocument();
  expect(await screen.findByText('get_account_balance')).toBeInTheDocument();
});

test('the source switcher shows all three sources with Banking MCP active by default', () => {
  render(<McpInspectorPage />);
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
  render(<McpInspectorPage />);
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
  render(<McpInspectorPage />);
  await screen.findByText('get_account_balance');
  expect(screen.queryByText('+ Add server')).toBeNull();
  expect(screen.queryByTitle('MCP server to inspect')).toBeNull();
});
