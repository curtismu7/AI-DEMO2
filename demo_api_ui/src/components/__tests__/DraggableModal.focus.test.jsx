import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DraggableModal from '../DraggableModal';
import ConfirmModal from '../ConfirmModal';

// Opener button + a modal it opens, the shape every page uses.
function Harness({ modalProps = {}, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      <button type="button">other page button</button>
      <DraggableModal isOpen={open} onClose={() => setOpen(false)} title="Probe" {...modalProps}>
        {children ?? <><button type="button">first</button><button type="button">second</button></>}
      </DraggableModal>
    </div>
  );
}

// Every control reachable by Tab, in DOM order, is inside the dialog: the page buttons never get focus while it is open.
const insideDialog = () => screen.getByRole('dialog').contains(document.activeElement);

describe('DraggableModal focus management', () => {
  it('moves focus into the dialog on open, and the dialog has a name', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('dialog', { name: 'Probe' })).toBeInTheDocument();
    expect(insideDialog()).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps Tab and Shift+Tab inside the dialog (wraps at both ends)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    const seen = new Set();
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(insideDialog()).toBe(true);
      seen.add(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent);
    }
    expect(seen.has('first')).toBe(true);
    expect(seen.has('second')).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      await user.tab({ shift: true });
      expect(insideDialog()).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'other page button' })).not.toHaveFocus();
  });

  it('pulls Tab back in when focus is somewhere behind the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    screen.getByRole('button', { name: 'other page button' }).focus();
    await user.tab();
    expect(insideDialog()).toBe(true);
  });

  it('Escape closes it and focus returns to the opener, not <body>', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('the Close button also returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });
    await user.click(opener);
    await user.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.classList.contains('dm-close-btn')));
    expect(opener).toHaveFocus();
  });

  it('keeps focus on a field the content already focused (autoFocus) instead of stealing it', async () => {
    const user = userEvent.setup();
    render(<Harness>{<input aria-label="name" autoFocus />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByLabelText('name')).toHaveFocus();
  });

  it('focuses a [data-autofocus] control when the content marks one', async () => {
    const user = userEvent.setup();
    render(<Harness><button type="button">a</button><button type="button" data-autofocus>primary</button></Harness>);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('button', { name: 'primary' })).toHaveFocus();
  });

  it('a non-modal floating panel (noBackdrop) neither takes focus nor traps Tab', async () => {
    const user = userEvent.setup();
    render(<Harness modalProps={{ noBackdrop: true }} />);
    const opener = screen.getByRole('button', { name: 'opener' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(opener).toHaveFocus();
    // Tab from the opener goes to the next page control, not into the panel.
    await user.tab();
    expect(screen.getByRole('button', { name: 'other page button' })).toHaveFocus();
  });

  it('with two modals open only the top one holds Tab', async () => {
    const user = userEvent.setup();
    function Two() {
      const [inner, setInner] = useState(false);
      return (
        <>
          <DraggableModal isOpen onClose={vi.fn()} title="Outer">
            <button type="button" onClick={() => setInner(true)}>open inner</button>
          </DraggableModal>
          <DraggableModal isOpen={inner} onClose={() => setInner(false)} title="Inner">
            <button type="button">inner action</button>
          </DraggableModal>
        </>
      );
    }
    render(<Two />);
    await user.click(screen.getByRole('button', { name: 'open inner' }));
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(inner.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(inner.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).not.toBeInTheDocument();
  });

  it('a required gate with no onClose still takes focus and traps Tab', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">page</button>
        <DraggableModal isOpen title="Gate" footer={<button type="button">Sign in</button>}>
          <p>You must sign in.</p>
        </DraggableModal>
      </>,
    );
    expect(screen.getByRole('dialog', { name: 'Gate' }).contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Gate' })).toBeInTheDocument();
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(screen.getByRole('dialog', { name: 'Gate' }).contains(document.activeElement)).toBe(true);
    }
  });
});

describe('ConfirmModal (the admin gate) focus management', () => {
  it('takes focus, traps Tab between Cancel / Confirm, and Escape cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmModal isOpen title="Admin sign-in required" message="msg" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Admin sign-in required' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 9; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
