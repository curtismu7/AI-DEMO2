/**
 * MFATestStepUpSection — drives the production step-up routes (/api/auth/mfa/challenge*).
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
vi.mock('../../utils/passkeyCeremony', () => ({ authenticateWebAuthn: vi.fn() }));

const { default: apiClient } = await import('../../services/apiClient');
const { authenticateWebAuthn } = await import('../../utils/passkeyCeremony');
const { default: MFATestStepUpSection } = await import('../MFATestStepUpSection');

const SMS = { id: 'dev-sms', type: 'SMS', phone: '+1*****1234' };
const FIDO = { id: 'dev-fido', type: 'FIDO2', nickname: 'MacBook' };
const PUSH = { id: 'dev-push', type: 'MOBILE', nickname: 'Phone' };

const startWith = (devices) => {
  apiClient.post.mockResolvedValue({ data: { daId: 'da-1', status: 'DEVICE_SELECTION_REQUIRED', devices } });
  render(<MFATestStepUpSection />);
  fireEvent.click(screen.getByTestId('mfa-stepup-start'));
};

describe('MFATestStepUpSection', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  test('start lists the devices', async () => {
    startWith([SMS, FIDO]);
    expect(await screen.findByTestId('mfa-stepup-device-dev-sms')).toHaveTextContent('SMS');
    expect(screen.getByTestId('mfa-stepup-device-dev-sms')).toHaveTextContent('+1*****1234');
    expect(screen.getByTestId('mfa-stepup-device-dev-fido')).toHaveTextContent('MacBook');
    expect(apiClient.post).toHaveBeenCalledWith('/api/auth/mfa/challenge');
  });

  test('SMS: pick → OTP → submit → Passed', async () => {
    startWith([SMS]);
    apiClient.put
      .mockResolvedValueOnce({ data: { status: 'OTP_REQUIRED' } })
      .mockResolvedValueOnce({ data: { status: 'COMPLETED', completed: true } });
    fireEvent.click(await screen.findByTestId('mfa-stepup-device-dev-sms'));
    const input = await screen.findByTestId('mfa-stepup-otp');
    expect(apiClient.put).toHaveBeenCalledWith('/api/auth/mfa/challenge/da-1', { deviceId: 'dev-sms' });
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-stepup-otp-submit'));
    expect(await screen.findByText(/Passed/)).toBeInTheDocument();
    expect(apiClient.put).toHaveBeenLastCalledWith('/api/auth/mfa/challenge/da-1', { deviceId: 'dev-sms', otp: '123456' });
  });

  test('server error shows Failed with the server message', async () => {
    startWith([SMS]);
    apiClient.put.mockRejectedValueOnce({ response: { data: { message: 'Device locked' } } });
    fireEvent.click(await screen.findByTestId('mfa-stepup-device-dev-sms'));
    expect(await screen.findByText(/Device locked/)).toBeInTheDocument();
    expect(screen.getByTestId('mfa-stepup-status')).toHaveTextContent('Failed');
  });

  test('FAILED status shows Failed', async () => {
    startWith([SMS]);
    apiClient.put.mockResolvedValueOnce({ data: { status: 'FAILED' } });
    fireEvent.click(await screen.findByTestId('mfa-stepup-device-dev-sms'));
    expect(await screen.findByText(/FAILED/)).toBeInTheDocument();
    expect(screen.getByTestId('mfa-stepup-status')).toHaveTextContent('Failed');
  });

  test('FIDO2: runs WebAuthn with status options and PUTs the assertion', async () => {
    startWith([FIDO]);
    apiClient.put
      .mockResolvedValueOnce({ data: { status: 'ASSERTION_REQUIRED' } })
      .mockResolvedValueOnce({ data: { status: 'COMPLETED', completed: true } });
    apiClient.get.mockResolvedValueOnce({ data: { status: 'ASSERTION_REQUIRED', publicKeyCredentialRequestOptions: '{"challenge":[1]}' } });
    authenticateWebAuthn.mockResolvedValueOnce({ assertionValue: { id: 'cred' } });
    fireEvent.click(await screen.findByTestId('mfa-stepup-device-dev-fido'));
    expect(await screen.findByText(/Passed/)).toBeInTheDocument();
    expect(authenticateWebAuthn).toHaveBeenCalledWith('{"challenge":[1]}');
    expect(apiClient.put).toHaveBeenLastCalledWith('/api/auth/mfa/challenge/da-1', {
      assertion: { id: 'cred' }, origin: window.location.origin,
    });
  });

  test('push: polls status every 2s until COMPLETED', async () => {
    vi.useFakeTimers();
    startWith([PUSH]);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    apiClient.put.mockResolvedValueOnce({ data: { status: 'PUSH_CONFIRMATION_REQUIRED' } });
    apiClient.get
      .mockResolvedValueOnce({ data: { status: 'PUSH_CONFIRMATION_REQUIRED' } })
      .mockResolvedValueOnce({ data: { status: 'COMPLETED', completed: true } });
    fireEvent.click(screen.getByTestId('mfa-stepup-device-dev-push'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('mfa-stepup-cancel')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(apiClient.get).toHaveBeenCalledWith('/api/auth/mfa/challenge/da-1/status');
    expect(screen.getByTestId('mfa-stepup-status')).toHaveTextContent('Passed');
  });

  test('no MOBILE device shows the push note', async () => {
    startWith([SMS]);
    expect(await screen.findByTestId('mfa-stepup-push-note')).toHaveTextContent(/PingOne MFA SDK/);
  });

  test('push note hidden when a MOBILE device exists', async () => {
    startWith([PUSH]);
    await screen.findByTestId('mfa-stepup-device-dev-push');
    expect(screen.queryByTestId('mfa-stepup-push-note')).not.toBeInTheDocument();
  });

  test('simulated push: phone shows the number; Approve -> next poll -> Passed (simulated, no step-up)', async () => {
    vi.useFakeTimers();
    startWith([SMS]);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    apiClient.post.mockResolvedValueOnce({ data: { state: 'pending', numberToMatch: '47', username: 'demouser' } });
    fireEvent.click(screen.getByTestId('mfa-stepup-mockpush'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(apiClient.post).toHaveBeenCalledWith('/api/mfa/test/push-mock/start');
    expect(screen.getByTestId('mfa-stepup-phone')).toHaveTextContent('47');
    apiClient.post.mockResolvedValueOnce({ data: { state: 'approved' } });
    fireEvent.click(screen.getByTestId('mfa-stepup-phone-approve'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(apiClient.post).toHaveBeenCalledWith('/api/mfa/test/push-mock/decision', { decision: 'approve' });
    apiClient.get.mockResolvedValueOnce({ data: { state: 'approved' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(apiClient.get).toHaveBeenCalledWith('/api/mfa/test/push-mock/status');
    expect(screen.getByTestId('mfa-stepup-status')).toHaveTextContent(/Passed/);
    expect(screen.getByText(/simulated/i, { selector: '.mfa-test-card__success-message' })).toBeInTheDocument();
  });

  test('simulated push: Deny -> Failed', async () => {
    vi.useFakeTimers();
    startWith([SMS]);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    apiClient.post.mockResolvedValueOnce({ data: { state: 'pending', numberToMatch: '12', username: 'demouser' } });
    fireEvent.click(screen.getByTestId('mfa-stepup-mockpush'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    apiClient.post.mockResolvedValueOnce({ data: { state: 'denied' } });
    fireEvent.click(screen.getByTestId('mfa-stepup-phone-deny'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    apiClient.get.mockResolvedValueOnce({ data: { state: 'denied' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('mfa-stepup-status')).toHaveTextContent(/Failed/);
  });
});
