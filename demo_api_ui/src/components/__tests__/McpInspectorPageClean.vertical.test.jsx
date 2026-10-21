// MCP Inspector tools table: every tool the server returns in one searchable table
// (no Vertical / Tool dropdowns); picking a row selects it and fills the ?vertical=
// sample args.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendMcpCall, getCalls } from '../../services/mcpCallStore';

const sourceState = { current: null };
vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => sourceState.current,
}));
vi.mock('../../context/InspectorFieldContext', () => ({
  useInspectorFields: () => ({ registerFields: vi.fn(), getMatchingFields: () => ({}) }),
  InspectorFieldProvider: ({ children }) => children,
}));

vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthLogin: vi.fn() }));
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';
import McpInspectorPageClean from '../McpInspectorPageClean';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCHEMA_TOOLS = Object.keys(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../mcp-tool-schemas.json'), 'utf8')).tools);

// The leak the ownership rule closes: with every MCP tool listed by the server, a
// non-banking vertical shows no banking-only tool and no other vertical's API-key
// tool, but does show its own and the global ones.
const BANKING_ONLY = ['show_mortgage', 'get_fee_schedule', 'search_transactions', 'get_investment_accounts', 'adjust_balance', 'freeze_account', 'delete_customer', 'reset_customer_password'];
const OTHER_MCP_TOOLS = ['show_permit', 'show_work_order', 'show_expense_report', 'show_gear_order', 'show_enrollment', 'show_investment', 'show_large_purchase', 'list_walbuy_orders'];
const GLOBALS = ['sequential_think', 'get_weather', 'brave_news_search', 'code_search', 'list_verticals', 'call_pingone_tool', 'list_pingone_tools', 'jwt_decode_full'];

const schema = (props) => ({ type: 'object', properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) });
const TOOLS = [
  { name: 'get_my_accounts', inputSchema: schema(['account_type']) },
  { name: 'create_withdrawal', inputSchema: schema(['from_account_id', 'amount']) },
  { name: 'view_records', inputSchema: schema([]) },
  { name: 'pay_bill', inputSchema: schema(['billId', 'amount']) },
  { name: 'sequential_think', inputSchema: schema(['query']) },
];

function makeSource(selectedTool = null) {
  return {
    tools: TOOLS, loadingTools: false, selectedTool, setSelectedTool: vi.fn(), setParamValues: vi.fn(),
    schemaProps: selectedTool?.inputSchema.properties ?? {}, requiredParams: new Set(), paramValues: {}, busy: false, handleExecute: vi.fn(),
    mcpHistory: getCalls(), mode: 'tools', banner: null, servers: [], profiles: [], selectedProfileId: '',
    setSelectedProfileId: vi.fn(), loadTools: vi.fn(), lastInvoke: null, toolsSource: 'mcp_server',
    pendingElicitation: null, answerElicitation: vi.fn(),
    config: { toolKey: 'name', paramsKey: 'tool' },
  };
}

const renderAt = (url) => render(<MemoryRouter initialEntries={[url]}><McpInspectorPageClean /></MemoryRouter>);
const toolNames = () => [...document.querySelectorAll('.insp-tools__pick')].map((b) => b.textContent);
const pickTool = (name) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { sourceState.current = makeSource(); });

