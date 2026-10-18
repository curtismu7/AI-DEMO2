// demo_api_ui/src/components/__tests__/PingOneAuthorizePage.test.jsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import bffAxios from '../../services/bffAxios';
import PingOneAuthorizePage from '../PingOneAuthorizePage';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockReplay = vi.fn(() => null);
vi.mock('../../services/inspectorReplay', () => ({ consumeReplay: (...a) => mockReplay(...a) }));
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
vi.mock('../BulkDecisionPanel', () => ({ __esModule: true, default: () => <div>bulk panel</div> }));

let mockSearch = '';
const mockSetSearch = vi.fn((fn) => { mockSearch = fn(new URLSearchParams(mockSearch)).toString(); });
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(mockSearch), mockSetSearch],
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

  test('mode chip is Live when loaded (even when the engine is simulated) and Unavailable when the live-policy fetch fails', async () => {
    const { unmount } = render(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Authorize Inspector' });
    expect(screen.getByText('Live', { selector: '.insp-chip' })).toBeInTheDocument();
    unmount();
    bffAxios.get.mockImplementation((url) => (url === '/api/authorize/pingone-live-policy'
      ? Promise.reject(new Error('boom'))
      : Promise.resolve({ data: { policies: [], decisions: [] } })));
    render(<PingOneAuthorizePage />);
    expect(await screen.findByText('Unavailable', { selector: '.insp-chip' })).toBeInTheDocument();
  });

  test('calls survive a round trip to a More tools tab', async () => {
    bffAxios.post.mockResolvedValue({ data: { decision: 'PERMIT', decisionId: 'd1', pingoneResponse: { decision: 'PERMIT', statements: [] }, pingoneRequest: { body: {} } } });
    const { rerender } = render(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Authorize Inspector' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('heading', { name: /transfer \$5,000/ });

    mockSearch = 'tab=bulk';
    rerender(<PingOneAuthorizePage />);
    fireEvent.click(await screen.findByText('← Back to Authorize Inspector'));
    rerender(<PingOneAuthorizePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /transfer \$5,000/ })).toBeInTheDocument());
  });

  test('a replay fires once, not again after a More tools round trip', async () => {
    bffAxios.post.mockResolvedValue({ data: { decision: 'PERMIT', decisionId: 'd1', pingoneResponse: { decision: 'PERMIT', statements: [] }, pingoneRequest: { body: {} } } });
    mockReplay.mockReturnValueOnce({ target: 'p1az', parameters: { A: 'b' } });
    const { rerender } = render(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Custom decision' });
    expect(bffAxios.post).toHaveBeenCalledTimes(1);

    mockSearch = 'tab=bulk';
    rerender(<PingOneAuthorizePage />);
    fireEvent.click(await screen.findByText('← Back to Authorize Inspector'));
    rerender(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Custom decision' });
    await new Promise((r) => setTimeout(r, 30));
    expect(bffAxios.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: /Calls\s*1/ })).toBeInTheDocument();
  });
});
