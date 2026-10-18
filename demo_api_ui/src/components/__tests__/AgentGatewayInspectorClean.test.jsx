import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, within, waitFor, cleanup, act } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import AgentGatewayInspectorClean from '../AgentGatewayInspectorClean';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const REC = {
  ts: new Date().toISOString(), tool: 'create_withdrawal', method: 'tools/call', decision: 'DENY', backend: 'p1az',
  sub: 'user-1', clientId: 'cli-1', aud: 'mcp', scope: 'a', iss: 'https://iss', email: 'a@b.test', actor: '',
  stoppedAt: 'P1AZDecision', correlationId: 'c1', reason: 'too big', statements: [{ name: 'deny-big' }], url: 'https://az',
  parameters: { x: 1 }, rawResponse: { decision: 'DENY' },
  filterChain: [
    { filter: 'McpValidationFilter', result: 'passed' },
    { filter: 'P1AZDecision', result: 'blocked', decision: 'DENY' },
  ],
  mcpAudit: null, introspectionActive: true,
};

let logLines = [];
const ACCOUNTS = { accounts: [{ id: 'ACC-9', name: 'Checking' }] };
const PERMIT = (result) => ({ data: { gateway: 'PingOne Agent Gateway', ok: true, durationMs: 10, result, tokenEvents: [], gwAuditTrail: { authorize: { decision: 'PERMIT', backend: 'p1az' }, filterChain: [] } } });
const renderPage = () => render(<MemoryRouter><AgentGatewayInspectorClean /></MemoryRouter>);
const decisionCalls = () => apiClient.get.mock.calls.filter((c) => c[0].startsWith('/api/admin/agent-gateway/decisions')).length;

beforeEach(() => {
  vi.clearAllMocks();
  logLines = [];
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: { name: 'PingOne Agent Gateway', usePingGateway: true, simulated: false, url: 'https://gw/mcp' } });
    if (url.startsWith('/api/admin/agent-gateway/decisions')) return Promise.resolve({ data: { ok: true, decisions: [REC] } });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [{ name: 'get_my_accounts' }] } });
    if (url.startsWith('/api/admin/agent-gateway/logs')) return Promise.resolve({ data: { ok: true, lines: logLines } });
    return Promise.reject(new Error('unexpected ' + url));
  });
});
afterEach(cleanup);

