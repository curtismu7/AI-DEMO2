import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ALL_CATEGORIES } from '../../hooks/useActivityLog';
import ActivityLogPanel from '../ActivityLogPanel';

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
