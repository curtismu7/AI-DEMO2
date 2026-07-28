import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';

describe('DraggableModal', () => {
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
});
