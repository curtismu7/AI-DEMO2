import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import InvestDualAuthDiagramPage from '../InvestDualAuthDiagramPage';

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

describe('InvestDualAuthDiagramPage in the Ping style', () => {
  it('draws one Ping-style diagram with Simulate, Reset and the speed selector', () => {
    render(<InvestDualAuthDiagramPage />);
    expect(document.querySelectorAll('.efd--ping').length).toBe(1);
    const region = screen.getByRole('region', { name: 'Invest dual-auth sequence diagram' });
    expect(within(region).getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(within(region).getByTitle('Time each step takes during Simulate')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Simulate' }));
    expect(within(region).getByText(/Step 1 of 6/)).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: 'Reset' }));
    expect(within(region).getByRole('button', { name: 'Simulate' })).toBeTruthy();
  });

  it('keeps the notes, the export bar and the .mmd upload path', () => {
    render(<InvestDualAuthDiagramPage />);
    expect(screen.getByText('Key Difference')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download .mmd' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload .mmd' })).toBeTruthy();
  });

  it('clicking the gateway shows the user-token call, a MOCK token and the standards', async () => {
    render(<InvestDualAuthDiagramPage />);
    fireEvent.click(await screen.findByTestId('invest-dual-auth-flow-node-gw'));
    const panel = screen.getByTestId('invest-dual-auth-flow-reel-detail');
    expect(panel.textContent).toContain('tools/call');
    expect(panel.textContent).toContain('MOCK, teaching values only');
    expect(panel.textContent).toContain('RFC 9110');
  });

  it('a step that carries a shared secret says it is not a token', async () => {
    render(<InvestDualAuthDiagramPage />);
    fireEvent.click(await screen.findByTestId('invest-dual-auth-flow-node-vault'));
    const panel = screen.getByTestId('invest-dual-auth-flow-reel-detail');
    expect(panel.textContent).toContain('Token: none');
  });
});
