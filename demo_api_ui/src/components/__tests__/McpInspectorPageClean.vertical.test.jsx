// MCP Inspector Vertical select: filters the AI Demo MCP tool list to the
// vertical's tools and fills Arguments with that vertical's sample args.
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

import McpInspectorPageClean from '../McpInspectorPageClean';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCHEMA_TOOLS = Object.keys(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../mcp-tool-schemas.json'), 'utf8')).tools);

// The leak the ownership rule closes: with every MCP tool listed by the server, a
// non-banking vertical shows no banking-only tool and no other vertical's API-key
// tool, but does show its own and the global ones.
const BANKING_ONLY = ['show_mortgage', 'get_fee_schedule', 'search_transactions', 'get_investment_accounts', 'adjust_balance', 'freeze_account', 'delete_customer', 'reset_customer_password'];
const OTHER_MCP_TOOLS = ['show_permit', 'show_work_order', 'show_expense_report', 'show_gear_order', 'show_enrollment', 'show_investment', 'show_large_purchase', 'list_anf_orders'];
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
const toolOptions = () => [...screen.getByLabelText('Tool').options].map((o) => o.textContent).slice(1);
const pickTool = (name) => fireEvent.change(screen.getByLabelText('Tool'), { target: { value: String(TOOLS.findIndex((t) => t.name === name)) } });

beforeEach(() => { sourceState.current = makeSource(); });

describe('MCP Inspector Vertical select', () => {
  it('defaults to banking: banking and unowned tools, no other vertical\'s, args unchanged', () => {
    renderAt('/');
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
    expect(toolOptions()).toEqual(['get_my_accounts', 'create_withdrawal', 'sequential_think']);
    pickTool('create_withdrawal');
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});
  });

  it('?vertical= sets the vertical: its tools, and its sample args when a tool is picked', () => {
    renderAt('/?vertical=healthcare');
    expect(screen.getByLabelText('Vertical').value).toBe('healthcare');
    expect(toolOptions()).toEqual(['view_records', 'pay_bill', 'sequential_think']);
    pickTool('pay_bill');
    expect(sourceState.current.setSelectedTool).toHaveBeenLastCalledWith(TOOLS[3]);
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({ billId: '407', amount: '650' });
  });

  it('an unknown ?vertical= falls back to banking', () => {
    renderAt('/?vertical=nope');
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
  });

  it('changing the vertical swaps the tool options', async () => {
    renderAt('/');
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'healthcare' } });
    await waitFor(() => expect(toolOptions()).toEqual(['view_records', 'pay_bill', 'sequential_think']));
  });

  it('changing the vertical drops a selected tool it does not own', async () => {
    sourceState.current = makeSource(TOOLS[0]);
    renderAt('/');
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'healthcare' } });
    await waitFor(() => expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(null));
    expect(sourceState.current.setParamValues).toHaveBeenLastCalledWith({});

  });

  it('changing the vertical re-fills the selected tool with the new vertical\'s sample args', async () => {
    sourceState.current = makeSource(TOOLS[3]);
    renderAt('/');
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'healthcare' } });
    await waitFor(() => expect(sourceState.current.setParamValues).toHaveBeenCalledWith({ billId: '407', amount: '650' }));
    expect(sourceState.current.setSelectedTool).not.toHaveBeenCalled();
  });

  it('keeps the selected tool listed when it belongs elsewhere (Edit from another vertical)', () => {
    sourceState.current = makeSource(TOOLS[0]);
    renderAt('/?vertical=healthcare');
    expect(toolOptions()).toContain('get_my_accounts');
    expect(screen.getByLabelText('Tool').value).toBe('0');
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

  it('a non-banking Tool list has no banking-only or other-vertical tools, and has its own and the globals', () => {
    sourceState.current = { ...makeSource(), tools: SCHEMA_TOOLS.map((name) => ({ name, inputSchema: schema([]) })) };
    renderAt('/?vertical=healthcare');
    const names = toolOptions();
    expect(names).toContain('show_health_record');
    for (const t of [...BANKING_ONLY, ...OTHER_MCP_TOOLS]) expect(names, t).not.toContain(t);
    // This page lists only what the server returned (jwt_* are not in the schema artifact).
    for (const t of GLOBALS.filter((g) => SCHEMA_TOOLS.includes(g))) expect(names, t).toContain(t);
  });

  it('says the local fallback only serves banking when another vertical is picked', () => {
    const NOTE = 'The local fallback only serves banking tools. Switch to Banking, or sign in for the live MCP server.';
    sourceState.current = { ...makeSource(), toolsSource: 'local_catalog' };
    const { unmount } = renderAt('/?vertical=healthcare');
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    unmount();
    renderAt('/');
    expect(screen.queryByText(NOTE)).toBeNull();
    sourceState.current = makeSource();
    renderAt('/?vertical=healthcare');
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('keeps ?vertical= when the server changes, and shows no Vertical for PingOne MCP', async () => {
    renderAt('/?vertical=healthcare');
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'pingone' } });
    await waitFor(() => expect(screen.queryByLabelText('Vertical')).toBeNull());
    expect(toolOptions()).toContain('get_my_accounts');
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'custom' } });
    await waitFor(() => expect(screen.getByLabelText('Vertical').value).toBe('healthcare'));
  });
});
