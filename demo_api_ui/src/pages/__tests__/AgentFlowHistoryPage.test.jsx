import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentFlowHistoryPage from '../AgentFlowHistoryPage';

vi.mock('../AgentFlowHistoryPage.css', () => ({}), { virtual: true });
vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));
vi.mock('../../components/AgentRunTimeline', () => ({
  default: ({ run }) => <div data-testid="run-timeline">{run ? run.runId : 'none'}</div>,
}));

import apiClient from '../../services/apiClient';

const RUNS = [
  {
    runId: 'run_2', userId: 'u1', vertical: 'banking', prompt: 'second run',
    startedAt: '2026-08-15T10:00:00.000Z', completedAt: '2026-08-15T10:00:05.000Z',
    toolsCalled: ['get_account_balance'], tokenEvents: [], success: true, agentPath: 'invoke',
  },
  {
    runId: 'run_1', userId: 'u1', vertical: 'pingone-admin', prompt: 'first run',
    startedAt: '2026-08-15T09:00:00.000Z', completedAt: '2026-08-15T09:00:03.000Z',
    toolsCalled: [], tokenEvents: [], success: false, agentPath: 'admin-agent',
  },
];

beforeEach(() => {
  apiClient.get.mockReset();
  document.title = 'original title';
});

describe('AgentFlowHistoryPage', () => {
  it('sets the page title and restores it on unmount', async () => {
    apiClient.get.mockResolvedValue({ data: { runs: [] } });
    const { unmount } = render(<AgentFlowHistoryPage />);
    await waitFor(() => expect(screen.getByText(/No agent runs recorded yet/)).toBeInTheDocument());
    expect(document.title).toBe('Agent & Token Flow History');
    unmount();
    expect(document.title).toBe('original title');
  });

  it('shows a loading state, then an empty state when there is no history', async () => {
    apiClient.get.mockResolvedValue({ data: { runs: [] } });
    render(<AgentFlowHistoryPage />);
    expect(screen.getByText(/Loading runs/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No agent runs recorded yet/)).toBeInTheDocument());
  });

  it('shows an error state when the list fetch fails', async () => {
    apiClient.get.mockRejectedValue(new Error('network down'));
    render(<AgentFlowHistoryPage />);
    await waitFor(() => expect(screen.getByText(/Failed to load run history/)).toBeInTheDocument());
  });

  it('renders the run list newest-first and defaults the detail to the first run', async () => {
    apiClient.get.mockResolvedValue({ data: { runs: RUNS } });
    render(<AgentFlowHistoryPage />);
    await waitFor(() => expect(screen.getByText('second run')).toBeInTheDocument());
    expect(screen.getByText('first run')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('run-timeline')).toHaveTextContent('run_2'));
  });

  it('clicking a run in the list selects it for the detail view', async () => {
    apiClient.get.mockResolvedValue({ data: { runs: RUNS } });
    render(<AgentFlowHistoryPage />);
    await waitFor(() => expect(screen.getByText('first run')).toBeInTheDocument());
    fireEvent.click(screen.getByText('first run'));
    expect(screen.getByTestId('run-timeline')).toHaveTextContent('run_1');
  });
});
