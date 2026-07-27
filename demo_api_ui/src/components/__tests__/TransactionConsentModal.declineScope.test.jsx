/**
 * Declining is the CONSENT decision, not "I gave up on the verification code".
 *
 * Dismissing the modal (titlebar ✕ / Escape / backdrop) routes through
 * handleCancelClick. Before this fix that opened the "Confirm decline" dialog at
 * ANY step, so abandoning an expired OTP disabled the whole AI assistant and the
 * only way out was a sign-out or a browser reload. These tests pin that the
 * lockout fires only from the consent review step.
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
  useEducationUI: () => ({ open: vi.fn(), openPanel: vi.fn(), isPanelOpen: () => false }),
}));
vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({ preset: {} }),
}));

import bffAxios from '../../services/bffAxios';
import { setAgentBlockedByConsentDecline } from '../../services/agentAccessConsent';
import TransactionConsentModal from '../TransactionConsentModal';

const USER = { id: 'user-1', email: 'demo@ping.demo' };
const SNAPSHOT = { amount: 600, type: 'transfer', description: 'Checking to savings' };

function renderModal(props = {}) {
  return render(
    <TransactionConsentModal
      open
      challengeId="challenge-123"
      user={USER}
      preloadedSnapshot={SNAPSHOT}
      onClose={() => {}}
      onTransactionSuccess={() => {}}
      onDeclinedConfirmed={() => {}}
      {...props}
    />,
  );
}

const pressEscape = () => fireEvent.keyDown(document, { key: 'Escape' });

describe('TransactionConsentModal — what counts as a decline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bffAxios.get.mockResolvedValue({ data: { accounts: [] } });
  });

  it('dismissing at the consent review step declines and blocks the agent', async () => {
    const onDeclinedConfirmed = vi.fn();
    renderModal({ onDeclinedConfirmed });
    await screen.findByText(/agree & continue/i);

    pressEscape();

    fireEvent.click(await screen.findByText(/confirm decline/i));
    expect(setAgentBlockedByConsentDecline).toHaveBeenCalledWith(true);
    expect(onDeclinedConfirmed).toHaveBeenCalled();
  });

  it('dismissing at the OTP step aborts without blocking the agent', async () => {
    bffAxios.post.mockResolvedValue({ data: { otpSent: true, maskedContact: 'd***@ping.demo' } });
    const onClose = vi.fn();
    const onDeclinedConfirmed = vi.fn();
    renderModal({ onClose, onDeclinedConfirmed });

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(await screen.findByText(/agree & continue/i));
    await screen.findByLabelText(/6-digit verification code/i);

    pressEscape();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/confirm decline/i)).toBeNull();
    expect(setAgentBlockedByConsentDecline).not.toHaveBeenCalledWith(true);
    expect(onDeclinedConfirmed).not.toHaveBeenCalled();
  });
});
