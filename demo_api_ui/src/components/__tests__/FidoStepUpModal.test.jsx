/**
 * FidoStepUpModal — passkey step-up modal.
 *
 * Driven entirely by window CustomEvents:
 *   'fido-verification-success' → calls onSubmit
 *   'fido-verification-error'   → shows error
 *
 * Buttons: "Use Code Instead" (fallbackToOtp), "Cancel" (onCancel)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FidoStepUpModal from '../FidoStepUpModal';

vi.mock('../DraggableModal', () => ({
  default: ({ children, footer, title, isOpen }) =>
    isOpen ? (
      <div>
        <div data-testid="modal-title">{title}</div>
        {children}
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
}));

// react-icons stub
vi.mock('react-icons/md', () => ({ MdError: () => <span data-testid="icon-error" /> }));

describe('FidoStepUpModal', () => {
  const onSubmit     = vi.fn();
  const onCancel     = vi.fn();
  const fallbackToOtp = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders "Verify with Passkey" title and waiting state when show=true', () => {
    render(
      <FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Verify with Passkey');
    expect(screen.getByText(/Waiting for passkey verification/i)).toBeInTheDocument();
  });

  it('renders the contextLine prop', () => {
    render(
      <FidoStepUpModal
        show
        contextLine="Step-up required to approve transfer"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('Step-up required to approve transfer')).toBeInTheDocument();
  });

  it('does not render the modal when show=false', () => {
    render(
      <FidoStepUpModal show={false} onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.queryByTestId('modal-title')).not.toBeInTheDocument();
  });

  it('calls onSubmit with credentialResponse on fido-verification-success', () => {
    render(<FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fido-verification-success', {
          detail: { credentialResponse: { id: 'cred-abc' } },
        }),
      );
    });
    expect(onSubmit).toHaveBeenCalledWith({ id: 'cred-abc' });
  });

  it('ignores fido-verification-success without credentialResponse', () => {
    render(<FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('fido-verification-success', { detail: {} }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error message on fido-verification-error event', () => {
    render(<FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fido-verification-error', {
          detail: { message: 'User cancelled passkey' },
        }),
      );
    });
    expect(screen.getByText('User cancelled passkey')).toBeInTheDocument();
  });

  it('shows fallback error text when fido-verification-error has no message', () => {
    render(<FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />);
    act(() => {
      window.dispatchEvent(new CustomEvent('fido-verification-error', { detail: {} }));
    });
    expect(screen.getByText(/Passkey verification failed/i)).toBeInTheDocument();
  });

  it('"Use Code Instead" calls fallbackToOtp', () => {
    render(
      <FidoStepUpModal
        show
        onSubmit={onSubmit}
        onCancel={onCancel}
        fallbackToOtp={fallbackToOtp}
      />,
    );
    // Both footer buttons are disabled while waiting; dispatch error first to unblock
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fido-verification-error', { detail: { message: 'err' } }),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: /Use Code Instead/i }));
    expect(fallbackToOtp).toHaveBeenCalledTimes(1);
  });

  it('"Cancel" calls onCancel', () => {
    render(<FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('fido-verification-error', { detail: { message: 'err' } }),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cleans up event listeners when unmounted', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <FidoStepUpModal show onSubmit={onSubmit} onCancel={onCancel} />,
    );
    unmount();
    expect(remove).toHaveBeenCalledWith('fido-verification-success', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('fido-verification-error', expect.any(Function));
  });
});
