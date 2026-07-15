import { render, screen } from '@testing-library/react';
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
    toggleFilter: jest.fn(),
    setAllFilters: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    clear: jest.fn(),
    resetNewCount: jest.fn(),
    availableUseCaseIds: [],
    activeUseCaseFilters: null,
    toggleUseCaseFilter: jest.fn(),
    clearUseCaseFilter: jest.fn(),
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
    const toggleUseCaseFilter = jest.fn();
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
    const clearUseCaseFilter = jest.fn();
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
