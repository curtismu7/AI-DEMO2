/**
 * ElicitationModal — AG-UI ELICITATION obligation interrupts.
 *
 * Distinct from GatewayConsentModal (HITL): P1AZ is asking the agent to
 * confirm intent, not requesting human-in-the-loop dashboard approval — no
 * OTP mention, no "Human-in-the-Loop" badge. Reuses the same
 * interrupt/resume mechanism (onApprove/onDismiss wired to the same
 * handleAguiHitlApprove/handleAguiHitlDismiss as HITL), just different copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ElicitationModal from '../ElicitationModal';

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

describe('ElicitationModal', () => {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders the prompt', () => {
    render(
      <ElicitationModal
        show
        prompt="Confirm withdrawal of $500?"
        toolName="create_withdrawal"
        elicitationId="elic-1"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('Confirm withdrawal of $500?')).toBeInTheDocument();
  });

  it('does not show the HITL/human-approval badge', () => {
    render(
      <ElicitationModal
        show
        prompt="Confirm?"
        toolName="create_withdrawal"
        elicitationId="elic-1"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByText(/Human-in-the-Loop/i)).not.toBeInTheDocument();
  });

  it('calls onApprove when Confirm is clicked', () => {
    render(
      <ElicitationModal
        show
        prompt="Confirm?"
        toolName="create_withdrawal"
        elicitationId="elic-1"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Cancel is clicked', () => {
    render(
      <ElicitationModal
        show
        prompt="Confirm?"
        toolName="create_withdrawal"
        elicitationId="elic-1"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render when show=false', () => {
    render(
      <ElicitationModal
        show={false}
        prompt="Confirm?"
        toolName="create_withdrawal"
        elicitationId="elic-1"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByTestId('modal-title')).not.toBeInTheDocument();
  });
});
