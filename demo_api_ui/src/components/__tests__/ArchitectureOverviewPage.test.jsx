import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCENARIOS } from '../../config/architecture-sim-scenarios';
import { useVertical } from '../../vertical/useVertical';
import ArchitectureOverviewPage from '../ArchitectureOverviewPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: vi.fn(),
}));

vi.mock('../diagram', () => ({
  DiagramControls: ({ extra }) => extra,
  StepTimeSelector: () => <span>step-time-selector</span>,
  DEFAULT_STEP_MS: 1000,
  STEP_TIME_OPTIONS: [],
}));

vi.mock('../ArchitectureSimSvg', () => ({ default: () => null }));

describe('ArchitectureOverviewPage', () => {
  beforeEach(() => {
    useVertical.mockReturnValue({
      activeId: 'banking',
      pageManifest: { identity: { displayName: 'Super Banking' } },
    });
  });

  it('uses the active vertical in the page heading', () => {
    useVertical.mockReturnValue({
      activeId: 'airlines',
      pageManifest: { identity: { displayName: 'United Airlines' } },
    });

    render(<ArchitectureOverviewPage />);

    expect(screen.getByRole('heading', { name: 'PingOne AI United Airlines Architecture' })).toBeInTheDocument();
  });

  it('keeps the banking heading and offers the full architecture flow', () => {
    render(<ArchitectureOverviewPage />);

    expect(screen.getByRole('heading', { name: 'PingOne AI Banking Architecture' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Run all the steps (full arch)' })).toBeInTheDocument();
  });

  it('loads the combined flow steps when full architecture is selected', () => {
    render(<ArchitectureOverviewPage />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'full-architecture' } });

    const expectedStepCount = SCENARIOS
      .filter(scenario => scenario.group === 'Flows' && scenario.id !== 'full-architecture')
      .reduce((count, scenario) => count + scenario.steps.length, 0);
    expect(screen.getByText(`0/${expectedStepCount}`)).toBeInTheDocument();
  });

  it('keeps Play, Step, Reset and the step-time selector on the diagram', () => {
    render(<ArchitectureOverviewPage />);

    expect(screen.getByRole('button', { name: '▶ Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↺ Reset' })).toBeInTheDocument();
    expect(screen.getByText('step-time-selector')).toBeInTheDocument();
  });
});
