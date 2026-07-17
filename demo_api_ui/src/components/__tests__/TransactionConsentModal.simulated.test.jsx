/**
 * Simulate mode ("Transaction Consent — Simulate") previews the consent modal
 * with no live challenge behind it, so approving must never call the server —
 * there is no challenge for it to confirm and the POST 404s.
 *
 * The `simulated` flag carries that, NOT `preloadedSnapshot`: the dashboard and
 * agent HITL flows preload a snapshot for a REAL challenge and must still POST.
 * The second test pins that distinction, since collapsing the two would silently
 * break every real consent approval.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react'; // eslint-disable-line no-unused-vars -- JSX transform needs React in scope
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/bffAxios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/appToast', () => ({
  notifyError: vi.fn(), notifyWarning: vi.fn(), notifySuccess: vi.fn(),
}));
vi.mock('../../services/agentAccessConsent', () => ({
  setAgentBlockedByConsentDecline: vi.fn(),
}));
vi.mock('../../context/EducationUIContext', () => ({
  useEducationUI: () => ({ openPanel: vi.fn(), isPanelOpen: () => false }),
}));
vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({ preset: {} }),
}));

import bffAxios from '../../services/bffAxios';
import TransactionConsentModal from '../TransactionConsentModal';

const USER = { id: 'user-1', email: 'demo@ping.demo' };
const SNAPSHOT = { amount: 500, type: 'transfer', description: 'Monthly rent payment' };

function renderModal(props = {}) {
  return render(
    <TransactionConsentModal
      open
      challengeId="simulate-demo"
      user={USER}
      preloadedSnapshot={SNAPSHOT}
      onClose={() => {}}
      onTransactionSuccess={() => {}}
      onDeclinedConfirmed={() => {}}
      {...props}
    />,
  );
}

async function approve() {
  const agree = await screen.findByRole('checkbox');
  fireEvent.click(agree);
  fireEvent.click(await screen.findByText(/agree & continue/i));
}

describe('TransactionConsentModal — simulate mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bffAxios.get.mockResolvedValue({ data: { accounts: [] } });
  });

  it('approving in simulate mode does not POST to the server', async () => {
    const onTransactionSuccess = vi.fn();
    renderModal({ simulated: true, onTransactionSuccess });

    await approve();

    await waitFor(() => expect(onTransactionSuccess).toHaveBeenCalled());
    // The real defect: this POST 404s (challenge_not_found) — no challenge exists.
    expect(bffAxios.post).not.toHaveBeenCalled();
  });

  it('approving a REAL preloaded challenge still POSTs to confirm', async () => {
    bffAxios.post.mockResolvedValue({ data: { otpSent: true } });
    renderModal({ challengeId: 'real-challenge-123' }); // simulated defaults to false

    await approve();

    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    expect(bffAxios.post.mock.calls[0][0]).toContain(
      '/api/transactions/consent-challenge/real-challenge-123/confirm',
    );
  });
});
