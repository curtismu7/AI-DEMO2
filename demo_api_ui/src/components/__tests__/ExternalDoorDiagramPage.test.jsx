import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ExternalDoorDiagramPage from '../ExternalDoorDiagramPage';

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node.
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

describe('ExternalDoorDiagramPage diagram controls', () => {
  it('the sequence diagram has Simulate, Reset and a speed selector', () => {
    render(<ExternalDoorDiagramPage />);
    const seq = screen.getByRole('region', { name: 'External door dual credential path sequence diagram' });
    expect(within(seq).getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(within(seq).getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(within(seq).getByTitle('Time each step takes during Simulate')).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Simulate' }));
    expect(within(seq).getByText(/Step 1 of \d+/)).toBeTruthy();
    fireEvent.click(within(seq).getByRole('button', { name: 'Reset' }));
    expect(within(seq).getByRole('button', { name: 'Simulate' })).toBeTruthy();
  });

  it('the topology has the same controls', () => {
    render(<ExternalDoorDiagramPage />);
    const topo = screen.getByRole('region', { name: 'External door topology' });
    expect(within(topo).getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(within(topo).getByRole('button', { name: 'Reset' })).toBeTruthy();
  });

  it('both figures are drawn in the Ping style', () => {
    render(<ExternalDoorDiagramPage />);
    expect(document.querySelectorAll('.efd--ping').length).toBe(2);
  });

  it('keeps the notes, the export bar and the .mmd upload path', () => {
    render(<ExternalDoorDiagramPage />);
    expect(screen.getByText('Key difference')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download .mmd' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload .mmd' })).toBeTruthy();
  });

  it('clicking a box shows the request, the MOCK token and the standards of its first arrow', async () => {
    render(<ExternalDoorDiagramPage />);
    fireEvent.click(await screen.findByTestId('ext-door-flow-diagram-flow-node-gw'));
    const panel = screen.getByTestId('ext-door-flow-diagram-flow-reel-detail');
    expect(panel.textContent).toContain('POST /mcp');
    expect(panel.textContent).toContain('MOCK, teaching values only');
    expect(panel.textContent).toContain('RFC 9110');
  });

  it('a sequence step that carries no token says why', async () => {
    render(<ExternalDoorDiagramPage />);
    fireEvent.click(await screen.findByTestId('ext-door-seq-flow-node-P1'));
    const panel = screen.getByTestId('ext-door-seq-flow-reel-detail');
    expect(panel.textContent).toContain('Token: none');
    expect(panel.textContent).toContain('RFC 7636');
  });
});
