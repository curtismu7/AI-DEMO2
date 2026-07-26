/**
 * McpInspector — generic three-column MCP inspector (AI Demo MCP server).
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../../services/apiClient';
import McpInspector from '../McpInspector';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/formatAxiosError', () => ({
  formatAxiosError: (_e, msg) => msg,
}));
vi.mock('../../utils/authUi', () => ({
  navigateToCustomerOAuthLogin: vi.fn(),
}));
vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock('../../services/mcpCallStore', () => ({
  getCalls: () => [],
  subscribe: () => () => {},
  appendMcpCall: vi.fn(),
}));
vi.mock('../PageNav', () => ({ default: () => null }));

const BALANCE_TOOL = {
  name: 'get_account_balance',
  description: 'Get current balance.',
  inputSchema: {
    type: 'object',
    properties: { account_id: { type: 'string' } },
    required: ['account_id'],
  },
  requiredScopes: ['accounts:read'],
};
const TRANSFER_TOOL = {
  name: 'create_transfer',
  description: 'Transfer money.',
  inputSchema: {
    type: 'object',
    properties: {
      from_account_id: { type: 'string' },
      to_account_id: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['from_account_id', 'to_account_id', 'amount'],
  },
  requiredScopes: ['transactions:write'],
};
const SENSITIVE_TOOL = {
  name: 'get_sensitive_account_details',
  description: 'Retrieve sensitive details.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  requiredScopes: ['sensitive:read'],
};

function mockProfiles(profiles = []) {
  if (profiles.length === 0) {
    apiClient.get.mockImplementation(() => Promise.resolve({ data: {} }));
    return;
  }
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/profiles') {
      return Promise.resolve({
        data: { profiles, defaultProfileId: profiles[0].id },
      });
    }
    if (url.startsWith('/api/mcp/inspector/tools')) {
      return Promise.resolve({
        data: { tools: [BALANCE_TOOL, TRANSFER_TOOL], _source: 'mcp_server' },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

function mockTools(tools = [BALANCE_TOOL, TRANSFER_TOOL]) {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp/inspector/profiles') return Promise.resolve({ data: {} });
    if (url.startsWith('/api/mcp/inspector/tools')) {
      return Promise.resolve({ data: { tools, _source: 'mcp_server' } });
    }
    return Promise.resolve({ data: {} });
  });
}

function renderInspector() {
  return render(
    <MemoryRouter>
      <McpInspector />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('McpInspector — tool tree', () => {
  it('loads tools on mount and shows them grouped by resource', async () => {
    mockTools();
    renderInspector();
    await waitFor(() => expect(screen.getByText('get_account_balance')).toBeInTheDocument());
    expect(screen.getByText('create_transfer')).toBeInTheDocument();
    expect(screen.getByText(/Accounts/)).toBeInTheDocument();
    expect(screen.getByText(/Transactions/)).toBeInTheDocument();
  });

  it('shows "S" badge on sensitive tools', async () => {
    mockTools([SENSITIVE_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('get_sensitive_account_details'));
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('shows "W" badge on write-scoped tools', async () => {
    mockTools([TRANSFER_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('create_transfer'));
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('falls back to static local tools when the API call throws', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/mcp/inspector/profiles') return Promise.resolve({ data: {} });
      return Promise.reject(new Error('BFF unreachable'));
    });
    renderInspector();
    await waitFor(() => expect(screen.getByText('get_my_accounts')).toBeInTheDocument());
  });

  it('filters tools by search term', async () => {
    mockTools();
    renderInspector();
    await waitFor(() => screen.getByText('get_account_balance'));
    fireEvent.change(screen.getByPlaceholderText('Filter tools...'), { target: { value: 'balance' } });
    expect(screen.getByText('get_account_balance')).toBeInTheDocument();
    expect(screen.queryByText('create_transfer')).toBeNull();
  });
});

describe('McpInspector — form and invoke', () => {
  it('selecting a tool populates the param form', async () => {
    mockTools([BALANCE_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('get_account_balance'));
    fireEvent.click(screen.getByText('get_account_balance'));
    expect(screen.getByText(/account_id/)).toBeInTheDocument();
  });

  it('shows a validation error when required params are missing', async () => {
    mockTools([BALANCE_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('get_account_balance'));
    fireEvent.click(screen.getByText('get_account_balance'));
    // Two Execute buttons rendered (top + bottom of form); click the first
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    expect(screen.getByText(/Required:/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('POSTs to /api/mcp/inspector/invoke with typed params on Execute', async () => {
    mockTools([BALANCE_TOOL]);
    apiClient.post.mockResolvedValue({ data: { balance: 4820.15 } });
    renderInspector();
    await waitFor(() => screen.getByText('get_account_balance'));
    fireEvent.click(screen.getByText('get_account_balance'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/mcp/inspector/invoke', {
        tool: 'get_account_balance',
        params: { account_id: 'acc_1' },
      }),
    );
  });

  it('displays the invoke response in the output pane', async () => {
    mockTools([BALANCE_TOOL]);
    apiClient.post.mockResolvedValue({ data: { balance: 9999 } });
    renderInspector();
    await waitFor(() => screen.getByText('get_account_balance'));
    fireEvent.click(screen.getByText('get_account_balance'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acc_1' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    await waitFor(() => expect(screen.getByText(/9999/)).toBeInTheDocument());
  });
});

describe('McpInspector — MFA step-up banner', () => {
  it('shows the step-up banner when tools endpoint returns mfa_required', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/mcp/inspector/profiles') return Promise.resolve({ data: {} });
      if (url.startsWith('/api/mcp/inspector/tools')) {
        return Promise.resolve({
          data: { tools: [], mfa_required: true, step_up_method: 'email', _source: 'mfa_gate' },
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderInspector();
    await waitFor(() =>
      expect(screen.getByText(/Step-up verification required/)).toBeInTheDocument(),
    );
  });
});

describe('McpInspector — profile picker', () => {
  it('renders the server picker and profile dropdown when profiles load', async () => {
    mockProfiles([
      { id: 'default', label: 'AIDemo MCP', isDefault: true },
      { id: 'brave', label: 'Brave Search', isDefault: false },
    ]);
    renderInspector();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Brave Search' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: 'AIDemo MCP (default)' })).toBeInTheDocument();
  });

  it('shows "+ Add server" button to register a new profile', async () => {
    mockProfiles([{ id: 'default', label: 'AIDemo MCP', isDefault: true }]);
    renderInspector();
    await waitFor(() => screen.getByRole('option', { name: 'AIDemo MCP (default)' }));
    expect(screen.getByRole('button', { name: '+ Add server' })).toBeInTheDocument();
  });
});
