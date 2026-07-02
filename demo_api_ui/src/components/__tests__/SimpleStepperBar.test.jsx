// demo_api_ui/src/components/__tests__/SimpleStepperBar.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimpleStepperBar from '../SimpleStepperBar';

// -- Mock TokenChainContext ----------------------------------------------------
let _mockCtx = null;
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => _mockCtx,
}));

// -- Mock the panel so bar tests don't exercise portal/drag internals ----------
vi.mock('../SimpleStepperPanel', () => ({
  default: ({ isOpen, onClose }) =>
    isOpen ? (
      <div data-testid="ssp-panel">
        <button type="button" onClick={onClose}>mock-close</button>
      </div>
    ) : null,
}));

beforeEach(() => {
  localStorage.clear();
  _mockCtx = null;
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

describe('SimpleStepperBar', () => {
  it('renders null outside the TokenChainContext provider', () => {
    _mockCtx = null;
    const { container } = render(<SimpleStepperBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the Simple Stepper title and step count', () => {
    _mockCtx = { events: [makeEvent({ id: 'a' }), makeEvent({ id: 'b' }), makeEvent({ id: 'c' })] };
    render(<SimpleStepperBar />);
    expect(screen.getByText('Simple Stepper')).toBeTruthy();
    expect(screen.getByLabelText('3 steps')).toBeTruthy();
  });

  it('panel is closed by default on first visit', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });

  it('Show opens the panel; Hide closes it', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByTestId('ssp-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
  });

  it("the panel's onClose closes the panel and resets the toggle to Show", () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    fireEvent.click(screen.getByRole('button', { name: 'mock-close' }));
    expect(screen.queryByTestId('ssp-panel')).toBeNull();
    expect(screen.getByRole('button', { name: /show/i })).toBeTruthy();
  });

  it('persists open state under ba_simple_stepper_open', () => {
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(localStorage.getItem('ba_simple_stepper_open')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(localStorage.getItem('ba_simple_stepper_open')).toBe('false');
  });

  it('restores open state from localStorage on mount', () => {
    localStorage.setItem('ba_simple_stepper_open', 'true');
    _mockCtx = { events: [makeEvent()] };
    render(<SimpleStepperBar />);
    expect(screen.getByTestId('ssp-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: /hide/i })).toBeTruthy();
  });
});
