import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  test('Ping All shows each service status from the response; a failed call flags down, not the whole map', async () => {
    const { container } = render(<ArchitectureCanvasPage />);

    // 200 with a results array: dot statuses come from the response.
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'frontend', status: 'up', ms: 3 }, { id: 'bff', status: 'down', ms: 3000 }] }),
      });
    fireEvent.click(screen.getByRole('button', { name: 'Ping All' }));
    await waitFor(() => {
      expect(container.querySelector('.react-flow__node[data-id="frontend"] .cv-card__dot--up')).not.toBeNull();
    });
    expect(container.querySelector('.react-flow__node[data-id="bff"] .cv-card__dot--down')).not.toBeNull();
    fetchMock.mockRestore();

    // 404 (route missing): everything flags down rather than staying "pinging".
    const fetch404 = vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: false, status: 404, json: async () => ({ error: 'not found' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ping All' }));
    await waitFor(() => {
      expect(container.querySelector('.cv-card__dot--down')).not.toBeNull();
    });
    expect(container.querySelector('.cv-card__dot--pinging')).toBeNull();
    fetch404.mockRestore();
  });

  afterEach(() => vi.restoreAllMocks());
});
