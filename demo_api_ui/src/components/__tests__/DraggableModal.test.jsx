import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';

function makeChildWindow() {
  const childDocument = document.implementation.createHTMLDocument('Pop-out');
  const nativeWrite = childDocument.write.bind(childDocument);
  Object.defineProperty(childDocument, 'defaultView', { value: window });
  childDocument.write = vi.fn((markup) => {
    nativeWrite(markup);
    const theme = /<html data-theme="([^"]+)">/.exec(markup)?.[1];
    if (theme) childDocument.documentElement.dataset.theme = theme;
  });
  return {
    closed: false,
    document: childDocument,
    addEventListener: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
  };
}

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

  it('uses the shared modal pop-out icon in the embedded title bar', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );

    const popoutButton = screen.getByTitle('Pop out to new window');
    expect(popoutButton).toHaveTextContent('🪟');
  });

  it('keeps pop-out theme changes scoped to the child document', () => {
    document.documentElement.dataset.theme = 'dark';
    const childWindow = makeChildWindow();
    const { document: childDocument } = childWindow;
    vi.spyOn(window, 'open').mockReturnValue(childWindow);

    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <p>body</p>
      </DraggableModal>,
    );

    fireEvent.click(screen.getByTitle('Pop out to new window'));

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

  it('closes the child window when its upper-right close control is clicked', () => {
    const childWindow = makeChildWindow();
    const onClose = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue(childWindow);

    render(
      <DraggableModal isOpen onClose={onClose} title="Test">
        <p>body</p>
      </DraggableModal>,
    );

    fireEvent.click(screen.getByTitle('Pop out to new window'));
    const closeButton = childWindow.document.querySelector('button[title="Close"]');
    expect(closeButton).toBeTruthy();

    fireEvent.click(closeButton);

    expect(childWindow.close).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
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
