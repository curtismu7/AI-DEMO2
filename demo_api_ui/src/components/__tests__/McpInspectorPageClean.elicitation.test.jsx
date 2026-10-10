// MCP Elicitation in the Inspector tools/call flow (coverage plan row — MOCK):
// when the gateway answers a tools/call with elicitation/create while the POST is
// in flight, the page shows the prompt and answers it (accept/decline) via
// POST /api/mcp/elicit/response — the same resolve path the agent lane uses.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sourceState = { current: null };

vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => sourceState.current,
}));
vi.mock('../../context/InspectorFieldContext', () => ({
  useInspectorFields: () => ({ registerFields: vi.fn(), getMatchingFields: () => ({}) }),
  InspectorFieldProvider: ({ children }) => children,
}));

import McpInspectorPageClean from '../McpInspectorPageClean';

function makeSource(overrides = {}) {
  return {
    tools: [{ name: 'confirm_tool', description: 'needs confirmation' }],
    loadingTools: false,
    selectedTool: { name: 'confirm_tool', description: 'needs confirmation' },
    setSelectedTool: vi.fn(),
    setParamValues: vi.fn(),
    parameters: {},
    updateParameter: vi.fn(),
    schemaProps: {},
    requiredParams: new Set(),
    paramValues: {},
    busy: true,
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
    pendingElicitation: {
      elicitationId: 'elic-42',
      mode: 'form',
      message: 'Confirm the withdrawal of $500?',
      requestedSchema: null,
    },
    answerElicitation: vi.fn(),
    config: { toolKey: 'name', paramsKey: 'tool' },
    ...overrides,
  };
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <McpInspectorPageClean />
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe('elicitation card mid-call', () => {
  it('renders the elicitation prompt while the call is in flight', () => {
    sourceState.current = makeSource();
    renderPage();
    expect(screen.getByTestId('elicitation-card')).toBeTruthy();
    expect(screen.getByText('Confirm the withdrawal of $500?')).toBeTruthy();
    expect(screen.getByText(/elicitation\/create/)).toBeTruthy();
  });

  it('Confirm answers accept', () => {
    sourceState.current = makeSource();
    renderPage();
    screen.getByText('Confirm').click();
    expect(sourceState.current.answerElicitation).toHaveBeenCalledWith('accept', { confirm: true });
  });

  it('Decline answers decline', () => {
    sourceState.current = makeSource();
    renderPage();
    screen.getByText('Decline').click();
    expect(sourceState.current.answerElicitation).toHaveBeenCalledWith('decline');
  });

  it('shows only the spinner when no elicitation is pending', () => {
    sourceState.current = makeSource({ pendingElicitation: null });
    renderPage();
    expect(screen.queryByTestId('elicitation-card')).toBeNull();
  });
});
