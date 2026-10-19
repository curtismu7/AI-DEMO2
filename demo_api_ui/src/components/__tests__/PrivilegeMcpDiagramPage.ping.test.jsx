import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

import PrivilegeMcpDiagramPage from '../PrivilegeMcpDiagramPage';

describe('PrivilegeMcpDiagramPage in the Ping style', () => {
  it('every tab is a pingStyle diagram with the arrow key', () => {
    render(<PrivilegeMcpDiagramPage />);
    ['Architecture', 'Sign-in + Tool Call', 'Auth Flow'].forEach((name) => {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(document.querySelector('.sfd--ping')).toBeTruthy();
      expect(screen.getByLabelText('Arrow key')).toBeTruthy();
    });
  });

  it('a reel card opens the request, the MOCK token and the standards for that step', async () => {
    render(<PrivilegeMcpDiagramPage />);
    expect((await screen.findByTestId('sfd-edge-badge-1')).textContent).toContain('1');
    fireEvent.click(screen.getAllByRole('button', { name: /BFF → Authorization server/ })[0]);
    const panel = screen.getByTestId('pmd-arch-flow-reel-detail');
    expect(panel.textContent).toContain('grant_type=client_credentials');
    expect(panel.textContent).toContain('Token: Operator access token');
    expect(panel.textContent).toContain('MOCK, teaching values only');
    expect(panel.textContent).toContain('RFC 7636');
  });

  it('clicking a box jumps to its first arrow and shows that step', async () => {
    render(<PrivilegeMcpDiagramPage />);
    fireEvent.click(await screen.findByTestId('pmd-arch-flow-node-gw'));
    const panel = screen.getByTestId('pmd-arch-flow-reel-detail');
    expect(panel.textContent).toContain('MCP-Session-Id');
  });
});
