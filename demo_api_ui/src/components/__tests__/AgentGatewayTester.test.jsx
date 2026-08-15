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

test('Refresh button shows a spinner and disables itself while its fetches are in flight', async () => {
  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');

  let resolveActive;
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') {
      return new Promise((resolve) => { resolveActive = resolve; });
    }
    if (url === '/api/mcp-gateway/rate-limit-status') return Promise.resolve({ data: { aligned: false, rateLimitLayer: 'off', bffFlag: false } });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [], _source: 'static' } });
    if (url === '/api/authorize/rules') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });

  const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
  fireEvent.click(refreshBtn);

  await waitFor(() => expect(refreshBtn).toBeDisabled());
  expect(refreshBtn.querySelector('[role="status"]')).toBeInTheDocument();

  resolveActive({ data: ACTIVE_GATEWAY });
  await waitFor(() => expect(refreshBtn).not.toBeDisabled());
});

test('Run chain is inert (not just re-colored) while already running', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  let resolveFirstCall;
  apiClient.post.mockImplementation(() => new Promise((resolve) => { resolveFirstCall = resolve; }));

  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  // Wait for the live tools fetch to actually land in state before switching
  // to Config — otherwise runChain's `tools.find(...)` can still see the
  // pre-fetch empty list and skip the step instead of calling apiClient.post.
  await screen.findByText('get_my_accounts');
  fireEvent.click(screen.getByText('Config'));

  fireEvent.click(screen.getByText(/Run chain \(accounts/));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
  // The busy label also appears in the right output panel's Chain-tab empty
  // state (runChain switches to it) — scope to the left tree item specifically.
  const findRunningItem = () => screen
    .queryAllByText(/Running chain/)
    .map((el) => el.closest('[role="button"]'))
    .find(Boolean);
  await waitFor(() => expect(findRunningItem()).toBeTruthy());
  const runningItem = findRunningItem();
  expect(runningItem).toHaveAttribute('aria-disabled', 'true');
  expect(runningItem).toHaveAttribute('aria-busy', 'true');
  expect(runningItem.querySelector('[role="status"]')).toBeInTheDocument();

  resolveFirstCall({ data: { ok: true, result: { success: true, accounts: [] }, durationMs: 1 } });
  await waitFor(() => expect(findRunningItem()).toBeFalsy());
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

test('Chain tab empty state points to the actual "Run chain" control, not a nonexistent button', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [], _source: 'live' } });
    return Promise.resolve({ data: {} });
  });

  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  fireEvent.click(screen.getByText('Chain'));

  // The guidance must reference the real toggle + real button label so a
  // reader can actually find them, not a "Run Chain" button that doesn't exist.
  expect(screen.getByText(/Toggle the left panel to "Config"/)).toBeInTheDocument();
  expect(screen.getByText(/Run chain \(accounts → balance → sensitive\)/)).toBeInTheDocument();
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

test('Run chain shows step 3 as error when result has ok:false (consent-required gate)', async () => {
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
    .mockResolvedValueOnce({ data: { ok: true, result: { ok: false, consent_required: true, reason: 'sensitive_data_access' }, durationMs: 7 } });

  render(<AgentGatewayTester />);
  await screen.findByText('Demo Agent Gateway | Authz: simulated');
  fireEvent.click(screen.getByText('Config'));
  fireEvent.click(screen.getByText(/Run chain/));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
  expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} });
  expect(apiClient.post).toHaveBeenNthCalledWith(2, '/api/mcp-gateway/test', { tool: 'get_account_balance', args: { account_id: 'acct-1' } });
  expect(apiClient.post).toHaveBeenNthCalledWith(3, '/api/mcp-gateway/test', { tool: 'get_sensitive_account_details', args: { account_id: 'acct-1' } });

  // The Chain tab should automatically show after run completes.
  // Verify that steps 1 and 2 show as OK, but step 3 shows as error because result.ok is false.
  await screen.findByText('1. get_my_accounts');
  expect(screen.getByText('2. get_account_balance')).toBeInTheDocument();
  expect(screen.getByText('3. get_sensitive_account_details')).toBeInTheDocument();

  // Find the step 3 row and verify it shows "error", not "OK"
  const step3Element = screen.getByText('3. get_sensitive_account_details').parentElement;
  expect(step3Element).toHaveTextContent('error');
  // Verify steps 1 and 2 show OK
  const step1Element = screen.getByText('1. get_my_accounts').parentElement;
  expect(step1Element).toHaveTextContent('OK');
  const step2Element = screen.getByText('2. get_account_balance').parentElement;
  expect(step2Element).toHaveTextContent('OK');
});

test('running get_my_transactions captures the transaction id and autofills it into a consumer tool', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_transactions', description: 'List transactions.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_transaction_detail', description: 'Get one transaction.', inputSchema: { type: 'object', properties: { transaction_id: { type: 'string' } }, required: ['transaction_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: { ok: true, result: { success: true, transactions: [{ id: 'txn-1', fromAccountId: 'acct-1', toAccountId: 'acct-2' }] }, durationMs: 8 },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_transactions'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_transaction_detail'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ transaction_id: 'txn-1' }, null, 2));
});

