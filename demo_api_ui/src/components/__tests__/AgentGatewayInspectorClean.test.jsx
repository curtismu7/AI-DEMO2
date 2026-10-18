import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/mcp-gateway/active') return Promise.resolve({ data: { name: 'PingOne Agent Gateway', usePingGateway: true, simulated: false, url: 'https://gw/mcp' } });
    if (url.startsWith('/api/admin/agent-gateway/decisions')) return Promise.resolve({ data: { ok: true, decisions: [REC] } });
    if (url === '/api/mcp/inspector/tools') return Promise.resolve({ data: { tools: [{ name: 'get_my_accounts' }] } });
    if (url.startsWith('/api/admin/agent-gateway/logs')) return Promise.resolve({ data: { ok: true, lines: [] } });
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
