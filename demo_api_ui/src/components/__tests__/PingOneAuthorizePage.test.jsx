// demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import PingOneAuthorizePage from '../PingOneAuthorizePage';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

let mockSearch = '';
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(mockSearch), vi.fn()],
  Link: ({ to, children }) => <a href={to}>{children}</a>,
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  bffAxios.get.mockResolvedValue({ data: {} });
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
    vi.clearAllMocks();
    mockSearch = '';
    mockPageEndpoints();
  });

  test('console tab renders the Authorize Inspector with preset buttons', async () => {
    render(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Authorize Inspector' });
    expect(screen.getByRole('button', { name: 'Transaction' })).toBeInTheDocument();
  });

  test('non-console tab shows a back link to the inspector', async () => {
    mockSearch = 'tab=bulk';
    render(<PingOneAuthorizePage />);
    expect(await screen.findByText('← Back to Authorize Inspector')).toBeInTheDocument();
  });
});