test('a bare "id" param derives its family from the tool name, not a more-recently captured unrelated family', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'view_permits', description: 'List permits.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'checkout', description: 'Place an order.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, amount: { type: 'number' } }, required: ['product', 'amount'] } },
          { name: 'cancel_permit', description: 'Cancel a permit.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, data: { permits: [{ id: 'permit-9', status: 'Active' }] } }, durationMs: 5 } })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, data: { id: 'ord-1', product: 'Widget', status: 'Processing' } }, durationMs: 5 } });

  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('view_permits'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('checkout'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('cancel_permit'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ id: 'permit-9' }, null, 2));
});

test('the captured-values dropdown patches the matching family\'s key, not an unrelated id param', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'lookup_customer', description: 'Find a customer.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
          {
            name: 'get_customer_accounts',
            description: 'Admin: accounts for a customer.',
            inputSchema: { type: 'object', properties: { userId: { type: 'string' }, account_id: { type: 'string' } }, required: ['userId', 'account_id'] },
          },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    .mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          success: true,
          accounts: [
            { id: 'acct-checking', accountType: 'checking', accountNumber: '****1111' },
            { id: 'acct-savings', accountType: 'savings', accountNumber: '****2222' },
          ],
        },
        durationMs: 5,
      },
    })
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, users: [{ id: 'user-1', name: 'Jane Doe' }] }, durationMs: 5 } });

  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('lookup_customer'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_customer_accounts'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ userId: 'user-1', account_id: 'acct-checking' }, null, 2));

  fireEvent.change(screen.getByLabelText('Insert captured value'), { target: { value: 'acct-savings' } });
  const parsed = JSON.parse(screen.getByRole('textbox').value);
  expect(parsed.account_id).toBe('acct-savings');
  expect(parsed.userId).toBe('user-1');
});

test('an id-shaped param with no captured match falls back to the empty placeholder', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: { tools: [{ name: 'get_customer_profile', description: 'Admin: customer profile.', inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] } }], _source: 'live' },
    });
    return Promise.resolve({ data: {} });
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_customer_profile'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ userId: '' }, null, 2));
});

// Fix 1: production responses are the raw MCP envelope — the payload is a
// JSON string nested inside content[0].text, not a top-level property of
// `result`. Every test above mocks the already-decoded payload; this one
// uses the real envelope shape to prove capture/autofill still works once
// it's unwrapped.
test('captures a value from a real MCP envelope response (content[0].text as a JSON string)', async () => {
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
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            accounts: [{ id: 'acct-envelope-1', accountType: 'checking', accountNumber: '****4444' }],
          }),
        }],
        isError: false,
      },
      durationMs: 9,
    },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-envelope-1' }, null, 2));
});

// Fix 3: a "poId" param wants family "po", but view_purchase_orders' response
// array key "purchaseOrders" singularizes to "purchaseorder" — no substring
// relationship without the FAMILY_ALIASES entry.
test('a poId param autofills from a captured purchaseOrders[] id via the family alias', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'view_purchase_orders', description: 'List purchase orders.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'void_purchase_order', description: 'Void a purchase order by poId.', inputSchema: { type: 'object', properties: { poId: { type: 'string' } }, required: ['poId'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValueOnce({
    data: { ok: true, result: { success: true, purchaseOrders: [{ id: 'PO-6001', supplier: 'MetalSupply Co.', status: 'Pending Approval' }] }, durationMs: 5 },
  });
  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('view_purchase_orders'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('void_purchase_order'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ poId: 'PO-6001' }, null, 2));
});

// Fix 4: bestCapturedMatch must prefer an exact family match over a
// substring match, even when the substring match was captured more recently.
test('an exact family match wins over a more-recently-captured substring match', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: ACTIVE_GATEWAY });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({
      data: {
        tools: [
          { name: 'get_my_accounts', description: 'List accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'list_savings_accounts', description: 'List savings accounts.', inputSchema: { type: 'object', properties: {}, required: [] } },
          { name: 'get_account_balance', description: 'Get balance.', inputSchema: { type: 'object', properties: { account_id: { type: 'string' } }, required: ['account_id'] } },
        ],
        _source: 'live',
      },
    });
    return Promise.resolve({ data: {} });
  });
  apiClient.post
    // Captured first (older): exact family "account".
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, accounts: [{ id: 'acct-old', accountType: 'checking' }] }, durationMs: 5 } })
    // Captured second (more recent): family "savingsaccount" — substring match only.
    .mockResolvedValueOnce({ data: { ok: true, result: { success: true, savingsAccounts: [{ id: 'acct-new', accountType: 'savings' }] }, durationMs: 5 } });

  render(<AgentGatewayTester />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('list_savings_accounts'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Execute' })[0]);
  await screen.findByText('200 OK');

  fireEvent.click(screen.getByText('get_account_balance'));
  expect(screen.getByRole('textbox')).toHaveValue(JSON.stringify({ account_id: 'acct-old' }, null, 2));
});
