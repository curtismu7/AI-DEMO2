import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentRunTimeline from '../AgentRunTimeline';

vi.mock('../ProtocolPlayground/TokenChainEventCard.css', () => ({}), { virtual: true });
vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

import apiClient from '../../services/apiClient';

const AGUI_RUN = { runId: 'run_agui', agentPath: 'agui', prompt: 'agui prompt' };
const REPORT_RUN = {
  runId: 'run_invoke',
  agentPath: 'invoke',
  prompt: 'check my balance',
  toolsCalled: ['get_account_balance'],
  tokenEvents: [{ label: 'user-token', status: 'success' }],
  success: true,
};

beforeEach(() => {
  apiClient.get.mockReset();
});

describe('AgentRunTimeline', () => {
  it('renders nothing recorded when given no run', async () => {
    render(<AgentRunTimeline run={null} />);
    await waitFor(() => expect(screen.getByText(/No events recorded/)).toBeInTheDocument());
  });

  it('agui run: fetches raw AG-UI events and renders projected cards', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        events: [
          { type: 'RUN_STARTED', threadId: 't1' },
          { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'get_account_balance' },
          { type: 'TOOL_CALL_END', toolCallId: 'c1' },
          { type: 'RUN_FINISHED', outcome: {} },
        ],
      },
    });
    render(<AgentRunTimeline run={AGUI_RUN} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/agent/run/runs/run_agui/events',
    ));
    await waitFor(() => expect(screen.getByText('Run started')).toBeInTheDocument());
    expect(screen.getByText(/Tool call: get_account_balance/)).toBeInTheDocument();
    expect(screen.getByText('Run finished')).toBeInTheDocument();
  });

  it('agui run whose trace has expired falls back to the reportStore record', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404 } });
    render(<AgentRunTimeline run={{ ...AGUI_RUN, toolsCalled: ['get_account_balance'], success: true }} />);
    await waitFor(() => expect(screen.getByText(/agui prompt/)).toBeInTheDocument());
    expect(screen.getByText(/Tool call: get_account_balance/)).toBeInTheDocument();
  });

  it('non-agui run: renders directly from the reportStore record, no fetch', async () => {
    render(<AgentRunTimeline run={REPORT_RUN} />);
    expect(apiClient.get).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/check my balance/)).toBeInTheDocument());
    expect(screen.getByText(/Tool call: get_account_balance/)).toBeInTheDocument();
    expect(screen.getByText('Run finished')).toBeInTheDocument();
  });
});
