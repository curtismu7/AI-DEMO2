import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArchitectureCanvasPage from '../ArchitectureCanvasPage';

describe('ArchitectureCanvasPage (React Flow)', () => {
  beforeEach(() => localStorage.clear());

  test('draws the architecture as React Flow cards, not a canvas', () => {
    const { container } = render(<ArchitectureCanvasPage />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelectorAll('.cv-card').length).toBeGreaterThan(5);
    expect(screen.getByText('Agent Gateway')).toBeInTheDocument();
  });

  test('selecting a flow shows the shared Play/Step bar and a movie reel; a reel click jumps to that step', () => {
    render(<ArchitectureCanvasPage />);
    expect(screen.queryByTestId('canvas-reel')).toBeNull();
    fireEvent.change(screen.getByLabelText('Flow'), { target: { value: 'hitl' } });
    expect(screen.getByTestId('canvas-step-bar')).toBeInTheDocument();
    const reel = screen.getByTestId('canvas-reel');
    const cards = reel.querySelectorAll('.dreel-card');
    expect(cards.length).toBe(7);
    fireEvent.click(cards[3]);
    expect(reel.querySelector('.dreel-card--now')).toBe(cards[3]);
  });

  test('adding a box puts a new card on the canvas', () => {
    const { container } = render(<ArchitectureCanvasPage />);
    const before = container.querySelectorAll('.cv-card').length;
    fireEvent.change(screen.getByPlaceholderText('New box name…'), { target: { value: 'Audit Log' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(container.querySelectorAll('.cv-card').length).toBe(before + 1);
  });
});
