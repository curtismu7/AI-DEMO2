/* eslint-disable testing-library/no-node-access, testing-library/no-container -- React Flow nodes have no role; the "draggable" class is what shows they move */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ArchitectureOverviewPage from '../ArchitectureOverviewPage';

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking', pageManifest: { identity: { displayName: 'Super Banking' } } }),
}));

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

// Diagram rule for ArchitectureSimSvg as routed at /architecture/overview: movable boxes, Simulate (Play/Step),
// Reset, and step-time speed.
describe('ArchitectureOverviewPage diagram rule', () => {
  it('ArchitectureSimSvg boxes are draggable and the page has Play, Step, Reset and speed', () => {
    const { container } = render(<ArchitectureOverviewPage />);
    const boxes = container.querySelectorAll('.react-flow__node-sim');
    expect(boxes.length).toBeGreaterThan(0);
    boxes.forEach((n) => expect(n.classList.contains('draggable')).toBe(true));
    expect(screen.getByText('▶ Play')).toBeTruthy();
    expect(screen.getByText('Step')).toBeTruthy();
    expect(screen.getByText('↺ Reset')).toBeTruthy();
    expect(container.querySelector('.dc-steptime-select')).toBeTruthy();
  });
});
