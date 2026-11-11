/**
 * AgentConsentModal — HITL consent modal (three modes).
 *
 * Mode 1 — HITL agent action  (hitlContext prop)
 * Mode 2 — High-risk transaction  (transaction prop)
 * Mode 3 — Legacy agent access  (no hitlContext/transaction)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentConsentModal from '../AgentConsentModal';

// Stub DraggableModal — renders children + footer inline so tests stay simple.
vi.mock('../DraggableModal', () => ({
  default: ({ children, footer, title, placement }) => (
    <div data-placement={placement}>
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

  it('uses the centered modal placement for approval requests', () => {
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId('modal-title').parentElement).toHaveAttribute(
      'data-placement',
      'center',
    );
  });

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

  it('Agree & Continue is inactive (aria-disabled, still focusable) until the checkbox is checked', () => {
    render(
      <AgentConsentModal
        hitlContext={{ tool: 'create_transfer' }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /Agree & Continue/i });
    // aria-disabled, not `disabled`: the button keeps keyboard focus and explains itself.
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    const reason = document.getElementById(btn.getAttribute('aria-describedby'));
    expect(reason).toHaveTextContent('Tick the box above to turn on Agree & Continue.');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).not.toHaveAttribute('aria-disabled');
    expect(btn).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/Tick the box above/)).not.toBeInTheDocument();
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

describe('AgentConsentModal — honest wording (no one-time code)', () => {
  const tx = { type: 'transfer', amount: 750, fromAccountId: 'CHK-001', toAccountId: 'SAV-002', description: 'Monthly savings sweep' };
  const cases = {
    'hitlContext': <AgentConsentModal hitlContext={{ tool: 'create_transfer' }} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    'transaction': <AgentConsentModal transaction={tx} onAccept={vi.fn()} onDismiss={vi.fn()} />,
  };
  for (const [mode, el] of Object.entries(cases)) {
    it(`${mode}: says what happens, and never promises a one-time code`, () => {
      const { container } = render(el);
      const items = [...container.querySelectorAll('.acm-assurances li')].map((li) => li.textContent);
      expect(items).toEqual([
        'Your decision is recorded in the audit trail',
        'The agent waits for your decision and cannot proceed without it',
        'If this action needs more verification, such as an MFA prompt, you are asked for it after you approve',
      ]);
      expect(container.textContent).not.toMatch(/one-time code|registered (contact|email)/i);
    });
  }
});

describe('AgentConsentModal — inactive primary style', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'AgentConsentModal.css'), 'utf8');
  const indexCss = fs.readFileSync(path.resolve(__dirname, '..', '..', 'index.css'), 'utf8');
  const pingUi = fs.readFileSync(path.resolve(__dirname, '..', '..', 'styles', 'ping-ui.css'), 'utf8');
  const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleBody = (src, selector) => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const out = [];
    let m;
    while ((m = re.exec(strip(src)))) if (m[1].replace(/\s+/g, ' ').trim() === selector) out.push(m[2]);
    return out.join('\n');
  };
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it('the inactive state never fades the button with opacity', () => {
    const body = ruleBody(css, '.acm-btn--primary:disabled,\n.acm-btn--primary[aria-disabled="true"]'.replace('\n', ' '));
    expect(body).toContain('var(--btn-accent-inactive-gradient)');
    expect(body).toContain('color: var(--btn-accent-text)');
    expect(body).toContain('1px dashed');
    expect(body).not.toMatch(/opacity/);
  });

  it('the shared .pu-btn--primary inactive rules (disabled and aria-disabled) are full opacity, never 0.88', () => {
    for (const sel of [
      ".pu-page button.pu-btn.pu-btn--primary:disabled",
      ".pu-page button.pu-btn.pu-btn--primary[aria-disabled='true']",
    ]) {
      const body = ruleBody(pingUi, sel);
      expect(body, sel).toMatch(/opacity:\s*1;/);
      expect(body, sel).toContain('var(--btn-accent-inactive-gradient)');
      expect(body, sel).toContain('1px dashed');
    }
    expect(strip(pingUi)).not.toMatch(/pu-btn--primary[^{]*\{[^}]*opacity:\s*0\.88/);
  });

  it('white label on both inactive gradient stops clears 4.5:1 (resolved from the index.css tokens)', () => {
    const root = ruleBody(indexCss, ':root');
    const grad = root.match(/--btn-accent-inactive-gradient:\s*linear-gradient\(90deg,\s*(#[0-9a-f]{6}) 55%,\s*(#[0-9a-f]{6})\)/i);
    expect(grad).toBeTruthy();
    const label = root.match(/--btn-accent-text:\s*(#[0-9a-f]{6})/i)[1];
    for (const stop of [grad[1], grad[2]]) expect(ratio(label, stop)).toBeGreaterThanOrEqual(4.5);
    // Active gradient stays Ping Red; the dark theme only changes the edge, so the label ratio is the same in both themes.
    // The inactive stops are the neutral grey from the standalone family's shared sheet (#636b74 / #565e66): 5.40 and 6.59.
    expect(ratio(label, grad[1])).toBeCloseTo(5.4, 1);
    expect(ruleBody(indexCss, ':root[data-theme="dark"]')).not.toContain('--btn-accent-inactive');
  });
});
