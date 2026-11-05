import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('anchors right-side drawers to the viewport edge', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test" placement="right">
        <p>body</p>
      </DraggableModal>,
    );

    expect(screen.getByRole('dialog')).toHaveStyle({
      left: 'auto',
      right: '0px',
      top: '0px',
      height: '100vh',
    });
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
  it('drags from a body strip marked data-drag-handle, but not from its buttons or the rest of the body', () => {
    render(
      <DraggableModal isOpen onClose={vi.fn()} title="Test">
        <div data-testid="strip" data-drag-handle="true">
          <span>label</span>
          <button type="button">zoom</button>
        </div>
        <p>plain body</p>
      </DraggableModal>,
    );
    const dialog = screen.getByRole('dialog');
    const left = () => dialog.style.left;
    // jsdom has no PointerEvent, so build the move as a MouseEvent (carries clientX/Y) named pointermove.
    const down = (el) => act(() => { el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true, cancelable: true })); });
    const move = (el) => act(() => { el.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, clientY: 140, bubbles: true })); });
    const before = left();

    down(screen.getByText('plain body'));
    move(screen.getByText('plain body'));
    expect(left()).toBe(before);

    down(screen.getByText('zoom'));
    move(screen.getByText('zoom'));
    expect(left()).toBe(before);

    const strip = screen.getByTestId('strip');
    down(screen.getByText('label'));
    move(strip.parentElement);
    expect(left()).not.toBe(before);
  });
});
