/**
 * AgentConsentModal — HITL consent modal (three modes).
 *
 * Mode 1 — HITL agent action  (hitlContext prop)
 * Mode 2 — High-risk transaction  (transaction prop)
 * Mode 3 — Legacy agent access  (no hitlContext/transaction)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentConsentModal from '../AgentConsentModal';

// Stub DraggableModal — renders children + footer inline so tests stay simple.
vi.mock('../DraggableModal', () => ({
  default: ({ children, footer, title }) => (
    <div>
      <div data-testid="modal-title">{title}</div>
      {children}
      <div data-testid="modal-footer">{footer}</div>
    </div>
  ),
}));
vi.mock('../IntentAuthDecisionDisplay', () => ({
  default: ({ decision }) => <div data-testid="intent-decision">{decision?.intent}</div>,
}));

describe('AgentConsentModal — HITL mode (hitlContext)', () => {
  const onAccept  = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => { vi.clearAllMocks(); });

  it('shows "Authorize Agent Action" title and the tool name', () => {
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer', reason: 'User requested a transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Authorize Agent Action');
    expect(screen.getByText('Create Transfer')).toBeInTheDocument();
    expect(screen.getByText('User requested a transfer')).toBeInTheDocument();
  });

  it('Agree & Continue is disabled until the checkbox is checked', () => {
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /Agree & Continue/i });
    expect(btn).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).not.toBeDisabled();
  });

  it('calls onAccept after checkbox + Agree & Continue', async () => {
    onAccept.mockResolvedValue(undefined);
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Agree & Continue/i }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  });

  it('shows error message and re-enables button when onAccept throws', async () => {
    onAccept.mockRejectedValue(new Error('HITL rejected'));
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Agree & Continue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HITL rejected');
    expect(screen.getByRole('button', { name: /Agree & Continue/i })).not.toBeDisabled();
  });

  it('calls onDismiss when Cancel is clicked', () => {
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('AgentConsentModal — transaction mode', () => {
  const onAccept  = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => { vi.clearAllMocks(); });

  const tx = {
    type: 'transfer',
    amount: 750,
    fromAccountId: 'CHK-001',
    toAccountId:   'SAV-002',
    description:   'Monthly savings sweep',
  };

  it('shows the transaction title, amount, from/to accounts', () => {
    render(
      <AgentConsentModal
        transaction={tx}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Authorize');
    expect(screen.getByText(/750|$750/)).toBeInTheDocument();
    expect(screen.getByText('CHK-001')).toBeInTheDocument();
    expect(screen.getByText('SAV-002')).toBeInTheDocument();
  });

  it('shows high-value warning when amount >= hitlThreshold', () => {
    render(
      <AgentConsentModal
        transaction={tx}
        hitlThreshold={500}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText(/exceeds/i)).toBeInTheDocument();
  });

  it('does NOT show high-value warning when amount < threshold', () => {
    render(
      <AgentConsentModal
        transaction={{ ...tx, amount: 100 }}
        hitlThreshold={500}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByText(/exceeds/i)).not.toBeInTheDocument();
  });

  it('renders intentAuthDecision when provided', () => {
    render(
      <AgentConsentModal
        transaction={tx}
        intentAuthDecision={{ intent: 'transfer_funds', confidence: 0.97 }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('intent-decision')).toHaveTextContent('transfer_funds');
  });

  it('does not show amount row when amount is zero (non-monetary action)', () => {
    render(
      <AgentConsentModal
        transaction={{ type: 'checkout', amount: 0, description: 'Cart checkout' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});

describe('AgentConsentModal — legacy agent access mode', () => {
  const onAccept  = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('shows "Allow AI Agent Access" title with no checkbox', () => {
    render(
      <AgentConsentModal onAccept={onAccept} onDismiss={onDismiss} />,
    );
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Allow AI Agent Access');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('"Allow" button is enabled without a checkbox', () => {
    render(
      <AgentConsentModal onAccept={onAccept} onDismiss={onDismiss} />,
    );
    expect(screen.getByRole('button', { name: /Allow/i })).not.toBeDisabled();
  });

  it('POSTs to /api/auth/oauth/user/consent and calls onAccept on success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ consentId: 'c-1' }),
    });
    render(
      <AgentConsentModal onAccept={onAccept} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Allow/i }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/oauth/user/consent',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith({ consentId: 'c-1' }));
  });

  it('shows server error and re-enables button on fetch failure', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal error' }),
    });
    render(
      <AgentConsentModal onAccept={onAccept} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Allow/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal error');
    expect(screen.getByRole('button', { name: /Allow/i })).not.toBeDisabled();
  });
});
