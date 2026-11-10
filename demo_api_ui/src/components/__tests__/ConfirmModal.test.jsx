import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ConfirmModal from '../ConfirmModal';

// Shared by AdminSideNav, TopNav, Dashboard, UserDashboardPing2026, OAuthTokenDisplayPage, DotMemoryPanel,
// DigitalWorkerPage, PersonalAgentStudioPage and RequireAdminLogin. The destructive variant used the legacy flat
// `btn-danger` look; it now reads the same fixed Ping Red tokens as every other primary.
describe('ConfirmModal buttons', () => {
  const renderModal = (props = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmModal isOpen title="Sign out?" message="msg" confirmLabel="Sign Out" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
    return { onConfirm, onCancel };
  };

  it.each([[false], [true]])('has exactly one primary (the confirm) and a secondary Cancel when danger=%s', (danger) => {
    renderModal({ danger });
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    const primaries = [...dialog.querySelectorAll('.btn-primary')];
    expect(primaries.map((b) => b.textContent)).toEqual(['Sign Out']);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn-secondary');
    expect(dialog.querySelector('.btn-danger')).toBeNull();
  });

  it('marks the destructive confirm without changing its look', () => {
    renderModal({ danger: true });
    expect(screen.getByRole('button', { name: 'Sign Out' })).toHaveAttribute('data-danger', 'true');
  });

  it('does not mark a plain confirm', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Sign Out' })).not.toHaveAttribute('data-danger');
  });

  it('still calls onConfirm and onCancel', async () => {
    const user = userEvent.setup();
    const { onConfirm, onCancel } = renderModal({ danger: true });
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
