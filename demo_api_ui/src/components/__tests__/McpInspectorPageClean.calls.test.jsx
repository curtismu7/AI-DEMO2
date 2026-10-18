// The rebuilt MCP Inspector: calls list from the call store, tool info line.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendMcpCall, getCalls } from '../../services/mcpCallStore';

const sourceState = { current: null };

vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => sourceState.current,
}));
const fieldState = { matches: {} };
vi.mock('../../context/InspectorFieldContext', () => ({
  useInspectorFields: () => ({ registerFields: vi.fn(), getMatchingFields: () => fieldState.matches }),
  InspectorFieldProvider: ({ children }) => children,
}));

import McpInspectorPageClean from '../McpInspectorPageClean';

const tool = {
  name: 'get_my_accounts', description: 'List accounts', requiredScopes: ['accounts:read'],
  inputSchema: { type: 'object', properties: { account_id: { type: 'string' } } },
};

function makeSource() {
  return {
    tools: [tool], loadingTools: false, selectedTool: tool, setSelectedTool: vi.fn(), setParamValues: vi.fn(),
    schemaProps: tool.inputSchema.properties, requiredParams: new Set(), paramValues: {}, busy: false, handleExecute: vi.fn(),
    mcpHistory: getCalls(), mode: 'tools', banner: null, servers: [], profiles: [], selectedProfileId: '',
    setSelectedProfileId: vi.fn(), loadTools: vi.fn(), lastInvoke: null, toolsSource: 'mcp_server',
    pendingElicitation: null, answerElicitation: vi.fn(),
    config: { toolKey: 'name', paramsKey: 'tool' },
  };
}

beforeEach(() => {
  fieldState.matches = {};
  appendMcpCall('get_my_accounts', 200, 42, { accounts: [] }, null, { src: 'agent', params: {}, question: 'what do I have?' });
  sourceState.current = makeSource();
});

describe('MCP Inspector calls', () => {
  it('lists an agent call from the store and explains it', () => {
    render(<MemoryRouter><McpInspectorPageClean /></MemoryRouter>);
    expect(screen.getAllByText('AI agent').length).toBeGreaterThan(0);
    expect(screen.getByText('The AI agent picked a tool')).toBeInTheDocument();
  });

  it('shows the selected tool\'s required scopes in the tool info', () => {
    render(<MemoryRouter><McpInspectorPageClean /></MemoryRouter>);
    expect(screen.getByText('needs accounts:read')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  const renderPage = (url = '/') => render(<MemoryRouter initialEntries={[url]}><McpInspectorPageClean /></MemoryRouter>);

  it('shows Sending… while a call is in flight', () => {
    sourceState.current = { ...makeSource(), busy: true };
    renderPage();
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  });

  it('shows Loading instead of Live while tools load', () => {
    sourceState.current = { ...makeSource(), loadingTools: true };
    renderPage();
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('Resend executes exactly the call\'s tool and params', () => {
    appendMcpCall('get_my_accounts', 200, 5, {}, null, { src: 'you', params: { account_id: 'chk-1' } });
    sourceState.current = makeSource();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(sourceState.current.handleExecute).toHaveBeenCalledWith({ tool, params: { account_id: 'chk-1' } });
  });

  it('Edit & resend fills the form without executing', () => {
    appendMcpCall('get_my_accounts', 200, 5, {}, null, { src: 'you', params: { account_id: 'chk-1' } });
    sourceState.current = makeSource();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Edit & resend/ }));
    expect(sourceState.current.setSelectedTool).toHaveBeenCalledWith(tool);
    expect(sourceState.current.setParamValues).toHaveBeenCalledWith({ account_id: 'chk-1' });
    expect(sourceState.current.handleExecute).not.toHaveBeenCalled();
  });

  it('shows a selected "Waiting for you" row while an elicitation is pending', () => {
    sourceState.current = { ...makeSource(), pendingElicitation: { elicitationId: 'e1', mode: 'form', message: 'Really?' } };
    renderPage();
    expect(screen.getAllByText('Waiting for you').length).toBeGreaterThan(0);
    const row = screen.getByRole('button', { name: /Waiting for you/ });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('elicitation-card')).toBeInTheDocument();
  });

  it('api source lists tracker calls and hides the send card', () => {
    const call = { id: 7, method: 'GET', url: '/api/accounts', timestamp: new Date().toISOString(), duration: 9, response: { status: 200, body: {} } };
    sourceState.current = { ...makeSource(), mode: 'calls', tools: [{ label: 'GET /api/accounts', _call: call }], selectedTool: null };
    renderPage('/?source=api');
    expect(screen.getAllByText('GET /api/accounts').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Send a call' })).toBeNull();
  });

  it('flags an autofilled param', () => {
    fieldState.matches = { account_id: 'chk-9' };
    sourceState.current = { ...makeSource(), paramValues: { account_id: 'chk-9' } };
    renderPage();
    expect(screen.getByText('Filled from an earlier result')).toBeInTheDocument();
  });

  it('a failed or refused invoke does not flip the chip; a tools-load failure does', () => {
    sourceState.current = { ...makeSource(), banner: { message: 'Denied by policy', loginUrl: null }, toolsBanner: null };
    const { unmount } = renderPage();
    expect(screen.getByText('Live')).toBeInTheDocument();
    unmount();
    sourceState.current = { ...makeSource(), banner: { message: 'x', loginUrl: null }, toolsBanner: { message: 'x', loginUrl: null } };
    renderPage();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('Resend and Edit are disabled for a call whose tool this source does not list', () => {
    getCalls().length = 0;
    appendMcpCall('ghost_tool', 200, 5, {}, null, { src: 'you', params: {} });
    sourceState.current = makeSource();
    renderPage();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
  });

  it('Input schema renders in a scrollable, themed JSON container', () => {
    renderPage();
    expect(document.querySelector('details pre.insp-json')).toBeTruthy();
  });
});
