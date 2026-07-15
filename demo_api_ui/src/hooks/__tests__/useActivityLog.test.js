import { renderHook, act, waitFor } from '@testing-library/react';
import { useActivityLog } from '../useActivityLog';

// Stub useAppEventsSSE to push events manually.
let _handler = null;
vi.mock('../useAppEventsSSE', () => ({
  useAppEventsSSE: (h) => { _handler = h; },
}));

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ events: [], total: 0 }),
  });
});

function pushEvent(e) {
  act(() => { _handler(e); });
}

describe('useActivityLog — category filter', () => {
  it('shows events matching active category', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '1', category: 'mcp', severity: 'info', message: 'M' });
    expect(result.current.events).toHaveLength(1);
  });

  it('hides events whose category is toggled off', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    act(() => result.current.toggleFilter('mcp'));
    pushEvent({ id: '2', category: 'mcp', severity: 'info', message: 'M' });
    expect(result.current.events).toHaveLength(0);
  });
});

describe('useActivityLog — useCaseId filter', () => {
  it('availableUseCaseIds derives from top-level event.useCaseId', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '3', category: 'mcp', useCaseId: 'delegated-access-with-proof', severity: 'info', message: 'M' });
    expect(result.current.availableUseCaseIds).toContain('delegated-access-with-proof');
  });

  it('availableUseCaseIds derives from event.metadata.useCaseId', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '4', category: 'agent', metadata: { useCaseId: 'a2a-delegation' }, severity: 'info', message: 'M' });
    expect(result.current.availableUseCaseIds).toContain('a2a-delegation');
  });

  it('filters to matching useCaseId when filter is active', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '5', category: 'mcp', useCaseId: 'uc-a', severity: 'info', message: 'A' });
    pushEvent({ id: '6', category: 'agent', metadata: { useCaseId: 'uc-b' }, severity: 'info', message: 'B' });
    act(() => result.current.toggleUseCaseFilter('uc-a'));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe('5');
  });

  it('clearUseCaseFilter restores all events', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '7', category: 'mcp', useCaseId: 'uc-a', severity: 'info', message: 'A' });
    pushEvent({ id: '8', category: 'agent', metadata: { useCaseId: 'uc-b' }, severity: 'info', message: 'B' });
    act(() => result.current.toggleUseCaseFilter('uc-a'));
    act(() => result.current.clearUseCaseFilter());
    expect(result.current.events).toHaveLength(2);
  });

  it('events without useCaseId are hidden when filter is active', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '9', category: 'mcp', severity: 'info', message: 'no-uc' });
    pushEvent({ id: '10', category: 'mcp', useCaseId: 'uc-a', severity: 'info', message: 'has-uc' });
    act(() => result.current.toggleUseCaseFilter('uc-a'));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe('10');
  });

  // BUG 1 regression: availableUseCaseIds comes from ALL events, not categoryFiltered.
  // Toggling a category OFF must not remove use-case pills from the picker.
  it('toggling a category off does not remove its UC ids from the picker', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '11', category: 'mcp', useCaseId: 'uc-x', severity: 'info', message: 'X' });
    // 'mcp' is in availableUseCaseIds before toggling off
    expect(result.current.availableUseCaseIds).toContain('uc-x');
    // Toggle 'mcp' category off — uc-x's pill should still be available
    act(() => result.current.toggleFilter('mcp'));
    expect(result.current.availableUseCaseIds).toContain('uc-x');
  });

  // BUG 2a: with NO UC filter active, untagged events must be visible.
  it('untagged events are visible when no UC filter is active', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '12', category: 'auth_lifecycle', severity: 'info', message: 'login' });
    pushEvent({ id: '13', category: 'mcp', useCaseId: 'uc-a', severity: 'info', message: 'tagged' });
    // No UC filter active — all events shown (activeUseCaseFilters === null)
    expect(result.current.activeUseCaseFilters).toBeNull();
    expect(result.current.events.map((e) => e.id)).toContain('12');
    expect(result.current.events.map((e) => e.id)).toContain('13');
  });

  // BUG 2b: with a UC filter active, only that UC's tagged events show; untagged excluded.
  it('with a UC filter active only matching tagged events show', () => {
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    pushEvent({ id: '14', category: 'auth_lifecycle', severity: 'info', message: 'untagged' });
    pushEvent({ id: '15', category: 'mcp', useCaseId: 'uc-a', severity: 'info', message: 'uc-a' });
    pushEvent({ id: '16', category: 'agent', useCaseId: 'uc-b', severity: 'info', message: 'uc-b' });
    act(() => result.current.toggleUseCaseFilter('uc-a'));
    const ids = result.current.events.map((e) => e.id);
    expect(ids).toContain('15');
    expect(ids).not.toContain('14'); // untagged excluded
    expect(ids).not.toContain('16'); // different UC excluded
  });
});

describe('useActivityLog — backlog seed', () => {
  it('loads recent events from GET /api/app-events when enabled', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { id: 'seed-1', category: 'oauth', severity: 'info', message: 'login', timestamp: '2026-07-15T00:00:00.000Z' },
        ],
        total: 1,
      }),
    });
    const { result } = renderHook(() => useActivityLog({ enabled: true }));
    await waitFor(() => {
      expect(result.current.events.some((e) => e.id === 'seed-1')).toBe(true);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/app-events?limit=200',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
