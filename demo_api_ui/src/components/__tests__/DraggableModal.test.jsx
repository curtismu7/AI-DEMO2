import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';

describe('DraggableModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it('appends a custom className to the panel alongside dm-panel', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test" className="probe-class">
        <p>body</p>
      </DraggableModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('dm-panel');
    expect(dialog).toHaveClass('probe-class');
  });

  it('renders only dm-panel when no className is passed', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className.trim()).toBe('dm-panel');
  });

  it('keeps pop-out theme changes scoped to the child document', () => {
    document.documentElement.dataset.theme = 'dark';
    const childDocument = document.implementation.createHTMLDocument('Pop-out');
    const childWindow = {
      closed: false,
      document: childDocument,
      addEventListener: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(childWindow);

    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pop out to new window' }));

    expect(childDocument.documentElement.dataset.theme).toBe('dark');
    const themeButton = childDocument.querySelector(
      'button[aria-label="Switch to light mode"]',
    );
    expect(themeButton).toBeTruthy();

    fireEvent.click(themeButton);

    expect(childDocument.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(
      childDocument.querySelector('button[aria-label="Switch to dark mode"]'),
    ).toBeTruthy();

  });

  it('keeps eight resize handles available in embedded mode', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );

    expect(document.querySelectorAll('.dm-panel .dm-handle')).toHaveLength(8);
  });
});
