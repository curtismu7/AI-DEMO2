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
vi.mock('../../services/controlPlaneApi', () => ({
  getAgents: vi.fn(),
}));
vi.mock('../../services/apiClient', () => ({
  default: { post: vi.fn() },
}));
vi.mock('../../components/KillSwitchConfirmModal', () => ({
  default: ({ isOpen, agentId, onConfirm }) =>
    isOpen ? (
      <button onClick={() => onConfirm(agentId, 'test reason')}>
        ConfirmRevoke
      </button>
    ) : null,
}));

import { callMcpTool } from '../../services/demoAgentService';
import { getAgents } from '../../services/controlPlaneApi';
import apiClient from '../../services/apiClient';
import { fireEvent, waitFor } from '@testing-library/react';

// RevokeSlot mounts alongside every other slot and calls getAgents() on
// mount, so every test in this file renders it — give it a safe default
// resolution here; Slot 4's own beforeEach overrides this per-test.
beforeEach(() => {
  getAgents.mockResolvedValue({ live: { id: 'demo-agent' }, demo: [] });
});

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

describe('AgentLifecyclePage — Slot 3 step-up on purchase', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
  });

  it('walks checkout -> CIBA pending -> approved -> retried checkout', async () => {
    let pollCount = 0;
    global.fetch = vi.fn((url, opts) => {
      if (url === '/api/mcp/tool') {
        const body = JSON.parse(opts.body);
        if (body.tool !== 'checkout') return Promise.reject(new Error('unexpected tool'));
        // First call: step-up required. Second call (post-approval retry): success.
        if (pollCount === 0) {
          return Promise.resolve({
            status: 428,
            ok: false,
            json: () => Promise.resolve({
              error: 'mcp_step_up_required',
              step_up_method: 'ciba',
            }),
          });
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ result: { content: [{ type: 'text', text: '{}' }] } }),
        });
      }
      if (url === '/api/auth/ciba/initiate') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ auth_req_id: 'req-1', interval: 1 }),
        });
      }
      if (url === '/api/auth/ciba/poll/req-1') {
        pollCount += 1;
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(
            pollCount < 2 ? { status: 'pending' } : { status: 'approved' },
          ),
        });
      }
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Checkout $600 headphones'));

    await waitFor(() =>
      expect(screen.getByText(/Waiting for push approval/)).toBeInTheDocument(),
    );

    await vi.advanceTimersByTimeAsync(1000); // first poll: pending
    await vi.advanceTimersByTimeAsync(1000); // second poll: approved -> retry

    await waitFor(() =>
      expect(screen.getByText('Checkout completed.')).toBeInTheDocument(),
    );
  });

  it('surfaces an error instead of hanging when checkout rejects', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down')));

    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Checkout $600 headphones'));

    await waitFor(() =>
      expect(screen.getByText('network down')).toBeInTheDocument(),
    );
    expect(screen.getByText('Checkout $600 headphones')).toBeEnabled();
  });
});

describe('AgentLifecyclePage — Slot 4 self-service revoke', () => {
  beforeEach(() => {
    getAgents.mockReset().mockResolvedValue({ live: { id: 'demo-agent' }, demo: [] });
    apiClient.post.mockReset().mockResolvedValue({ data: {} });
    callMcpTool.mockReset();
  });

  it('revokes via the kill-switch endpoint and proves the retry fails', async () => {
    callMcpTool.mockRejectedValue(new Error('token revoked'));
    render(<AgentLifecyclePage />);

    await waitFor(() => expect(screen.getByText('Revoke agent access')).toBeEnabled());
    fireEvent.click(screen.getByText('Revoke agent access'));
    fireEvent.click(screen.getByText('ConfirmRevoke'));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/admin/agent/demo-agent/kill-switch',
        { reason: 'test reason' },
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Confirmed revoked — retry failed: token revoked/)).toBeInTheDocument(),
    );
    expect(screen.getByText('View audit trail →')).toHaveAttribute(
      'href',
      '/audit?agentId=demo-agent',
    );
  });
});
