import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, within, waitFor, cleanup, act } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import AgentGatewayInspectorClean from '../AgentGatewayInspectorClean';

// The leak the ownership rule closes: with every MCP tool listed by the server, a
// non-banking vertical shows no banking-only tool and no other vertical's API-key
// tool, but does show its own and the global ones.
const BANKING_ONLY = ['show_mortgage', 'get_fee_schedule', 'search_transactions', 'get_investment_accounts', 'adjust_balance', 'freeze_account', 'delete_customer', 'reset_customer_password'];
const OTHER_MCP_TOOLS = ['show_permit', 'show_work_order', 'show_expense_report', 'show_gear_order', 'show_enrollment', 'show_investment', 'show_large_purchase', 'list_anf_orders'];
const GLOBALS = ['sequential_think', 'get_weather', 'brave_news_search', 'code_search', 'list_verticals', 'call_pingone_tool', 'list_pingone_tools', 'jwt_decode_full'];

const SCHEMA_TOOLS = Object.keys(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../mcp-tool-schemas.json'), 'utf8')).tools);

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
    expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} }, { _noAuthBanner: true });
    expect(screen.getByRole('heading', { name: /Calls/ })).toHaveTextContent('2');
  });

  it('a 401 on Send never raises the sign-in modal and shows the server message', async () => {
    const message = 'Token exchange blocked: user token [openid] lacks required scopes for tool get_my_accounts';
    apiClient.post.mockRejectedValue({ response: { status: 401, data: { error: 'token_resolution_failed', message } } });
    const { container } = renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(message, { selector: '.insp-err' });
    expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} }, { _noAuthBanner: true });
    expect(screen.getByRole('heading', { name: /Calls/ })).toHaveTextContent('2');
    // apiClient is mocked here, so the real modal cannot appear; the flag is what suppresses it.
    expect(container.querySelector('.signin-modal')).toBeNull();
  });

  it('Repeat above 1 posts the burst endpoint with count', async () => {
    apiClient.post.mockResolvedValue({ data: { results: [{ index: 0, ok: true }, { index: 1, ok: true }, { index: 2, ok: true }] } });
    renderPage();
    await screen.findByRole('button', { name: /create_\s?withdrawal/ });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test/burst', { tool: 'get_my_accounts', args: {}, count: 3 }, { _noAuthBanner: true }));
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
    expect(screen.getByLabelText('Arguments (JSON)').value).toMatch(/"from_account_id": "ACC-9"/);
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

describe('AgentGatewayInspectorClean ordering', () => {
  it('stays Unavailable when the decisions 401 lands before /active 200', async () => {
    let resolveActive;
    const unauth = Object.assign(new Error('401'), { response: { status: 401 } });
    apiClient.get.mockImplementation((url) => {
      if (url === '/api/mcp-gateway/active') return new Promise((res) => { resolveActive = () => res({ data: { usePingGateway: true, simulated: false } }); });
      if (url.startsWith('/api/admin/agent-gateway/decisions')) return Promise.reject(unauth);
      return Promise.resolve({ data: { tools: [], lines: [], ok: true } });
    });
    renderPage();
    await screen.findByText('Unavailable', { selector: '.insp-chip' });
    await act(async () => { resolveActive(); });
    expect(screen.getByText('Unavailable', { selector: '.insp-chip' })).toBeInTheDocument();
    expect(screen.queryByText('Live', { selector: '.insp-chip' })).toBeNull();
  });
});

describe('AgentGatewayInspectorClean Vertical select', () => {
  const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><AgentGatewayInspectorClean /></MemoryRouter>);
  const optionsOf = (label) => [...screen.getByLabelText(label).options].map((o) => o.value);
  const scenarioLabels = () => [...screen.getByLabelText('Scenario').options].map((o) => o.textContent);
  const ready = () => screen.findByRole('button', { name: /create_\s?withdrawal/ });

  it('defaults to banking with the original scenarios, tools and args', async () => {
    renderAt('/');
    await ready();
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
    expect(scenarioLabels()).toEqual([
      'Custom', 'Read accounts (expect PERMIT)', 'Sensitive read (expect approval)', 'Withdrawal (expect approval)',
      'Run chain: accounts → balance → sensitive', 'Attack library: Schema Violation', 'Attack library: Tool Poisoning',
    ]);
    expect(screen.getByLabelText('Tool').value).toBe('get_my_accounts');
    expect(optionsOf('Tool')).not.toContain('view_records');
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'withdrawal' } });
    expect(JSON.parse(screen.getByLabelText('Arguments (JSON)').value)).toEqual({ from_account_id: '', amount: 500 });
  });

  it('a non-banking Tool list has no banking-only or other-vertical tools, and has its own and the globals', async () => {
    const base = apiClient.get.getMockImplementation();
    apiClient.get.mockImplementation((url, ...r) => (url === '/api/mcp/inspector/tools'
      ? Promise.resolve({ data: { tools: SCHEMA_TOOLS.map((name) => ({ name })) } })
      : base(url, ...r)));
    renderAt('/?vertical=healthcare');
    await ready();
    await waitFor(() => expect(optionsOf('Tool')).toContain('show_health_record'));
    const names = optionsOf('Tool');
    for (const t of [...BANKING_ONLY, ...OTHER_MCP_TOOLS]) expect(names, t).not.toContain(t);
    for (const t of GLOBALS) expect(names, t).toContain(t);
  });

  it('?vertical= sets the initial vertical, its scenarios and its tools', async () => {
    renderAt('/?vertical=healthcare');
    await ready();
    expect(screen.getByLabelText('Vertical').value).toBe('healthcare');
    expect(scenarioLabels()).toContain('Read records (expect PERMIT)');
    expect(scenarioLabels().some((l) => l.startsWith('Attack library'))).toBe(false);
    expect(screen.getByLabelText('Tool').value).toBe('view_records');
    expect(optionsOf('Tool')).toContain('release_records');
    expect(optionsOf('Tool')).not.toContain('get_my_accounts');
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'approval' } });
    expect(screen.getByLabelText('Tool').value).toBe('pay_bill');
    expect(JSON.parse(screen.getByLabelText('Arguments (JSON)').value)).toEqual({ billId: '404', amount: 500 });
  });

  it.each(['nope', 'constructor'])('an unknown ?vertical=%s falls back to banking', async (v) => {
    renderAt(`/?vertical=${v}`);
    await ready();
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
    expect(scenarioLabels()).toContain('Read accounts (expect PERMIT)');
  });

  it('changing the vertical swaps the tools and re-fills the arguments', async () => {
    renderAt('/');
    await ready();
    fireEvent.change(screen.getByLabelText('Arguments (JSON)'), { target: { value: '{"x":1}' } });
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'government' } });
    await waitFor(() => expect(screen.getByLabelText('Tool').value).toBe('view_permits'));
    expect(screen.getByLabelText('Arguments (JSON)').value).toBe('{}');
    expect(optionsOf('Tool')).toContain('pay_fee');
    expect(optionsOf('Tool')).not.toContain('create_withdrawal');
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'approval' } });
    expect(JSON.parse(screen.getByLabelText('Arguments (JSON)').value)).toEqual({ amount: 480 });
  });

  it('a vertical chain passes the id captured from step 1 to the step that needs it', async () => {
    const RECORDS = { success: true, render: 'view_records', data: { records: [{ id: '101', recordType: 'Primary Care' }] } };
    apiClient.post.mockImplementation((url, body) => Promise.resolve(PERMIT(body.tool === 'view_records' ? RECORDS : {})));
    renderAt('/?vertical=healthcare');
    await ready();
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'chain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
    expect(apiClient.post.mock.calls.map((c) => c[1])).toEqual([
      { tool: 'view_records', args: {} },
      { tool: 'release_records', args: { recordId: '101' } },
      { tool: 'sensitive_patient_records', args: {} },
    ]);
  });

  it('Resend and Edit still use the call\'s own input after a vertical change', async () => {
    apiClient.post.mockResolvedValue(PERMIT(ACCOUNTS));
    renderAt('/');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: /get_\s?my_\s?accounts.*PERMIT/ });
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'retail' } });
    await waitFor(() => expect(screen.getByLabelText('Tool').value).toBe('list_orders'));
    apiClient.post.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test', { tool: 'get_my_accounts', args: {} }, { _noAuthBanner: true }));
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('Tool').value).toBe('get_my_accounts');
  });

  it('labels verticals with the app list names', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'banking', displayName: 'Super Banking' }, { id: 'healthcare', displayName: 'CareConnect' }]) })));
    try {
      renderAt('/');
      await ready();
      expect(await screen.findByRole('option', { name: 'CareConnect' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Super Banking' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'retail' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
