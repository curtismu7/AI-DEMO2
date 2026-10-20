/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the class names are what show Ping style and drag */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCENARIOS } from '../../config/architecture-sim-scenarios';
import { useVertical } from '../../vertical/useVertical';
import ArchitectureOverviewPage from '../ArchitectureOverviewPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: vi.fn(),
}));

// jsdom measures nothing, so React Flow draws no nodes or edges unless the observer reports each one.
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 250 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 40 });
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

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

    fireEvent.change(screen.getByRole('combobox', { name: 'Scenario' }), { target: { value: 'full-architecture' } });

    const expectedStepCount = SCENARIOS
      .filter(scenario => scenario.group === 'Flows' && scenario.id !== 'full-architecture')
      .reduce((count, scenario) => count + scenario.steps.length, 0);
    expect(screen.getByText(`Simulate walks the ${expectedStepCount} arrows in order.`)).toBeInTheDocument();
  });

  it('draws the diagram in the Ping style with the arrow key and the shared Simulate, Reset and speed controls', () => {
    const { container } = render(<ArchitectureOverviewPage />);

    expect(container.querySelector('.sfd--ping')).toBeTruthy();
    expect(screen.getByLabelText('Arrow key')).toBeInTheDocument();
    const bar = screen.getByTestId('aov-stepbar');
    expect(within(bar).getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Reset$/ })).toBeInTheDocument();
    expect(within(bar).getByTitle(/Time each step takes/)).toBeInTheDocument();
  });

  it('Simulate starts the walk on the first step of the chosen scenario', () => {
    render(<ArchitectureOverviewPage />);

    fireEvent.click(within(screen.getByTestId('aov-stepbar')).getByRole('button', { name: 'Simulate' }));

    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
  });

  it('shows what a box does when it is clicked', () => {
    render(<ArchitectureOverviewPage />);

    fireEvent.click(screen.getByTestId('aov-flow-node-n-bff'));

    expect(screen.getByTestId('aov-node-detail').textContent).toContain('Sole OAuth token custodian');
  });

  it('Live trace waits for events and hides the scenario picker', () => {
    class FakeEventSource {
      constructor() { this.listeners = {}; }
      addEventListener(type, fn) { this.listeners[type] = fn; }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    render(<ArchitectureOverviewPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Live trace' }));

    expect(screen.getByText(/Waiting for real system events/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Scenario' })).toBeNull();
    vi.unstubAllGlobals();
  });
});
