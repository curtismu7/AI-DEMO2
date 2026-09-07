import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
    outputValue: null,
    mcpHistory: [],
    statusOn: true,
    statusText: '',
    mode: 'tools',
    banner: null,
    servers: [],
    profiles: [],
    selectedProfileId: '',
    setSelectedProfileId: vi.fn(),
    loadTools: vi.fn(),
    lastInvoke: null,
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

/**
 * Resizable columns. The middle pane is the 1fr remainder, so the two outer
 * widths are the whole control surface. They ride as CSS vars on the grid's
 * inline style rather than on the tracks themselves, so the mobile media query
 * that collapses to one column still wins — assert the vars, not a track list.
 */
describe('column resizing', () => {
  const gridOf = (container) => container.querySelector('.inspector-clean-main');

  beforeEach(() => {
    sourceState.current = makeSource({ groupBy: null, tools: [{ name: 'get_my_accounts' }] });
    window.localStorage.clear();
  });

  it('starts at the widths the grid used before it was resizable', () => {
    const { container } = renderPage();
    const grid = gridOf(container);
    expect(grid.style.getPropertyValue('--inspector-col-left')).toBe('260px');
    expect(grid.style.getPropertyValue('--inspector-col-right')).toBe('350px');
  });

  it('gives each divider a labelled separator role', () => {
    renderPage();
    expect(screen.getByRole('separator', { name: 'Resize tool list column' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize output column' })).toBeInTheDocument();
  });

  it('drag right grows the left column', () => {
    const { container } = renderPage();
    const handle = screen.getByRole('separator', { name: 'Resize tool list column' });
    fireEvent.mouseDown(handle, { clientX: 260 });
    fireEvent.mouseMove(document, { clientX: 340 });
    fireEvent.mouseUp(document);
    expect(gridOf(container).style.getPropertyValue('--inspector-col-left')).toBe('340px');
  });

  it('drag LEFT grows the right column — it sits on the divider\'s right', () => {
    // The inverted axis. Without `invert`, dragging left would shrink the pane
    // you are dragging open, which is the bug this pins.
    const { container } = renderPage();
    const handle = screen.getByRole('separator', { name: 'Resize output column' });
    fireEvent.mouseDown(handle, { clientX: 800 });
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);
    expect(gridOf(container).style.getPropertyValue('--inspector-col-right')).toBe('450px');
  });

  it('clamps instead of letting a column swallow the page', () => {
    const { container } = renderPage();
    const handle = screen.getByRole('separator', { name: 'Resize tool list column' });
    fireEvent.mouseDown(handle, { clientX: 260 });
    fireEvent.mouseMove(document, { clientX: -5000 });
    fireEvent.mouseUp(document);
    expect(gridOf(container).style.getPropertyValue('--inspector-col-left')).toBe('180px');
  });

  it('remembers a width across a remount', () => {
    const { container, unmount } = renderPage();
    const handle = screen.getByRole('separator', { name: 'Resize tool list column' });
    fireEvent.mouseDown(handle, { clientX: 260 });
    fireEvent.mouseMove(document, { clientX: 360 });
    fireEvent.mouseUp(document);
    expect(gridOf(container).style.getPropertyValue('--inspector-col-left')).toBe('360px');
    unmount();

    const second = renderPage();
    expect(gridOf(second.container).style.getPropertyValue('--inspector-col-left')).toBe('360px');
  });
});
