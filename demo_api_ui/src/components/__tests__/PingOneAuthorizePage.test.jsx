// demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import PingOneAuthorizePage, { EvaluatePanel, filterPolicyTree, policyNodeMatches } from '../PingOneAuthorizePage';
// (replaces the Task 1 line `import { EvaluatePanel } from '../PingOneAuthorizePage';` —
// same module, now importing both the default and the named export in one statement)

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// EvaluatePanel calls useNavigate() unconditionally (the "Open policy decision
// trace" button navigates to /policy-decision-trace) — mock it so render()
// doesn't throw "useNavigate() may be used only in the context of a <Router>".
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const ONE_POLICY = [
  {
    id: 'ps-1',
    kind: 'POLICY_SET',
    name: 'Banking Authorization',
    enabled: true,
    children: [
      {
        id: 'p-1',
        kind: 'POLICY',
        name: 'Transaction Authorization',
        enabled: true,
        children: [
          {
            id: 'r-1',
            kind: 'RULE',
            name: 'Deny threshold',
            enabled: true,
            effect: 'DENY',
            testCases: {
              trigger: { preset: 'transaction', parameters: { Amount: 50000, TransactionType: 'transfer' } },
              avoid: { preset: 'transaction', parameters: { Amount: 10, TransactionType: 'transfer' } },
            },
          },
        ],
      },
      {
        id: 'p-mcp',
        kind: 'POLICY',
        name: 'MCP Delegation',
        description: 'Gates agent tool calls when DecisionContext is McpFirstTool',
        enabled: true,
        children: [
          {
            id: 'r-mcp',
            kind: 'RULE',
            name: 'Require delegated actor',
            enabled: true,
            effect: 'DENY',
            testCases: {
              trigger: { preset: 'mcp', parameters: { ToolName: 'transfer', ActClientId: '' } },
              avoid: { preset: 'mcp', parameters: { ToolName: 'transfer', ActClientId: 'agent-1' } },
            },
          },
        ],
      },
    ],
  },
];

function basePolicies(overrides = {}) {
  return { policies: ONE_POLICY, loading: false, error: null, note: null, ...overrides };
}

function renderPanel(props = {}) {
  return render(
    <EvaluatePanel
      endpointId="ep-1"
      autoPreset="transaction"
      policiesState={basePolicies()}
      pendingTest={null}
      onClearPendingTest={() => {}}
      onEvaluated={() => {}}
      onTestRule={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // EvaluatePanel fetches MCP-console defaults once on mount regardless of preset.
  bffAxios.get.mockResolvedValue({ data: {} });
});

test('renders the policy tree in the left column with the rule count', async () => {
  renderPanel();
  expect(await screen.findByText('Deny threshold')).toBeInTheDocument();
  expect(screen.getByText('Transaction Authorization')).toBeInTheDocument();
  expect(screen.getByText(/2 rules/)).toBeInTheDocument();
});

test('policy search filters the tree by name or description and highlights matches', async () => {
  renderPanel();
  expect(await screen.findByText('Deny threshold')).toBeInTheDocument();
  const search = screen.getByRole('searchbox', { name: /Search authorization policies/i });
  fireEvent.change(search, { target: { value: 'McpFirstTool' } });
  expect(screen.getByText('MCP Delegation')).toBeInTheDocument();
  expect(screen.getByText('Require delegated actor')).toBeInTheDocument();
  expect(screen.queryByText('Deny threshold')).not.toBeInTheDocument();
  expect(screen.getByText(/Showing matches for/)).toBeInTheDocument();
  expect(document.querySelector('[data-policy-match="true"]')).toBeTruthy();
});

test('policy search with no hits shows an empty message', async () => {
  renderPanel();
  await screen.findByText('Deny threshold');
  fireEvent.change(screen.getByRole('searchbox', { name: /Search authorization policies/i }), {
    target: { value: 'zz-no-such-policy' },
  });
  expect(screen.getByText(/No policies match/)).toBeInTheDocument();
});

describe('filterPolicyTree helpers', () => {
  test('policyNodeMatches checks name and description case-insensitively', () => {
    expect(policyNodeMatches({ name: 'MCP First Tool', description: 'DecisionContext McpFirstTool' }, 'mcpfirsttool')).toBe(true);
    expect(policyNodeMatches({ name: 'Transaction', description: '' }, 'mcp')).toBe(false);
  });

  test('filterPolicyTree keeps ancestors of matches and drops unrelated branches', () => {
    const filtered = filterPolicyTree(ONE_POLICY, 'McpFirstTool');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Banking Authorization');
    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children[0].name).toBe('MCP Delegation');
  });
});

test('shows a loading message in the left column while policies load', () => {
  const { container } = renderPanel({ policiesState: basePolicies({ policies: [], loading: true }) });
  const treeBody = container.querySelector('.inspector-shell-tree-body');
  expect(within(treeBody).getByText('Loading policies…')).toBeInTheDocument();
});

