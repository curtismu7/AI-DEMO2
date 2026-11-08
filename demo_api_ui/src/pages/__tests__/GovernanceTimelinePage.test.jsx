import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('puts the banner first, with a note role that says nothing is simulated', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
    const { container } = render(<GovernanceTimelinePage />);
    const banner = screen.getByTestId('gt-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent(/nothing on this page is simulated/i);
    // First element on the page, above the title band.
    expect(container.querySelector('.pu-page').firstElementChild).toContainElement(banner);
    await screen.findByText('No evidence is available for this lane yet.');
  });

  it('has exactly one primary button, and the lane buttons are secondaries', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
    const { container } = render(<GovernanceTimelinePage />);
    await screen.findByText('No evidence is available for this lane yet.');
    const primaries = container.querySelectorAll('button.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveAttribute('data-testid', 'gt-refresh');
    for (const name of ['All activity', 'Identity & NHI', 'Authorization', 'Privilege', 'Governance']) {
      expect(screen.getByRole('button', { name })).toHaveClass('pu-btn');
      expect(screen.getByRole('button', { name })).not.toHaveClass('pu-btn--primary');
    }
  });

  it('marks the chosen lane with aria-pressed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
    render(<GovernanceTimelinePage />);
    await screen.findByText('No evidence is available for this lane yet.');
    expect(screen.getByRole('button', { name: 'All activity' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Privilege' }));
    expect(screen.getByRole('button', { name: 'Privilege' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All activity' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the lane as a chip with its word, lane counts, and a severity chip for warnings', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'a', timestamp: '2026-09-21T12:00:00.000Z', category: 'authorize', severity: 'warning', message: 'Authz warning' },
          { id: 'b', timestamp: '2026-09-21T11:00:00.000Z', category: 'agent', severity: 'info', message: 'Agent event' },
          { id: 'c', timestamp: '2026-09-21T10:00:00.000Z', category: 'agent', message: 'Another agent event' },
        ],
      }),
    });
    render(<GovernanceTimelinePage />);
    await screen.findByText('Authz warning');
    const items = within(screen.getByTestId('gt-timeline')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Authorization')).toHaveClass('pu-chip');
    expect(within(items[0]).getByText('Warning')).toHaveClass('pu-chip');
    expect(within(items[1]).queryByText('Warning')).not.toBeInTheDocument();
    const lanes = within(screen.getByTestId('gt-lanes'));
    expect(lanes.getByText('Identity & NHI').nextElementSibling).toHaveTextContent('2');
    expect(lanes.getByText('Authorization').nextElementSibling).toHaveTextContent('1');
    expect(within(screen.getByTestId('gt-source')).getByText('Loaded')).toHaveClass('pu-chip');
  });

  it('refreshes the evidence, and the primary keeps focus and ignores clicks while it runs', async () => {
    let release;
    const first = { ok: true, json: async () => ({ events: [{ id: 'one', timestamp: '2026-09-21T12:00:00.000Z', category: 'agent', message: 'First read' }] }) };
    const second = { ok: true, json: async () => ({ events: [{ id: 'two', timestamp: '2026-09-21T13:00:00.000Z', category: 'agent', message: 'Second read' }] }) };
    const spy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(second); }));
    render(<GovernanceTimelinePage />);
    await screen.findByText('First read');

    const refresh = screen.getByTestId('gt-refresh');
    refresh.focus();
    fireEvent.click(refresh);
    expect(spy).toHaveBeenCalledTimes(2);
    // Running: same element, still focused, aria-disabled rather than disabled, rows from the last read stay.
    expect(screen.getByTestId('gt-refresh')).toBe(refresh);
    expect(refresh).toHaveFocus();
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    expect(refresh).not.toBeDisabled();
    expect(refresh).toHaveTextContent('Refreshing');
    expect(screen.getByText('First read')).toBeInTheDocument();
    fireEvent.click(refresh);
    expect(spy).toHaveBeenCalledTimes(2);

    release();
    await screen.findByText('Second read');
    expect(screen.queryByText('First read')).not.toBeInTheDocument();
    expect(refresh).toHaveFocus();
    expect(refresh).not.toHaveAttribute('aria-disabled');
    expect(refresh).toHaveTextContent('Refresh evidence');
  });

  it('says the log is unavailable instead of "no evidence" when the read fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<GovernanceTimelinePage />);
    await screen.findByText(/could not be read/);
    expect(within(screen.getByTestId('gt-source')).getByText('Unavailable')).toHaveClass('pu-chip');
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByText('No evidence is available for this lane yet.')).not.toBeInTheDocument();
  });

  it('keeps the last good rows and says so when a refresh fails', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ events: [{ id: 'one', timestamp: '2026-09-21T12:00:00.000Z', category: 'agent', message: 'Kept row' }] }) })
      .mockRejectedValueOnce(new Error('network'));
    render(<GovernanceTimelinePage />);
    await screen.findByText('Kept row');
    fireEvent.click(screen.getByTestId('gt-refresh'));
    await screen.findByText(/last successful read/);
    expect(screen.getByText('Kept row')).toBeInTheDocument();
  });
});
