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
  useLocation: () => ({ pathname: '/pingone-authorize' }),
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

  test('opens in Mock; Real P1AZ shows Real P1AZ when loaded and Unavailable when the live-policy fetch fails, while Mock keeps working', async () => {
    const { unmount } = render(<PingOneAuthorizePage />);
    await screen.findByRole('heading', { name: 'Authorize Inspector' });
    expect(screen.getByText('Mock', { selector: '.insp-chip' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    expect(screen.getByText('Real P1AZ', { selector: '.insp-chip' })).toBeInTheDocument();
    unmount();
    bffAxios.get.mockImplementation((url) => (url === '/api/authorize/pingone-live-policy'
      ? Promise.reject(new Error('boom'))
      : Promise.resolve({ data: { policies: [], decisions: [] } })));
    render(<PingOneAuthorizePage />);
    expect(await screen.findByText('Mock', { selector: '.insp-chip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
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

  describe('Ping UI Standard', () => {
    test('the mode banner is the first element, a note, and follows the engine (Mock, then Real P1AZ, then Mock)', async () => {
      const { container } = render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      const page = container.firstElementChild;
      expect(page).toHaveClass('pu-page', 'p1az-page');
      expect(page.firstElementChild).toHaveClass('pu-banner-wrap');
      const banner = screen.getByTestId('p1az-banner');
      expect(banner).toHaveAttribute('role', 'note');
      expect(banner).toHaveTextContent('Mock');
      expect(banner).toHaveTextContent(/PingOne Authorize is not called/);
      fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
      expect(banner).toHaveTextContent('Real P1AZ');
      expect(banner).toHaveTextContent(/verdict is PingOne's/);
      expect(banner).not.toHaveTextContent(/is not called/);
      fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
      expect(banner).toHaveTextContent(/PingOne Authorize is not called/);
    });

    test('the banner chip always carries a word', async () => {
      const { container } = render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      const chips = container.querySelectorAll('.pu-banner .pu-chip');
      expect(chips.length).toBe(1);
      for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
    });

    test('Real P1AZ with the configuration unreadable says so in the banner', async () => {
      bffAxios.get.mockImplementation((url) => (url === '/api/authorize/pingone-live-policy'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: { policies: [], decisions: [] } })));
      render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
      expect(screen.getByTestId('p1az-banner')).toHaveTextContent('Real P1AZ unavailable');
    });

    test('Real P1AZ with no endpoint configured says so in the banner and the button, never a silent Send', async () => {
      bffAxios.get.mockImplementation((url) => {
        if (url === '/api/authorize/pingone-live-policy') {
          return Promise.resolve({ data: { endpoints: [], workerConfigured: false, note: 'worker credentials not configured' } });
        }
        return Promise.resolve({ data: { policies: [], decisions: [] } });
      });
      render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
      const banner = screen.getByTestId('p1az-banner');
      expect(banner).toHaveTextContent('No endpoint configured');
      expect(banner).toHaveTextContent(/Send is unavailable in Real P1AZ/);
      expect(banner).not.toHaveTextContent(/Each Send goes to the PingOne Authorize decision endpoint you pick/);
      const send = screen.getByRole('button', { name: 'Send' });
      expect(send).toHaveAttribute('aria-disabled', 'true');
      expect(send).not.toBeDisabled();
      const reason = document.getElementById(send.getAttribute('aria-describedby'));
      expect(reason).toHaveTextContent(/no PingOne Authorize decision endpoint is configured/);
      fireEvent.click(send);
      expect(bffAxios.post).not.toHaveBeenCalled();
      expect(screen.getByTestId('p1az-status')).toHaveTextContent(/Send is unavailable in Real P1AZ/);
      fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
      expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('aria-disabled');
      expect(screen.getByTestId('p1az-banner')).not.toHaveTextContent('No endpoint configured');
    });

    test('Real P1AZ with the configuration unreadable says Send is unavailable, not that a Send will fail', async () => {
      bffAxios.get.mockImplementation((url) => (url === '/api/authorize/pingone-live-policy'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: { policies: [], decisions: [] } })));
      render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
      const banner = screen.getByTestId('p1az-banner');
      expect(banner).toHaveTextContent(/Send is unavailable in Real P1AZ/);
      expect(banner).toHaveTextContent(/nothing is sent to PingOne/);
      expect(banner).not.toHaveTextContent(/will fail/);
      const send = screen.getByRole('button', { name: 'Send' });
      expect(document.getElementById(send.getAttribute('aria-describedby'))).toHaveTextContent(/could not be read/);
    });

    test('signed out: a Signed out banner and no inspector', async () => {
      bffAxios.get.mockImplementation(() => Promise.reject({ response: { status: 401 }, message: 'no' }));
      render(<PingOneAuthorizePage />);
      expect(await screen.findByText('The PingOne Authorize Inspector needs a signed-in session.')).toBeInTheDocument();
      expect(screen.getByTestId('p1az-banner')).toHaveTextContent('Signed out');
      expect(screen.queryByRole('heading', { name: 'Authorize Inspector' })).toBeNull();
    });

    test('Send is the one primary on the console view', async () => {
      const { container } = render(<PingOneAuthorizePage />);
      await screen.findByRole('heading', { name: 'Authorize Inspector' });
      const primaries = container.querySelectorAll('.pu-btn--primary');
      expect(primaries.length).toBe(1);
      expect(primaries[0]).toHaveTextContent('Send');
    });

    test.each([
      ['bulk', 'Real'],
      ['guided', 'Engine-dependent'],
      ['mockRules', 'Mock'],
      ['snapshot', 'Mock'],
      ['scopes', 'Reference'],
    ])('the %s tab has its own banner word (%s) and a secondary Back button, no primary of the page\'s own', async (tab, word) => {
      mockSearch = `tab=${tab}`;
      const { container } = render(<PingOneAuthorizePage />);
      const back = await screen.findByRole('button', { name: '← Back to Authorize Inspector' });
      expect(back).toHaveClass('pu-btn');
      expect(back).not.toHaveClass('pu-btn--primary');
      expect(container.querySelectorAll('.pu-btn--primary').length).toBe(0);
      expect(screen.getByTestId('p1az-banner')).toHaveTextContent(word);
      expect(container.firstElementChild.firstElementChild).toHaveClass('pu-banner-wrap');
    });

    test('Scope Audit | Scope Reference are real buttons with a pressed state', async () => {
      mockSearch = 'tab=scopes';
      render(<PingOneAuthorizePage />);
      const audit = await screen.findByRole('button', { name: 'Scope Audit' });
      const ref = screen.getByRole('button', { name: 'Scope Reference' });
      expect(audit).toHaveAttribute('aria-pressed', 'true');
      expect(ref).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(ref);
      expect(ref).toHaveAttribute('aria-pressed', 'true');
      expect(audit).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
