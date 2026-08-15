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
  default: { post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('../../components/KillSwitchConfirmModal', () => ({
  default: ({ isOpen, agentId, onConfirm }) =>
    isOpen ? (
      <button onClick={() => onConfirm(agentId, 'test reason')}>
        ConfirmRevoke
      </button>
    ) : null,
}));
const mockSetSurfaceHostEl = vi.fn();
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ setSurfaceHostEl: mockSetSurfaceHostEl }),
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
  mockSetSurfaceHostEl.mockClear();
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

  it('registers the agent surface host and renders the persistent rail on load', () => {
    render(<AgentLifecyclePage />);
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
    expect(mockSetSurfaceHostEl).toHaveBeenCalled();
    // The host-registration effect fires more than once during mount — an
    // initial call with the pre-ref-attach null, a functional cleanup-updater
    // call, then the call carrying the actual attached DOM node. Find the call
    // that actually carries the element rather than assuming index 0.
    const registeredEl = mockSetSurfaceHostEl.mock.calls
      .map(([el]) => el)
      .find((el) => el instanceof HTMLElement);
    expect(registeredEl).toBeInstanceOf(HTMLElement);
    expect(registeredEl).toHaveClass('alp-agent-host');
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
    // Default view is Pretty Form (not raw JSON).
    await waitFor(() => expect(screen.getByText('o1')).toBeInTheDocument());
    expect(screen.getByText('Pretty Form')).toHaveClass('alp-view-btn--active');
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
    callMcpTool.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete global.fetch;
  });

  it('walks checkout -> CIBA pending -> approved -> retried checkout', async () => {
    // First call (checkout attempt): step-up required. Second call (post-approval
    // retry): success. Routed through callMcpTool, same as ScopedCallSlot.
    callMcpTool
      .mockImplementationOnce(() =>
        Promise.reject(
          Object.assign(new Error('MCP error: 428'), {
            statusCode: 428,
            code: 'mcp_step_up_required',
          }),
        ),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          result: { content: [{ type: 'text', text: '{}' }] },
          tokenEvents: [],
        }),
      );

    let pollCount = 0;
    global.fetch = vi.fn((url) => {
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
      expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument(),
    );

    await vi.advanceTimersByTimeAsync(1000); // first poll: pending
    await vi.advanceTimersByTimeAsync(1000); // second poll: approved -> retry

    await waitFor(() =>
      expect(screen.getByText('Checkout completed.')).toBeInTheDocument(),
    );
    expect(callMcpTool).toHaveBeenCalledWith(
      'checkout',
      { product: 'Headphones', amount: 600 },
      { useCaseId: 'ciba-out-of-band-approval', vertical: 'retail' },
    );
  });

  it('starts CIBA when callMcpTool soft-succeeds with mcp_hitl_required (no false checkout)', async () => {
    // callMcpTool resolves HITL 428s so the banking agent can open a modal.
    // StepUpSlot must not treat that as a completed purchase.
    callMcpTool
      .mockImplementationOnce(() =>
        Promise.resolve({
          result: {
            error: 'mcp_hitl_required',
            error_description: 'Human approval required',
          },
          tokenEvents: [],
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          result: { content: [{ type: 'text', text: '{}' }] },
          tokenEvents: [],
        }),
      );

    let pollCount = 0;
    global.fetch = vi.fn((url) => {
      if (url === '/api/auth/ciba/initiate') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ auth_req_id: 'req-hitl', interval: 1 }),
        });
      }
      if (url === '/api/auth/ciba/poll/req-hitl') {
        pollCount += 1;
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve(
              pollCount < 2 ? { status: 'pending' } : { status: 'approved' },
            ),
        });
      }
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByText('Checkout $600 headphones'));

    await waitFor(() =>
      expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Checkout completed.')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/ciba/initiate',
      expect.objectContaining({ method: 'POST' }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() =>
      expect(screen.getByText('Checkout completed.')).toBeInTheDocument(),
    );
  });

  it('surfaces an error instead of hanging when checkout rejects', async () => {
    callMcpTool.mockRejectedValue(new Error('network down'));

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
        { reason: 'test reason', scope: 'instance' },
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Confirmed revoked — retry failed: token revoked/)).toBeInTheDocument(),
    );
    expect(screen.getByText('View audit trail →')).toHaveAttribute(
      'href',
      '/audit?agentId=demo-agent',
    );
    expect(screen.getByText('View lifecycle export feed →')).toHaveAttribute(
      'href',
      '/api/control-plane/lifecycle-events?agentId=demo-agent',
    );
  });

  it('treats soft MCP error payloads as confirmed revoke (not unexpected success)', async () => {
    callMcpTool.mockResolvedValue({
      result: { error: 'Unknown tool "list_orders"' },
      tokenEvents: [],
    });
    render(<AgentLifecyclePage />);

    await waitFor(() => expect(screen.getByText('Revoke agent access')).toBeEnabled());
    fireEvent.click(screen.getByText('Revoke agent access'));
    fireEvent.click(screen.getByText('ConfirmRevoke'));

    await waitFor(() =>
      expect(
        screen.getByText(/Confirmed revoked — retry failed: Unknown tool/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Unexpected: call still succeeded/)).not.toBeInTheDocument();
  });
});
