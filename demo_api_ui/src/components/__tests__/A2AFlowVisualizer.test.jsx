// demo_api_ui/src/components/__tests__/A2AFlowVisualizer.test.jsx
//
// Guards the animated A2A flow visualizer: it must render one packet per
// token event from a REAL captured run (the same anti-rot fixture the
// learning page replays), place packets on identity vs wire planes, expose
// the act depth + scope the chain actually narrowed to, and expand the real
// evidence JSON on click. buildA2aChainDetail (and thus the page's diagram
// contract) is exercised separately by a2aChainDetail.test.js.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { A2A_RECORDED_RUN } from '../../data/a2aRecordedRun';
import { buildA2aChainDetail } from '../../utils/a2aChainDetail';
import A2AFlowVisualizer from '../A2AFlowVisualizer';

// @xyflow/react needs ResizeObserver in jsdom (same stub ReactFlowPocPage.test.jsx uses).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// jsdom lacks DOMMatrixReadOnly / has no real layout for the xyflow renderer;
// silence the canvas measurement warnings.
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

describe('A2AFlowVisualizer — token canvas (default)', () => {
  it('renders the React Flow token canvas by default', () => {
    render(<A2AFlowVisualizer tokenEvents={A2A_RECORDED_RUN.tokenEvents} />);
    expect(document.querySelector('[data-testid="a2t-token-flow-diagram"]')).not.toBeNull();
    expect(screen.getByText(/step 1 \/ 8/i)).toBeInTheDocument();
  });
});

describe('A2AFlowVisualizer — timeline mode', () => {
  async function renderTimeline() {
    const user = (await import('@testing-library/user-event')).default.setup();
    const utils = render(<A2AFlowVisualizer tokenEvents={A2A_RECORDED_RUN.tokenEvents} />);
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    return user;
  }

  it('renders one packet per token event from the real captured run', async () => {
    await renderTimeline();
    expect(document.querySelectorAll('.a2fv-packet')).toHaveLength(
      A2A_RECORDED_RUN.tokenEvents.length,
    );
  });

  it('labels the identity and wire planes and narrows scope/act evidence', async () => {
    const detail = buildA2aChainDetail(A2A_RECORDED_RUN.tokenEvents);
    await renderTimeline();
    expect(screen.getByText(/identity · rfc 8693/i)).toBeInTheDocument();
    expect(screen.getByText(/wire · a2a protocol/i)).toBeInTheDocument();
    // Scope narrowed to membership:read at Exchange #2, act chain depth 2.
    expect(screen.getByText('membership:read')).toBeInTheDocument();
    expect(screen.getByText(/act ×2/)).toBeInTheDocument();
    // Both exchanges and the JSON-RPC handoff are present as packets.
    expect(screen.getByText(/exchange #1 · rfc 8693/i)).toBeInTheDocument();
    expect(screen.getByText(/exchange #2 · nested act/i)).toBeInTheDocument();
    expect(screen.getByText(/sendmessage · json-rpc/i)).toBeInTheDocument();
  });

  it('expands the real claims JSON for a packet on click', async () => {
    const user = await renderTimeline();

    const ex2 = screen.getByText(/exchange #2 · nested act/i).closest('button');
    await user.click(ex2);

    const detail = document.querySelector('.a2fv-detail');
    expect(detail).not.toBeNull();
    const json = detail.querySelector('.a2fv-detail-json');
    expect(json.textContent).toContain('"membership:read"');
    // Nested act: specialist acting for the generalist.
    expect(json.textContent).toContain('"act"');
  });

  it('renders nothing when the run has no events', () => {
    render(<A2AFlowVisualizer tokenEvents={[]} />);
    expect(document.querySelector('.a2fv')).toBeNull();
  });
});
