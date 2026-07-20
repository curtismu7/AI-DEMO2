import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentLifecyclePage from '../AgentLifecyclePage';

vi.mock('../AgentLifecyclePage.css', () => ({}), { virtual: true });
vi.mock('../../services/demoAgentService', () => ({
  callMcpTool: vi.fn(),
}));
vi.mock('../../components/TokenChainTraceRail', () => ({
  default: () => <div data-testid="trace-rail" />,
}));

import { callMcpTool } from '../../services/demoAgentService';
import { fireEvent, waitFor } from '@testing-library/react';

describe('AgentLifecyclePage', () => {
  it('renders the title and the registration video slot', () => {
    render(<AgentLifecyclePage />);
    expect(screen.getByText('Agent Lifecycle')).toBeInTheDocument();
    expect(
      screen.getByText(/1\. Register agent \+ scoped consent/),
    ).toBeInTheDocument();
    const video = screen.getByLabelText(
      'Agent registration and consent walkthrough',
    );
    expect(video).toHaveAttribute(
      'src',
      '/media/contractor-lcm-ai-agent.mp4',
    );
  });
});

describe('AgentLifecyclePage — Slot 2 scoped MCP call', () => {
  beforeEach(() => {
    callMcpTool.mockReset();
    // Suppress unhandled rejection warnings in this test suite
    vi.stubGlobal('onunhandledrejection', (event) => {
      event.preventDefault();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls list_orders as the agent and renders the result', async () => {
    callMcpTool.mockResolvedValue({
      result: {
        content: [
          { type: 'text', text: JSON.stringify({ orders: [{ id: 'o1' }] }) },
        ],
      },
      tokenEvents: [],
    });
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Call list_orders as agent'));
    await waitFor(() =>
      expect(screen.getByText(/"id": "o1"/)).toBeInTheDocument(),
    );
    expect(callMcpTool).toHaveBeenCalledWith(
      'list_orders',
      {},
      { vertical: 'retail' },
    );
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });

  it('shows an error message when the call fails', async () => {
    callMcpTool.mockRejectedValue(new Error('boom'));
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Call list_orders as agent'));
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
  });
});
