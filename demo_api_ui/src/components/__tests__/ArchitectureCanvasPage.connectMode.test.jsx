import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom has no ResizeObserver — the page only uses it to size the canvas.
global.ResizeObserver = global.ResizeObserver || class {
  observe() {}
  disconnect() {}
};

// react-konva needs a real <canvas> 2D context, which jsdom doesn't provide.
// The Escape-cancel behavior lives in plain React state, not in anything
// Konva draws, so stub the canvas primitives out to plain elements.
vi.mock('react-konva', () => ({
  Stage: ({ children }) => <div>{children}</div>,
  Layer: ({ children }) => <div>{children}</div>,
  Rect: () => null,
  Text: () => null,
  Arrow: () => null,
  Group: ({ children }) => <div>{children}</div>,
  Circle: () => null,
}));

import ArchitectureCanvasPage from '../ArchitectureCanvasPage';

describe('ArchitectureCanvasPage connect mode', () => {
  test('Escape cancels connect mode — no way out otherwise besides the same toggle', () => {
    render(<ArchitectureCanvasPage />);
    const connectBtn = screen.getByRole('button', { name: '⬡ Connect' });

    fireEvent.click(connectBtn);
    expect(screen.getByRole('button', { name: '⬡ Connecting…' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '⬡ Connect' })).toBeInTheDocument();
  });
});
