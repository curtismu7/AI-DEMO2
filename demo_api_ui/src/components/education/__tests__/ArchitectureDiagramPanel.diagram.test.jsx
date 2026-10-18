/* eslint-disable testing-library/no-node-access -- React Flow nodes have no role; the "draggable" class is what shows they move */
import React from 'react';
import { render, within } from '@testing-library/react';
import ArchitectureDiagramPanel from '../ArchitectureDiagramPanel';

window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

describe.each([
  ['context', 'c4-context-diagram', 4],
  ['container', 'c4-container-diagram', 6],
  ['component', 'c4-component-diagram', 9],
  ['code', 'c4-code-diagram', 10],
])('ArchitectureDiagramPanel — %s tab', (tabId, testId, nodeCount) => {
  it('draws the diagram in React Flow with draggable boxes, Simulate, Reset and step time', () => {
    render(<ArchitectureDiagramPanel isOpen onClose={() => {}} initialTabId={tabId} />);
    const boxes = document.querySelectorAll(`[data-testid="${testId}"] .react-flow__node-sfd`);
    expect(boxes).toHaveLength(nodeCount);
    boxes.forEach((n) => expect(n.classList.contains('draggable')).toBe(true));
    const bar = within(document.body).getByTestId(`${testId}-steps`);
    expect(within(bar).getByText('Simulate')).toBeInTheDocument();
    expect(within(bar).getByText('Reset')).toBeInTheDocument();
    expect(within(bar).getByText('Step time:')).toBeInTheDocument();
    const ascii = [...document.querySelectorAll('pre')].filter((p) => /[┌└│▼▲▶─]/.test(p.textContent));
    expect(ascii).toHaveLength(0);
  });
});
