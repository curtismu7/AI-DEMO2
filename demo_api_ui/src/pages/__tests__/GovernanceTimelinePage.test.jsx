import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GovernanceTimelinePage from '../GovernanceTimelinePage';

describe('GovernanceTimelinePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders lifecycle evidence from the app-event history endpoint', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 'evt-1',
            timestamp: '2026-09-21T12:00:00.000Z',
            category: 'authorize',
            message: 'PingOne Authorize permitted a delegated tool call',
            metadata: { useCaseId: 'UC43' },
          },
          {
            id: 'evt-2',
            timestamp: '2026-09-21T11:59:00.000Z',
            category: 'agent',
            message: 'Personal agent registered',
          },
        ],
      }),
    });

    render(<GovernanceTimelinePage />);

    expect(screen.getByRole('heading', { name: 'Governance Timeline' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/PingOne Authorize permitted/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Authorization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Identity & NHI' })).toBeInTheDocument();
    expect(screen.getByText('UC43')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/app-events?limit=100', { credentials: 'include' });
  });

  it('filters timeline rows by lifecycle lane', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'evt-a', timestamp: '2026-09-21T12:00:00.000Z', category: 'authorize', message: 'Authorization event' },
          { id: 'evt-b', timestamp: '2026-09-21T11:59:00.000Z', category: 'agent', message: 'Identity event' },
        ],
      }),
    });

    render(<GovernanceTimelinePage />);
    await screen.findByText('Authorization event');

    fireEvent.click(screen.getByRole('button', { name: 'Identity & NHI' }));
    await waitFor(() => expect(screen.queryByText('Authorization event')).not.toBeInTheDocument());
    expect(screen.getByText('Identity event')).toBeInTheDocument();
  });
});
