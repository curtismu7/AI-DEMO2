import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node (handle bounds come from that report).
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

import EmbeddedFlowDiagram from './EmbeddedFlowDiagram';
import { RFC, DRAFT } from '../config/pingStyleStandards';

const config = {
  GROUPS: { a: { label: 'App', bg: '#151a24' }, p: { label: 'Ping', bg: '#b5231a' } },
  NODES: [
    { id: 'app', group: 'a', label: 'App', x: 0, y: 0 },
    { id: 'as', group: 'p', label: 'Auth Server', x: 300, y: 0 },
    { id: 'rs', group: 'a', label: 'Resource', x: 600, y: 0 },
  ],
  EDGES: [['app', 'as', 'token request'], ['as', 'app', 'token', { dashed: true }], ['app', 'rs', 'call']],
  STEPS: [
    {
      key: 'req', edges: [0, 1], title: 'Get a token', what: 'w', why: 'y',
      detail: {
        form: 'POST /as/token grant_type=client_credentials',
        tokens: [{ note: 'Access token', claims: { sub: 'agent1' } }],
        refs: [RFC(6749, 'OAuth 2.0'), DRAFT('draft-ietf-oauth-v2-1', 'OAuth 2.1')],
      },
    },
    { key: 'call', edges: [2], title: 'Call', what: 'w' },
  ],
};

describe('EmbeddedFlowDiagram pingStyle', () => {
  it('is unchanged by default: no badges, no key, no ping class', () => {
    render(<EmbeddedFlowDiagram config={config} title="T" lede="L" testId="efd" />);
    expect(screen.queryByTestId('sfd-edge-badge-1')).toBeNull();
    expect(document.querySelector('.sfd--ping')).toBeNull();
    expect(document.querySelector('.sfd-ping-key')).toBeNull();
  });

  it('renders a numbered badge per arrow and the key', async () => {
    render(<EmbeddedFlowDiagram config={config} title="T" lede="L" testId="efd" pingStyle />);
    expect(document.querySelector('.sfd--ping')).toBeTruthy();
    expect((await screen.findByTestId('sfd-edge-badge-1')).textContent).toContain('1');
    expect(screen.getByTestId('sfd-edge-badge-3').textContent).toContain('3');
    expect(screen.getByLabelText('Arrow key')).toBeTruthy();
  });

  it('shows the step detail (form, MOCK token, refs with emerging marked) for the arrows of a step', () => {
    render(<EmbeddedFlowDiagram config={config} title="T" lede="L" testId="efd" pingStyle />);
    fireEvent.click(screen.getAllByRole('button', { name: /App → Auth Server/ })[0]);
    const panel = screen.getByTestId('efd-flow-reel-detail');
    expect(panel.textContent).toContain('POST /as/token');
    expect(panel.textContent).toContain('MOCK, teaching values only');
    expect(screen.getByTestId('efd-flow-reel-refs').textContent).toContain('RFC 6749');
    expect(screen.getByTestId('efd-flow-reel-refs').textContent).toContain('emerging');
    // the second arrow of the same STEP shows the same detail
    fireEvent.click(screen.getAllByRole('button', { name: /Auth Server → App/ })[0]);
    expect(screen.getByTestId('efd-flow-reel-refs').textContent).toContain('OAuth 2.1');
  });

  it('a box click selects it and jumps the reel to its first arrow (into it, else out of it)', () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(<EmbeddedFlowDiagram config={config} title="T" lede="L" testId="efd" pingStyle />);
    fireEvent.click(screen.getByTestId('efd-flow-node-rs'));
    expect(screen.getByTestId('efd-flow-node-rs').className).toContain('sfd-node--selected');
    expect(screen.getByTestId('efd-flow-reel-detail').textContent).toContain('Resource');
    // App has no arrow into it from index 0 but one at index 1: first arrow INTO it
    fireEvent.click(screen.getByTestId('efd-flow-node-app'));
    expect(screen.getByTestId('efd-flow-reel-detail').textContent).toContain('Auth Server → App');
  });

  it('shows the words on an arrow only for the active step or on hover', async () => {
    render(<EmbeddedFlowDiagram config={config} title="T" lede="L" testId="efd" pingStyle />);
    const badge = await screen.findByTestId('sfd-edge-badge-3');
    expect(badge.className).not.toContain('is-shown');
    fireEvent.mouseEnter(badge);
    expect(badge.className).toContain('is-shown');
    fireEvent.mouseLeave(badge);
    expect(badge.className).not.toContain('is-shown');
    fireEvent.click(screen.getAllByRole('button', { name: /App → Resource/ })[0]);
    expect(screen.getByTestId('sfd-edge-badge-3').className).toContain('is-shown');
  });
});