describe('MCP Inspector tools table', () => {
  it('lists every tool the server returned in one table — no Vertical or Tool dropdown', () => {
    renderAt('/');
    expect(toolNames()).toEqual(TOOLS.map((t) => t.name));
    expect(screen.queryByLabelText('Vertical')).toBeNull();
    expect(screen.queryByLabelText('Tool')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('lists the whole server catalog, whichever vertical ?vertical= names', () => {
    sourceState.current = { ...makeSource(), tools: SCHEMA_TOOLS.map((name) => ({ name, inputSchema: schema([]) })) };
    renderAt('/?vertical=healthcare');
    expect(toolNames()).toHaveLength(SCHEMA_TOOLS.length);
    expect(toolNames()).toContain('show_health_record');
    for (const t of [...BANKING_ONLY, ...OTHER_MCP_TOOLS]) expect(toolNames(), t).toContain(t);
  });

  it('picking a row selects that tool and fills the vertical\'s sample args', () => {
    renderAt('/?vertical=healthcare');
    pickTool('pay_bill');
    expect(sourceState.current.setSelectedTool).toHaveBeenLastCalledWith(TOOLS[3]);
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({ amount: '650' });
  });

  it('defaults to banking args, and an unknown ?vertical= falls back to banking', () => {
    renderAt('/?vertical=nope');
    pickTool('create_withdrawal');
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});
  });

  it('search narrows the table by name, description or scope and says how many matched', () => {
    sourceState.current = { ...makeSource(), tools: TOOLS.map((t) => ({ ...t, description: t.name === 'pay_bill' ? 'Pay a medical bill' : '', requiredScopes: t.name === 'view_records' ? ['records:read'] : [] })) };
    renderAt('/');
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'medical' } });
    expect(toolNames()).toEqual(['pay_bill']);
    expect(screen.getByText('1 of 5')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'records:read' } });
    expect(toolNames()).toEqual(['view_records']);
    fireEvent.change(screen.getByRole('searchbox', { name: /search tools/i }), { target: { value: 'zzz' } });
    expect(screen.getByText(/No tools match/)).toBeTruthy();
  });

  it('marks the picked tool\'s row and shows its name with the parameters', () => {
    sourceState.current = makeSource(TOOLS[0]);
    renderAt('/');
    expect(screen.getByRole('button', { name: 'get_my_accounts', pressed: true })).toBeTruthy();
    expect(screen.getByLabelText(/account_type/)).toBeTruthy();
    expect(screen.queryByText(/Pick a tool above/)).toBeNull();
  });

  it('asks you to pick a tool until one is picked', () => {
    renderAt('/');
    expect(screen.getByText(/Pick a tool above/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('a column a source never fills is dropped (no scopes: no Scopes column)', () => {
    renderAt('/');
    expect(screen.queryByRole('columnheader', { name: 'Scopes' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Description' })).toBeNull();
  });

  it('Edit and Resend still load the call\'s own tool after a vertical change', async () => {
    appendMcpCall('get_my_accounts', 200, 5, {}, null, { src: 'you', params: { account_type: 'checking' } });
    sourceState.current = makeSource();
    renderAt('/?vertical=healthcare');
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(TOOLS[0]);
    expect(sourceState.current.setParamValues).toHaveBeenCalledWith({ account_type: 'checking' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(sourceState.current.handleExecute).toHaveBeenCalledWith({ tool: TOOLS[0], params: { account_type: 'checking' } }));
  });

  it('says the local fallback only serves banking when another vertical is picked', () => {
    const NOTE = 'The local fallback only serves banking tools.';
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog' };
    const { unmount } = renderAt('/?vertical=healthcare');
    expect(screen.getByRole('status')).toHaveTextContent(NOTE);
    unmount();
    const { unmount: unmountBanking } = renderAt('/');
    expect(screen.getByRole('status')).not.toHaveTextContent('only serves banking');
    unmountBanking();
    sourceState.current = makeSource();
    renderAt('/?vertical=healthcare');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a log-in button that returns to the inspector whenever the tool list is the local fallback', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog' };
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /log in again/i }));
    expect(navigateToCustomerOAuthLogin).toHaveBeenCalledWith(window.location.pathname);
    sourceState.current = makeSource();
  });

  it('tells a PingFederate session that live tools need the P1 login, with no useless log-in button', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_agent_not_authorized_by_user', toolsProvider: 'pingfederate' };
    renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('only work with the PingOne (P1) login');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    sourceState.current = makeSource();
  });

  it('says why the tool list fell back, and offers no log-in when the server is simply unreachable', () => {
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_TOKEN_INACTIVE' };
    const { unmount } = renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('Your token was rejected (TOKEN_INACTIVE).');
    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
    unmount();
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'token_resolve_failed_actor_token_invalid' };
    const { unmount: unmountActor } = renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('not your login');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    unmountActor();
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog', toolsReason: 'mcp_unreachable: ECONNREFUSED' };
    renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent('could not be reached');
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
    sourceState.current = makeSource();
  });
});
