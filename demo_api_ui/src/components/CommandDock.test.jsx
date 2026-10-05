import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import CommandDock from './CommandDock';

const realHeight = window.innerHeight;

function panelHeightAt(innerHeight) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  const { container } = render(
    <CommandDock open onOpenChange={() => {}}>
      <div>dock content</div>
    </CommandDock>,
  );
  const panel = (container.ownerDocument || document).querySelector('.cmd-dock-panel');
  return panel && panel.style.height;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: realHeight });
});

describe('CommandDock height', () => {
  it('is tall enough for the whole dock (not capped at 720) on a normal desktop window', () => {
    expect(panelHeightAt(1000)).toBe('900px');
  });

  it('fills the window minus a margin when the window is shorter than the cap', () => {
    expect(panelHeightAt(800)).toBe('776px');
  });

  it('never goes below the 320px floor', () => {
    expect(panelHeightAt(300)).toBe('320px');
  });
});

describe('CommandDock Save button', () => {
  it('closes the dock when clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <CommandDock open onOpenChange={onOpenChange}>
        <div>dock content</div>
      </CommandDock>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sits after the dock content, at the bottom of the body', () => {
    const { container } = render(
      <CommandDock open onOpenChange={() => {}}>
        <div>dock content</div>
      </CommandDock>,
    );
    const body = (container.ownerDocument || document).querySelector('.cmd-dock-body');
    expect(body.lastElementChild.className).toBe('cmd-dock-footer');
    expect(body.lastElementChild.querySelector('button.cmd-dock-save')).not.toBeNull();
  });
});
