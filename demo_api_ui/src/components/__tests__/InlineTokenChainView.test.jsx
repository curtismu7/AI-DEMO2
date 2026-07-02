// demo_api_ui/src/components/__tests__/InlineTokenChainView.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InlineTokenChainView from '../InlineTokenChainView';

// -- Mock TokenChainContext ----------------------------------------------------
// The real context SSE-connects; we replace the hook with a controllable stub.
let _mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => _mockCtx,
}));

// -- Mock named exports from TokenChainDisplay (A4.1 exports) -----------------
vi.mock('../TokenChainDisplay', () => ({
  isHaltedAt: (events, i) => {
    const ev = events[i];
    if (!ev) return false;
    if (ev.isHaltedStep === true) return true;
    return false;
  },
  resolveStatusVisual: (status) => {
    const map = {
      success: { bucket: 'success', label: 'Success' },
      failed: { bucket: 'failed', label: 'Failed' },
      acquiring: { bucket: 'acquiring', label: 'Acquiring' },
      waiting: { bucket: 'waiting', label: 'Waiting' },
    };
    return map[status] || { bucket: 'failed', label: status || 'Unknown' };
  },
  default: () => null,
}));

// -- localStorage stub ---------------------------------------------------------
beforeEach(() => {
  // Reset localStorage mock if available (Node.js v22+ fallback)
  if (globalThis._createLocalStorageMock) {
    globalThis.localStorage = globalThis._createLocalStorageMock();
  }
  localStorage.clear();
  _mockCtx = null;
});

// -- Helpers ------------------------------------------------------------------
function makeEvent(overrides) {
  return {
    id: 'step-1',
    label: 'User Token',
    status: 'success',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('InlineTokenChainView', () => {
  it('renders null when outside TokenChainContext provider', () => {
    _mockCtx = null;
    const { container } = render(<InlineTokenChainView />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the header bar when context is present but events is empty', () => {
    _mockCtx = { events: [] };
    render(<InlineTokenChainView />);
    expect(screen.getByText('Token Chain')).toBeTruthy();
  });

  it('shows "No token events yet" when visible and empty', () => {
    _mockCtx = { events: [] };
    render(<InlineTokenChainView />);
    expect(screen.getByText(/No token events yet/i)).toBeTruthy();
  });

  it('renders a step pill for each event', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'User Token', status: 'success' }),
        makeEvent({ id: 'b', label: 'Agent Token', status: 'success' }),
      ],
    };
    render(<InlineTokenChainView />);
    expect(screen.getByText('User Token')).toBeTruthy();
    expect(screen.getByText('Agent Token')).toBeTruthy();
  });

  it('shows step count badge', () => {
    _mockCtx = {
      events: [makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })],
    };
    render(<InlineTokenChainView />);
    expect(screen.getByLabelText('3 steps')).toBeTruthy();
  });

  it('hides the flow row when Hide is clicked', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<InlineTokenChainView />);
    const btn = screen.getByRole('button', { name: /hide/i });
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });

  it('re-shows the flow row when Show is clicked after Hide', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<InlineTokenChainView />);
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('applies itcv-step--halted class to the halted step', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'Good Step', status: 'success' }),
        makeEvent({ id: 'b', label: 'Bad Step', status: 'failed', isHaltedStep: true }),
        makeEvent({ id: 'c', label: 'Next Step', status: 'waiting' }),
      ],
    };
    const { container } = render(<InlineTokenChainView />);
    const haltedPills = container.querySelectorAll('.itcv-step--halted');
    expect(haltedPills.length).toBe(1);
    expect(haltedPills[0].textContent).toContain('Bad Step');
  });

  it('applies itcv-step--ghost class to steps after the halted step', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'Good Step', status: 'success' }),
        makeEvent({ id: 'b', label: 'Halted', status: 'failed', isHaltedStep: true }),
        makeEvent({ id: 'c', label: 'Ghost Step', status: 'waiting' }),
      ],
    };
    const { container } = render(<InlineTokenChainView />);
    const ghostPills = container.querySelectorAll('.itcv-step--ghost');
    expect(ghostPills.length).toBe(1);
    expect(ghostPills[0].textContent).toContain('Ghost Step');
  });

  it('does not render ghost or halted classes when no step is halted', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', status: 'success' }),
        makeEvent({ id: 'b', status: 'success' }),
      ],
    };
    const { container } = render(<InlineTokenChainView />);
    expect(container.querySelectorAll('.itcv-step--halted').length).toBe(0);
    expect(container.querySelectorAll('.itcv-step--ghost').length).toBe(0);
  });

  it('persists visible state to localStorage', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<InlineTokenChainView />);
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(localStorage.getItem('ba_inline_tc_show')).toBe('false');
  });

  it('loads collapsed state from localStorage on mount', () => {
    localStorage.setItem('ba_inline_tc_show', 'false');
    _mockCtx = { events: [makeEvent()] };
    render(<InlineTokenChainView />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });
});
