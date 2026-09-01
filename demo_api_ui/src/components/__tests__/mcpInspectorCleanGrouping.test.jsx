import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The grouped tool tree.
 *
 * Gateway Showcase puts TWO third-party servers behind one tab, so the tree has
 * to say which server each tool came from — an ungrouped list of
 * `get_weather, brave_news_search, get_forecast` tells you nothing about which
 * door the gateway would open.
 *
 * The other five sources have no `groupBy` and must keep rendering exactly as
 * they did: a flat list with no headings. That is the regression these two
 * tests guard, in both directions.
 */

const sourceState = { current: null };

vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => sourceState.current,
}));
vi.mock('../../context/InspectorFieldContext', () => ({
  useInspectorFields: () => ({ registerFields: vi.fn(), getMatchingFields: () => ({}) }),
  InspectorFieldProvider: ({ children }) => children,
}));

import McpInspectorPageClean from '../McpInspectorPageClean';

function makeSource({ groupBy, tools }) {
  return {
    tools,
    loadingTools: false,
    selectedTool: null,
    setSelectedTool: vi.fn(),
    setParamValues: vi.fn(),
    parameters: {},
    updateParameter: vi.fn(),
    schemaProps: {},
    requiredParams: new Set(),
    paramValues: {},
    busy: false,
    invoke: vi.fn(),
    outputTab: 'response',
    setOutputTab: vi.fn(),
    outputText: '',
    outputContent: '',
    mcpHistory: [],
    statusOn: true,
    statusText: '',
    config: { toolKey: 'name', paramsKey: 'tool', ...(groupBy ? { groupBy } : {}) },
  };
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <McpInspectorPageClean />
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('grouped tool tree', () => {
  it('shows a heading per server and every tool under it', () => {
    sourceState.current = makeSource({
      groupBy: 'serverLabel',
      tools: [
        { name: 'get_weather', serverLabel: 'Weather MCP' },
        { name: 'get_forecast', serverLabel: 'Weather MCP' },
        { name: 'brave_news_search', serverLabel: 'Brave Search MCP' },
      ],
    });
    renderPage();

    expect(screen.getByText('Weather MCP')).toBeInTheDocument();
    expect(screen.getByText('Brave Search MCP')).toBeInTheDocument();
    for (const t of ['get_weather', 'get_forecast', 'brave_news_search']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it('renders a source WITHOUT groupBy as a flat list, no headings', () => {
    // The over-correction to guard: grouping must not leak into the other five
    // sources, which have no server dimension at all.
    sourceState.current = makeSource({
      groupBy: null,
      tools: [{ name: 'get_my_accounts' }, { name: 'create_transfer' }],
    });
    const { container } = renderPage();

    expect(screen.getByText('get_my_accounts')).toBeInTheDocument();
    expect(container.querySelector('.inspector-clean-group-label')).toBeNull();
  });

  it('offers Gateway Showcase as a tab', () => {
    sourceState.current = makeSource({ groupBy: null, tools: [] });
    renderPage();
    expect(screen.getByRole('button', { name: 'Gateway Showcase' })).toBeInTheDocument();
  });
});