describe('AgentGatewayInspectorClean', () => {
  it('shows real gateway traffic with filter chain, token and hops', async () => {
    render(<MemoryRouter><AgentGatewayInspectorClean /></MemoryRouter>);

    const row = await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    expect(within(row).getByText('DENY')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: /^Attack library:/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /What happened/ }));
    expect(screen.getAllByText(/P1AZDecision/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Tokens/ }));
    expect(screen.getByText('Token as the gateway saw it')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /API calls/ }));
    expect(screen.getAllByText(/Gateway → PingOne Authorize/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not called/).length).toBeGreaterThan(0);

    const urls = [...apiClient.get.mock.calls, ...apiClient.post.mock.calls].map((c) => c[0]);
    expect(urls.some((u) => u.includes('/api/agent-gateway/invoke'))).toBe(false);
  });

  it('disables Send on invalid arguments JSON', async () => {
    render(<MemoryRouter><AgentGatewayInspectorClean /></MemoryRouter>);
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.change(screen.getByLabelText('Arguments (JSON)'), { target: { value: '{' } });
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('AgentGatewayInspectorClean behaviors', () => {
  it('polls decisions every 5 s while visible, pauses while hidden, stops on unmount', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const base = decisionCalls();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(decisionCalls()).toBe(base + 1);

      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(decisionCalls()).toBe(base + 1);
      delete document.visibilityState;

      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(decisionCalls()).toBe(base + 1);
    } finally {
      delete document.visibilityState;
      vi.useRealTimers();
    }
  });

  it('Send posts the test call and prepends a row', async () => {
    apiClient.post.mockResolvedValue(PERMIT(ACCOUNTS));
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: /get_\s?my_\s?accounts.*PERMIT/ });
    expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} });
    expect(screen.getByRole('heading', { name: /Calls/ })).toHaveTextContent('2');
  });

  it('Repeat above 1 posts the burst endpoint with count', async () => {
    apiClient.post.mockResolvedValue({ data: { results: [{ index: 0, ok: true }, { index: 1, ok: true }, { index: 2, ok: true }] } });
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test/burst', { tool: 'get_my_accounts', args: {}, count: 3 }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Calls/ })).toHaveTextContent('4'));
  });

  it('chain passes the account id parsed from step 1 to steps 2 and 3', async () => {
    apiClient.post.mockImplementation((url, body) => Promise.resolve(PERMIT(body.tool === 'get_my_accounts' ? ACCOUNTS : {})));
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'chain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
    const bodies = apiClient.post.mock.calls.map((c) => c[1]);
    expect(bodies.map((b) => b.tool)).toEqual(['get_my_accounts', 'get_account_balance', 'get_sensitive_account_details']);
    expect(bodies[1].args).toEqual({ account_id: 'ACC-9' });
    expect(bodies[2].args).toEqual({ account_id: 'ACC-9' });
  });

  it('a preset needing account_id hints to read accounts first when none is known', async () => {
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'sensitive' } });
    expect(screen.getByText('Run "Read accounts" first to fill account_id.')).toBeInTheDocument();
    expect(screen.getByLabelText('Arguments (JSON)').value).toMatch(/"account_id": ""/);
  });

  it('a preset fills account_id from an earlier Read accounts call', async () => {
    apiClient.post.mockResolvedValue(PERMIT(ACCOUNTS));
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: /get_\s?my_\s?accounts.*PERMIT/ });
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'withdrawal' } });
    expect(screen.getByLabelText('Arguments (JSON)').value).toMatch(/"account_id": "ACC-9"/);
  });

  it('the Authz toggle PATCHes ff_authorize_real and a 403 shows in the send hint', async () => {
    apiClient.patch.mockResolvedValueOnce({ data: {} });
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.click(screen.getByRole('button', { name: 'Simulated' }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/api/admin/feature-flags', { updates: { ff_authorize_real: false } }));

    apiClient.patch.mockRejectedValueOnce({ response: { status: 403, data: { message: 'Admin access required' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Real' }));
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
  });

  it('selecting a call fetches gateway logs and shows the matching line', async () => {
    logLines = [`${REC.ts} INFO create_withdrawal denied by P1AZ`, `${REC.ts} INFO unrelated_tool`];
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/admin/agent-gateway/logs', { params: { tail: 200, filter: 'create_withdrawal' } }));
    fireEvent.click(screen.getByRole('tab', { name: /What happened/ }));
    expect(await screen.findByText(/INFO create_withdrawal denied by P1AZ/)).toBeInTheDocument();
    expect(screen.queryByText(/unrelated_tool/)).toBeNull();
  });
});

describe('AgentGatewayInspectorClean mode chip and signed-out polling', () => {
  it('shows Loading until /active answers, then Live', async () => {
    let resolve;
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation((url, ...r) => (url === '/api/mcp-gateway/active'
      ? new Promise((res) => { resolve = () => res({ data: { usePingGateway: true, simulated: false, url: 'https://gw/mcp' } }); })
      : base(url, ...r)));
    renderPage();
    expect(screen.getByText('Loading', { selector: '.insp-chip' })).toBeInTheDocument();
    await act(async () => { resolve(); });
    expect(await screen.findByText('Live', { selector: '.insp-chip' })).toBeInTheDocument();
  });

  it('shows Unavailable when /active fails, and stops polling decisions on a 401', async () => {
    vi.useFakeTimers();
    try {
      const unauth = Object.assign(new Error('401'), { response: { status: 401 } });
      apiClient.get.mockImplementation((url) => Promise.reject(unauth));
      renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('Unavailable', { selector: '.insp-chip' })).toBeInTheDocument();
      const base = decisionCalls();
      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(decisionCalls()).toBe(base);
      const decisionCfg = apiClient.get.mock.calls.find((c) => c[0].startsWith('/api/admin/agent-gateway/decisions'))[1];
      expect(decisionCfg._noAuthBanner).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AgentGatewayInspectorClean recorded rows', () => {
  it('Resend is disabled and Edit enabled for a recorded decision (its parameters are not tool args)', async () => {
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeEnabled();
  });
});
