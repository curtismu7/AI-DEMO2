import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DrawOverlay from '../DrawOverlay';

const mount = () => render(<MemoryRouter><DrawOverlay /></MemoryRouter>);

describe('DrawOverlay', () => {
  it('toggles draw mode with the button and Escape', () => {
    mount();
    const canvas = screen.getByTestId('draw-canvas');
    expect(canvas.className).not.toContain('draw-canvas--on');
    fireEvent.click(screen.getByRole('button', { name: /draw/i }));
    expect(canvas.className).toContain('draw-canvas--on');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(canvas.className).not.toContain('draw-canvas--on');
  });

  it('toggles with Ctrl+Shift+D', () => {
    mount();
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('draw-canvas').className).toContain('draw-canvas--on');
  });
});
