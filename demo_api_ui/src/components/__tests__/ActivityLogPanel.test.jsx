import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ALL_CATEGORIES } from '../../hooks/useActivityLog';
import ActivityLogPanel, { flowBoundaryKind } from '../ActivityLogPanel';

// Stub the hook while keeping the real module's other exports (ALL_CATEGORIES etc).
let _mockReturn = null;
vi.mock('../../hooks/useActivityLog', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useActivityLog: () => _mockReturn,
  };
});

function baseState(overrides = {}) {
  return {
    events: [],
    isPaused: false,
    newCount: 0,
    activeFilters: new Set(ALL_CATEGORIES),
    toggleFilter: vi.fn(),
    setAllFilters: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    resetNewCount: vi.fn(),
    availableUseCaseIds: [],
    activeUseCaseFilters: null,
    toggleUseCaseFilter: vi.fn(),
    clearUseCaseFilter: vi.fn(),
    ...overrides,
  };
}

describe('ActivityLogPanel — agent flow bookends', () => {
  it('renders start and end dividers for agent/flow-* tags', () => {
    _mockReturn = baseState({
      events: [
        {
          id: 'e1',
          tag: 'agent/flow-end',
          category: 'agent',
          severity: 'info',
          message: 'Agent flow end — success · 1 tool(s)',
          timestamp: '2026-07-15T12:00:01.000Z',
          correlationId: 'abcd1234-ffff-4444-8888-ffffffffffff',
        },
        {
          id: 'e0',
          tag: 'agent/flow-start',
          category: 'agent',
          severity: 'info',
          message: 'Agent flow start — show my balance',
          timestamp: '2026-07-15T12:00:00.000Z',
          correlationId: 'abcd1234-ffff-4444-8888-ffffffffffff',
        },
      ],
    });
    render(<ActivityLogPanel enabled={true} />);
    expect(screen.getByTestId('alp-flow-end')).toBeInTheDocument();
    expect(screen.getByTestId('alp-flow-start')).toBeInTheDocument();
    expect(screen.getByText('Agent flow start')).toBeInTheDocument();
    expect(screen.getByText('Agent flow end')).toBeInTheDocument();
    expect(screen.getAllByText('abcd1234').length).toBeGreaterThanOrEqual(1);
  });
});

describe('flowBoundaryKind', () => {
  it('detects start and end tags only', () => {
    expect(flowBoundaryKind({ tag: 'agent/flow-start' })).toBe('start');
    expect(flowBoundaryKind({ tag: 'agent/flow-end' })).toBe('end');
    expect(flowBoundaryKind({ tag: 'agent/route' })).toBeNull();
    expect(flowBoundaryKind({})).toBeNull();
  });
});

describe('ActivityLogPanel — use-case filter pills', () => {
  it('does not render use-case filter row when availableUseCaseIds is empty', () => {
    _mockReturn = baseState({ availableUseCaseIds: [] });
    render(<ActivityLogPanel enabled={true} />);
    expect(screen.queryByText('Use case:')).not.toBeInTheDocument();
  });

  it('renders use-case pills when ids are available', () => {
    _mockReturn = baseState({ availableUseCaseIds: ['uc-a', 'uc-b'] });
    render(<ActivityLogPanel enabled={true} />);
    expect(screen.getByText('uc-a')).toBeInTheDocument();
    expect(screen.getByText('uc-b')).toBeInTheDocument();
  });

  it('calls toggleUseCaseFilter when a pill is clicked', async () => {
    const toggleUseCaseFilter = vi.fn();
    _mockReturn = baseState({ availableUseCaseIds: ['uc-a'], toggleUseCaseFilter });
    render(<ActivityLogPanel enabled={true} />);
    await userEvent.click(screen.getByText('uc-a'));
    expect(toggleUseCaseFilter).toHaveBeenCalledWith('uc-a');
  });

  it('All button is disabled when no filter is active', () => {
    _mockReturn = baseState({ availableUseCaseIds: ['uc-a'], activeUseCaseFilters: null });
    render(<ActivityLogPanel enabled={true} />);
    expect(screen.getByRole('button', { name: 'All' })).toBeDisabled();
  });

  it('All button is enabled and calls clearUseCaseFilter when filter is active', async () => {
    const clearUseCaseFilter = vi.fn();
    _mockReturn = baseState({
      availableUseCaseIds: ['uc-a'],
      activeUseCaseFilters: new Set(['uc-a']),
      clearUseCaseFilter,
    });
    render(<ActivityLogPanel enabled={true} />);
    const allBtn = screen.getByRole('button', { name: 'All' });
    expect(allBtn).not.toBeDisabled();
    await userEvent.click(allBtn);
    expect(clearUseCaseFilter).toHaveBeenCalledTimes(1);
  });
});

describe('ActivityLogPanel — event details pane', () => {
  beforeEach(() => localStorage.clear());

  const withEvent = (extra) => {
    _mockReturn = baseState({
      events: [{ id: 'e1', category: 'agent', severity: 'info', message: 'Token exchanged', timestamp: '2026-07-15T12:00:00.000Z', ...extra }],
    });
    return render(<ActivityLogPanel enabled={true} />);
  };

  it('shows no details until the row is opened, then the metadata as a named pane in Form view', async () => {
    withEvent({ metadata: { aud: 'mcp-server', scope: 'read', hops: 2 } });
    expect(screen.queryByRole('group', { name: /^Event details/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Token exchanged/ }));
    const pane = screen.getByRole('group', { name: 'Event details: Token exchanged' });
    expect(pane).toHaveTextContent('mcp-server');
    expect(pane.tagName).toBe('DIV');
    await userEvent.click(screen.getByRole('button', { name: /Token exchanged/ }));
    expect(screen.queryByRole('group', { name: /^Event details/ })).not.toBeInTheDocument();
  });

  it('shows the exact pretty-printed metadata after choosing JSON, and the pane buttons do not collapse the row', async () => {
    const metadata = { aud: 'mcp-server', nested: { a: 1 } };
    withEvent({ metadata });
    await userEvent.click(screen.getByRole('button', { name: /Token exchanged/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Event details: Token exchanged view' })).getByRole('button', { name: 'JSON' }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="Event details: Token exchanged"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify(metadata, null, 2));
  });

  it('falls back to the tag when there is no metadata, and is not expandable with neither', async () => {
    const { unmount } = withEvent({ tag: 'agent/route' });
    await userEvent.click(screen.getByRole('button', { name: /Token exchanged/ }));
    expect(screen.getByRole('group', { name: 'Event details: Token exchanged' })).toHaveTextContent('agent/route');
    unmount();

    withEvent({});
    await userEvent.click(screen.getByRole('button', { name: /Token exchanged/ }));
    expect(screen.queryByRole('group', { name: /^Event details/ })).not.toBeInTheDocument();
  });
});
