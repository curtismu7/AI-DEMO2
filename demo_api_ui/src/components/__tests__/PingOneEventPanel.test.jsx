import { render, screen } from '@testing-library/react';
import PingOneEventPanel from '../PingOneEventPanel';

let _mockStreamEvents = [];
vi.mock('../../hooks/useActivityLog', () => ({
  useActivityLog: () => ({ events: _mockStreamEvents }),
}));

describe('PingOneEventPanel — live SSE shape normalization', () => {
  beforeEach(() => {
    _mockStreamEvents = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
  });

  it('renders the real event type from a metadata-nested SSE entry, not the generic fallback', async () => {
    _mockStreamEvents = [
      {
        id: 'log-1',
        tag: 'pingone/event',
        timestamp: '2026-09-04T19:39:38.422Z',
        metadata: {
          eventId: 'p1-1',
          eventType: 'USER.ACCESS_ALLOWED',
          actorId: 'demoUser',
          status: 'SUCCESS',
          timestamp: '2026-09-04T19:39:38.422Z',
        },
      },
    ];
    render(<PingOneEventPanel />);
    expect(await screen.findByText('USER.ACCESS_ALLOWED')).toBeInTheDocument();
    expect(screen.getByText('demoUser')).toBeInTheDocument();
    expect(screen.queryByText('event')).not.toBeInTheDocument();
  });

  it('does not duplicate a row when the same eventId reappears in a re-derived stream list', async () => {
    const entry = {
      id: 'log-1',
      tag: 'pingone/event',
      timestamp: '2026-09-04T19:39:38.422Z',
      metadata: {
        eventId: 'p1-1',
        eventType: 'USER.ACCESS_ALLOWED',
        actorId: 'demoUser',
        status: 'SUCCESS',
        timestamp: '2026-09-04T19:39:38.422Z',
      },
    };
    _mockStreamEvents = [entry];
    const { rerender } = render(<PingOneEventPanel />);
    await screen.findByText('USER.ACCESS_ALLOWED');

    // Ring buffer re-derives the same tagged entry on the next update (e.g. an
    // unrelated activity-log event pushed in front of it) — must not re-add it.
    _mockStreamEvents = [{ ...entry, id: 'unrelated' }, entry];
    rerender(<PingOneEventPanel />);
    expect(await screen.findAllByText('USER.ACCESS_ALLOWED')).toHaveLength(1);
  });
});
