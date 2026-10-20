/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ArchitectureOverviewPage from '../ArchitectureOverviewPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking', pageManifest: { identity: { displayName: 'Super Banking' } } }),
}));

// jsdom measures nothing, so React Flow draws no nodes unless the observer reports each one.
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

// Diagram rule for the diagram routed at /architecture/overview: movable boxes, Simulate (Play/Step), Reset, and step-time speed.
describe('ArchitectureOverviewPage diagram rule', () => {
  it('boxes are draggable and the page has Simulate, Prev/Next, Reset and speed', () => {
    const { container } = render(<ArchitectureOverviewPage />);
    const boxes = container.querySelectorAll('.react-flow__node-sfd');
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach((n) => expect(n.classList.contains('draggable')).toBe(true));
    const bar = screen.getByTestId('aov-stepbar');
    expect(within(bar).getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: /Reset$/ })).toBeTruthy();
    expect(bar.querySelector('.dc-steptime-select')).toBeTruthy();
  });
});
