import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

import DemoArchSlidesPage from '../DemoArchSlidesPage';

describe('/id4ai-slides/identity-for-ai', () => {
  it('renders the pingStyle diagram with numbered arrows, a key and the step detail', async () => {
    render(<MemoryRouter><DemoArchSlidesPage deck="id4ai" slide="identity-for-ai" /></MemoryRouter>);
    expect(document.querySelector('.sfd--ping')).toBeTruthy();
    expect((await screen.findByTestId('sfd-edge-badge-11')).textContent).toContain('11');
    expect(screen.getByLabelText('Arrow key')).toBeTruthy();
    fireEvent.click(screen.getByTestId('id4ai-identity-for-ai-flow-node-core'));
    const panel = screen.getByTestId('id4ai-identity-for-ai-flow-reel-detail');
    expect(panel.textContent).toContain('token-exchange');
    expect(panel.textContent).toContain('MOCK');
    expect(panel.textContent).toContain('Standards behind this step');
  });
});
