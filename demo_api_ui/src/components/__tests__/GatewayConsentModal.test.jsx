/**
 * GatewayConsentModal — AG-UI HITL interrupts.
 *
 * challengeType='consent'  → checkbox + Agree & Continue
 * challengeType='step_up'  → delegates to FidoStepUpModal
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GatewayConsentModal from '../GatewayConsentModal';

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

// Stub FidoStepUpModal so step_up tests don't need WebAuthn
vi.mock('../FidoStepUpModal', () => ({
  default: ({ show, onSubmit, onCancel, contextLine }) =>
    show ? (
      <div data-testid="fido-step-up">
        <p>{contextLine}</p>
        <button onClick={onSubmit}>Fido Submit</button>
        <button onClick={onCancel}>Fido Cancel</button>
      </div>
    ) : null,
}));

describe('GatewayConsentModal — consent type', () => {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders the modal title and HITL badge', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        challengeId="ch-abc"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Action Requires Your Approval');
    expect(screen.getByText(/Human-in-the-Loop/i)).toBeInTheDocument();
  });

  it('displays the challengeId when provided', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        challengeId="ch-xyz-99"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/ch-xyz-99/)).toBeInTheDocument();
  });

  it('displays formatted expiry when expiresAt is provided', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        expiresAt="2099-01-01T12:30:00Z"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/Expires:/i)).toBeInTheDocument();
  });

  it('Agree & Continue is disabled until the checkbox is checked', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /Agree.*Continue/i });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).not.toBeDisabled();
  });

  it('calls onApprove after checking the box and clicking Agree & Continue', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Agree.*Continue/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Cancel is clicked', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="consent"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render when show=false', () => {
    render(
      <GatewayConsentModal
        show={false}
        challengeType="consent"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByTestId('modal-title')).not.toBeInTheDocument();
  });
});

describe('GatewayConsentModal — step_up type', () => {
  const onApprove = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('delegates to FidoStepUpModal instead of rendering the consent card', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="step_up"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('fido-step-up')).toBeInTheDocument();
    expect(screen.queryByTestId('modal-title')).not.toBeInTheDocument();
  });

  it('FidoStepUpModal receives the identity-verification context line', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="step_up"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/identity verification/i)).toBeInTheDocument();
  });

  it('FidoStepUpModal onSubmit proxies to onApprove', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="step_up"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fido Submit' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('FidoStepUpModal onCancel proxies to onDismiss', () => {
    render(
      <GatewayConsentModal
        show
        challengeType="step_up"
        onApprove={onApprove}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fido Cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
