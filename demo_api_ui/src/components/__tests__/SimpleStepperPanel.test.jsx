// demo_api_ui/src/components/__tests__/SimpleStepperPanel.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SimpleStepperPanel from '../SimpleStepperPanel';

const { draggableModalProps } = vi.hoisted(() => ({ draggableModalProps: [] }));

vi.mock('../DraggableModal', () => ({
  default: ({ isOpen, onClose, title, children, ...props }) => {
    draggableModalProps.push({ isOpen, onClose, title, ...props });
    return isOpen ? (
      <div role="dialog" aria-label={title}>
        <button type="button" aria-label="Close Simple Stepper" onClick={onClose}>Close</button>
        {children}
      </div>
    ) : null;
  },
}));

// -- Mock TokenChainContext (real one SSE-connects) ----------------------------
let _mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => _mockCtx,
}));

// -- Mock named exports from TokenChainDisplay ---------------------------------
vi.mock('../TokenChainDisplay', () => ({
  isHaltedAt: (events, i) => events[i]?.isHaltedStep === true,
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

// -- Mock product attribution so chip rendering is deterministic ---------------
vi.mock('../../utils/pingProducts', () => ({
  productForEvent: (ev) => ev.product || null,
}));
vi.mock('../PingProductChip', () => ({
  PingProductChip: ({ product }) => <span data-testid="product-chip">{String(product)}</span>,
}));

beforeEach(() => {
  // Reset localStorage mock if available (Node.js v22+ fallback)
  if (globalThis._createLocalStorageMock) {
    globalThis.localStorage = globalThis._createLocalStorageMock();
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  _mockCtx = null;
  draggableModalProps.length = 0;
});

function makeEvent(overrides) {
  return {
    id: 'step-1',
    label: 'User Token',
    status: 'success',
    timestamp: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('SimpleStepperPanel', () => {
  it('renders null when isOpen is false', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperPanel isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders null outside the TokenChainContext provider', () => {
    _mockCtx = null;
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a dialog titled Simple Stepper with one numbered row per event', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'User Token' }),
        makeEvent({ id: 'a2a-agent1-actor', label: 'old agent label' }),
      ],
    };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: /simple stepper/i })).toBeTruthy();
    const rows = screen.getAllByRole('row'); // 1 header + 2 body
    expect(rows.length).toBe(3);
    expect(screen.getByText('User Token')).toBeTruthy();
    expect(screen.getByText('Banking Agent · Generalist agent actor')).toBeTruthy();
    // numbered in order
    expect(rows[1].textContent).toMatch(/^1/);
    expect(rows[2].textContent).toMatch(/^2/);
  });

  it('uses the shared modal with the Simple Stepper sizing and chrome contract', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);

    expect(draggableModalProps).toContainEqual(expect.objectContaining({
      isOpen: true,
      title: 'Simple Stepper',
      storageKey: 'sstp-modal',
      noBackdrop: true,
      footer: null,
      defaultWidth: 560,
      defaultHeight: 480,
      minWidth: 360,
      minHeight: 240,
    }));
  });

  it('marks the halted row and greys rows after it', () => {
    _mockCtx = {
      events: [
        makeEvent({ id: 'a', label: 'Good Step', status: 'success' }),
        makeEvent({ id: 'b', label: 'Bad Step', status: 'failed', isHaltedStep: true, errorCode: 'intent_mismatch' }),
        makeEvent({ id: 'c', label: 'Ghost Step', status: 'waiting' }),
      ],
    };
    const { baseElement } = render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    const halted = baseElement.querySelectorAll('.sstp-row--halted');
    expect(halted.length).toBe(1);
    expect(halted[0].textContent).toContain('Bad Step');
    expect(halted[0].textContent).toContain('intent_mismatch');
    const ghosts = baseElement.querySelectorAll('.sstp-row--ghost');
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].textContent).toContain('Ghost Step');
    expect(ghosts[0].textContent).toContain('did not run');
  });

  it('renders a product chip when productForEvent matches', () => {
    _mockCtx = { events: [makeEvent({ product: 'pingone' })] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByTestId('product-chip').textContent).toBe('pingone');
  });

  it('shows the empty state when there are no events', () => {
    _mockCtx = { events: [] };
    render(<SimpleStepperPanel isOpen onClose={() => {}} />);
    expect(screen.getByText(/no token events yet/i)).toBeTruthy();
  });

  it('calls onClose when the close button is clicked', () => {
    _mockCtx = { events: [makeEvent()] };
    const onClose = vi.fn();
    render(<SimpleStepperPanel isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close simple stepper/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

});
