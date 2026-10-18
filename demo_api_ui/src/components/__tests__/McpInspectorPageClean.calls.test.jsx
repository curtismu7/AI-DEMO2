// The rebuilt MCP Inspector: calls list from the call store, tool info line.
import React from 'react';
import { render, screen } from '@testing-library/react';
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

const tool = { name: 'get_my_accounts', description: 'List accounts', requiredScopes: ['accounts:read'], inputSchema: { type: 'object', properties: {} } };

function makeSource() {
  return {
    tools: [tool], loadingTools: false, selectedTool: tool, setSelectedTool: vi.fn(), setParamValues: vi.fn(),
    schemaProps: {}, requiredParams: new Set(), paramValues: {}, busy: false, handleExecute: vi.fn(),
    mcpHistory: getCalls(), mode: 'tools', banner: null, servers: [], profiles: [], selectedProfileId: '',
    setSelectedProfileId: vi.fn(), loadTools: vi.fn(), lastInvoke: null, toolsSource: 'mcp_server',
    pendingElicitation: null, answerElicitation: vi.fn(),
    config: { toolKey: 'name', paramsKey: 'tool' },
  };
}

beforeEach(() => {
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
});