test('shows an error message in the left column when policies fail to load', () => {
  renderPanel({ policiesState: basePolicies({ policies: [], loading: false, error: 'worker not configured' }) });
  expect(screen.getByText(/worker not configured/)).toBeInTheDocument();
});

test('clicking a rule\'s Trigger button calls onTestRule with that rule\'s trigger test case', async () => {
  const onTestRule = vi.fn();
  renderPanel({ onTestRule });
  await screen.findByText('Deny threshold');
  // First Trigger belongs to Deny threshold (transaction branch listed before MCP).
  fireEvent.click(screen.getAllByRole('button', { name: 'Trigger →' })[0]);
  expect(onTestRule).toHaveBeenCalledWith({
    ruleName: 'Deny threshold',
    case: 'trigger',
    preset: 'transaction',
    parameters: { Amount: 50000, TransactionType: 'transfer' },
  });
});

test('switches preset tabs in the middle column', () => {
  renderPanel();
  expect(screen.getByPlaceholderText('e.g. 5000')).toBeInTheDocument();
  fireEvent.click(screen.getByText('MCP First Tool'));
  expect(screen.getByText('Tool name')).toBeInTheDocument();
});

test('output tabs show empty-state text before any evaluation has run', () => {
  renderPanel();
  expect(screen.getByText(/Run an evaluation to see the decision/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Response' }));
  expect(screen.getByText(/Run an evaluation to see the response/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Request' }));
  expect(screen.getByText(/Run an evaluation to see the request/)).toBeInTheDocument();
});

test('clicking Evaluate posts to /api/authorize/evaluate-endpoint and shows the decision', async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide' },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledWith(
    '/api/authorize/evaluate-endpoint',
    expect.objectContaining({ endpointId: 'ep-1' }),
  ));
  expect(await screen.findByText(/PERMIT/)).toBeInTheDocument();
});

test('the Response and Request output tabs show the last call\'s trace after an evaluation', async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide', pingoneResponse: { decision: 'PERMIT' } },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await screen.findByText(/PERMIT/);

  fireEvent.click(screen.getByRole('button', { name: 'Response' }));
  expect(screen.getByText(/PERMIT/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Request' }));
  expect(screen.getByText(/ep-1|endpointId/)).toBeInTheDocument();
});

test('the "Open policy decision trace" button navigates to /policy-decision-trace with the policies and result', async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { decision: 'PERMIT', engine: 'simulated', decisionId: 'dec-1', path: '/decide' },
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /Evaluate \(live\)/ }));
  await screen.findByText(/PERMIT/);

  fireEvent.click(screen.getByRole('button', { name: 'Open policy decision trace' }));
  expect(mockNavigate).toHaveBeenCalledWith(
    '/policy-decision-trace',
    expect.objectContaining({ state: expect.objectContaining({ policies: ONE_POLICY }) }),
  );
});

const LIVE_POLICY_RESPONSE = {
  endpoints: [{ id: 'ep-1', name: 'Transaction Auth', recordRecentRequests: false }],
  transactionEndpointId: 'ep-1',
  mcpEndpointId: null,
  workerConfigured: true,
  environmentId: 'env-123',
  region: 'com',
  activeEngine: 'simulated',
};

function mockPageEndpoints() {
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/authorize/pingone-policies') {
      return Promise.resolve({ data: { policies: ONE_POLICY, note: null } });
    }
    if (url === '/api/authorize/pingone-live-policy') {
      return Promise.resolve({ data: LIVE_POLICY_RESPONSE });
    }
    if (url.startsWith('/api/authorize/recent-decisions')) {
      return Promise.resolve({ data: { decisions: [] } });
    }
    if (url === '/api/authorize/mcp-console-defaults') {
      return Promise.resolve({ data: {} });
    }
    return Promise.resolve({ data: {} });
  });
}

describe('PingOneAuthorizePage (full page wiring)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPageEndpoints();
  });

  test('renders exactly one "Authorization Policies" tree region, not a separate card plus a shell copy', async () => {
    render(<PingOneAuthorizePage />);
    const matches = await screen.findAllByText('Authorization Policies');
    expect(matches).toHaveLength(1);
  });

  test('clicking Trigger on a rule (now inside the shell) round-trips through the parent\'s pendingTest state into the middle form', async () => {
    render(<PingOneAuthorizePage />);
    await screen.findByText('Deny threshold');
    fireEvent.click(screen.getAllByRole('button', { name: 'Trigger →' })[0]);
    // pendingTest's preset is 'transaction' and its Amount is 50000 (ONE_POLICY's trigger case) —
    // confirms the parent's handleTestRule -> pendingTest -> EvaluatePanel's pendingTest-effect
    // chain still runs end-to-end through the new prop wiring.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. 5000')).toHaveValue(50000);
    });
  });
});
