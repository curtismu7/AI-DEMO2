import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AgentGatewayInspectorClean from '../AgentGatewayInspectorClean';

const inspectorState = vi.hoisted(() => ({ outputTab: 'response' }));

vi.mock('../../hooks/useAgentGatewayInspector', () => ({
  useAgentGatewayInspector: () => ({
    selectedGateway: 'demo-mcp-gateway',
    setSelectedGateway: vi.fn(),
    selectedCapabilities: {},
    toggleCapability: vi.fn(),
    availableCapabilities: [],
    selectedTool: 'get_my_accounts',
    setSelectedTool: vi.fn(),
    isChainMode: false,
    setIsChainMode: vi.fn(),
    parameters: {},
    setParameters: vi.fn(),
    updateParameter: vi.fn(),
    availablePolicies: [],
    selectedPolicy: '',
    setSelectedPolicy: vi.fn(),
    running: false,
    result: {
      response: { status: 'success', decision: 'PERMIT', message: '<img src=x onerror=alert(1)>' },
      request: { tool: 'get_my_accounts' },
    },
    error: null,
    outputTab: inspectorState.outputTab,
    setOutputTab: vi.fn(),
    invocationHistory: [],
    activeReelId: null,
    selectReelEntry: vi.fn(),
    run: vi.fn(),
  }),
}));

describe('AgentGatewayInspectorClean response view', () => {
  it('toggles the response between a labeled form and raw JSON', () => {
    const { container } = render(<AgentGatewayInspectorClean />);

    expect(screen.getAllByText('Status')).toHaveLength(2);
    expect(screen.getAllByText('success')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByText(/"status"/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    expect(screen.getByText('Decision')).toBeInTheDocument();
  });

  it('renders the request tab safely and provides a Form/JSON toggle', () => {
    inspectorState.outputTab = 'request';
    const { container } = render(<AgentGatewayInspectorClean />);

    expect(screen.getByRole('group', { name: 'Request view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(container.textContent).toMatch(/"method"/);
    expect(container.querySelector('img')).toBeNull();
    inspectorState.outputTab = 'response';
  });
});
