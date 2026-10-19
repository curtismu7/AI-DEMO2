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

import McpGatewayOauthFlowPage from '../McpGatewayOauthFlowPage';

describe('McpGatewayOauthFlowPage in the Ping style', () => {
  it('both figures are pingStyle diagrams with the arrow key', () => {
    render(<McpGatewayOauthFlowPage />);
    expect(document.querySelectorAll('.sfd--ping').length).toBe(2);
    expect(screen.getAllByLabelText('Arrow key').length).toBe(2);
  });

  it('a sequence card opens the request, the MOCK tokens of the exchange and the standards', () => {
    render(<McpGatewayOauthFlowPage />);
    // the token exchange is step 16: gateway -> the second PingOne box
    fireEvent.click(screen.getByRole('button', { name: /Agent Gateway \(OAuth RS\) → PingOne \(token exchange\)/ }));
    const panel = screen.getByTestId('mgof-seq-flow-reel-detail');
    expect(panel.textContent).toContain('grant_type=urn:ietf:params:oauth:grant-type:token-exchange');
    expect(panel.textContent).toContain('Token: Access token');
    expect(panel.textContent).toContain('Token: Actor token');
    expect(panel.textContent).toContain('MOCK, teaching values only');
    expect(panel.textContent).toContain('RFC 8693');
  });

  it('clicking the gateway box jumps to its first arrow and shows that step', async () => {
    render(<McpGatewayOauthFlowPage />);
    fireEvent.click(await screen.findByTestId('mgof-arch-flow-node-G'));
    expect(screen.getByTestId('mgof-arch-flow-reel-detail').textContent).toContain('(no Authorization header)');
  });

  it('keeps the reference diagram\'s four phases and the privilege-first variant note', () => {
    render(<McpGatewayOauthFlowPage />);
    const phases = screen.getByLabelText('Phases of the handshake');
    ['Initialization', 'User authentication and consent', 'Session init', 'Tool discovery'].forEach((t) => expect(phases.textContent).toContain(t));
    expect(document.querySelector('.mgof-variant a').getAttribute('href')).toBe('/privilege-first-gateway');
    expect(document.querySelector('.mgof-variant').textContent).toContain('ff_mcp_gateway_privilege_first');
  });

  it('keeps the .mmd download for both figures', () => {
    render(<McpGatewayOauthFlowPage />);
    expect(screen.getAllByRole('button', { name: 'Download .mmd' }).length).toBe(2);
  });
});
