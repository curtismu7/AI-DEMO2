/**
 * MFATestConsentSection — the dashboard's HITL transaction-consent flow on the MFA test page.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { post: (...a) => mockPost(...a), get: (...a) => mockGet(...a) },
}));
vi.mock('../TransactionConsentModal', () => ({
  default: (props) => (
    <div data-testid="consent-modal-stub">
      <span data-testid="stub-challenge">{props.challengeId}</span>
      <span data-testid="stub-user">{props.user?.id}</span>
      <span data-testid="stub-snapshot">{props.preloadedSnapshot?.amount}</span>
      <button onClick={() => props.onTransactionSuccess('Consent verified.')}>approve</button>
      <button onClick={() => props.onDeclinedConfirmed()}>decline</button>
      <button onClick={() => props.onClose()}>close</button>
    </div>
  ),
}));

const { default: MFATestConsentSection } = await import('../MFATestConsentSection');

const ACCOUNTS = [
  { id: 'acc-chk', accountType: 'checking', accountNumber: 'CHK-1', balance: 1000 },
  { id: 'acc-sav', accountType: 'savings', accountNumber: 'SAV-1', balance: 500 },
];

async function renderLoaded() {
  mockGet.mockImplementation((url) =>
    url === '/api/accounts/my'
      ? Promise.resolve({ data: { accounts: ACCOUNTS } })
      : Promise.resolve({ data: { authenticated: true, user: { id: 'u-1' } } }),
  );
  await act(async () => { render(<MFATestConsentSection />); });
}

async function startChallenge() {
  mockPost.mockResolvedValueOnce({
    data: { challengeId: 'chal-1234567890', expiresAt: 'x', snapshot: { amount: 25 } },
  });
  await act(async () => { fireEvent.click(screen.getByTestId('mfa-consent-start')); });
}

describe('MFATestConsentSection', () => {
  beforeEach(() => { mockPost.mockReset(); mockGet.mockReset(); });

  test('loads accounts from /api/accounts/my and defaults amount to 25', async () => {
    await renderLoaded();
    expect(mockGet).toHaveBeenCalledWith('/api/accounts/my');
    expect(screen.getByTestId('mfa-consent-amount').value).toBe('25');
    expect(screen.getByTestId('mfa-consent-from').value).toBe('acc-chk');
    expect(screen.getByTestId('mfa-consent-to').value).toBe('acc-sav');
    expect(screen.getByText(/moves demo money between your demo accounts/)).toBeTruthy();
  });

  test('creates the transfer challenge and opens the consent modal with the dashboard props', async () => {
    await renderLoaded();
    await startChallenge();
    expect(mockPost).toHaveBeenCalledWith('/api/transactions/consent-challenge', {
      type: 'transfer', amount: 25, fromAccountId: 'acc-chk', toAccountId: 'acc-sav',
    });
    expect(screen.getByTestId('stub-challenge').textContent).toBe('chal-1234567890');
    expect(screen.getByTestId('stub-user').textContent).toBe('u-1');
    expect(screen.getByTestId('stub-snapshot').textContent).toBe('25');
    expect(screen.getByTestId('mfa-consent-challenge').textContent).toMatch(/chal-123/);
  });

  test('approval re-fires the transfer with the challenge id, like the dashboard, and passes', async () => {
    await renderLoaded();
    await startChallenge();
    mockPost.mockResolvedValueOnce({ data: {} });
    await act(async () => { fireEvent.click(screen.getByText('approve')); });
    expect(mockPost).toHaveBeenLastCalledWith('/api/transactions', {
      type: 'transfer', amount: 25, fromAccountId: 'acc-chk', toAccountId: 'acc-sav',
      consentChallengeId: 'chal-1234567890',
    });
    expect(screen.getByTestId('mfa-consent-status').textContent).toMatch(/Passed/);
    expect(screen.queryByTestId('consent-modal-stub')).toBeNull();
  });

  test('decline fails with "Declined"', async () => {
    await renderLoaded();
    await startChallenge();
    await act(async () => { fireEvent.click(screen.getByText('decline')); });
    expect(screen.getByTestId('mfa-consent-status').textContent).toMatch(/Failed: Declined/);
  });

  test('closing the modal returns to idle', async () => {
    await renderLoaded();
    await startChallenge();
    await act(async () => { fireEvent.click(screen.getByText('close')); });
    expect(screen.queryByTestId('consent-modal-stub')).toBeNull();
    expect(screen.getByTestId('mfa-consent-status').textContent).toMatch(/Pending: Not started/);
  });

  test('challenge creation error is shown as failed', async () => {
    await renderLoaded();
    mockPost.mockRejectedValueOnce({ response: { data: { message: 'Amount too low' } } });
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-consent-start')); });
    expect(screen.getByTestId('mfa-consent-status').textContent).toMatch(/Failed/);
    expect(screen.getByText(/Amount too low/)).toBeTruthy();
  });
});
