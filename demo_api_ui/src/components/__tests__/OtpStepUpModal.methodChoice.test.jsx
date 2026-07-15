/**
 * OtpStepUpModal — method choice table always offers Email OTP + SMS + Passkey.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lsStore = Object.create(null);
const mockLocalStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(lsStore, key) ? lsStore[key] : null),
  setItem: (key, value) => { lsStore[key] = String(value); },
  removeItem: (key) => { delete lsStore[key]; },
  clear: () => { Object.keys(lsStore).forEach((k) => { delete lsStore[k]; }); },
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true, writable: true });

vi.mock('../utils/passkeyCeremony', () => ({
  registerPasskey: vi.fn(() => Promise.resolve({ id: 'cred-1' })),
}));

const { default: OtpStepUpModal } = await import('../OtpStepUpModal');

describe('OtpStepUpModal method choice table', () => {
  const baseProps = {
    show: true,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    contextLine: 'Transfer requires MFA',
    userIdentity: { name: 'Demo User', email: 'demo@example.com', phone: '+15551234567' },
    onPasskeyRegistered: vi.fn(() => Promise.resolve({ daId: 'da-1', devices: [] })),
    allowFido: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no WebAuthn; passkey row must still be actionable in demos/tests.
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: function PublicKeyCredential() {},
      configurable: true,
      writable: true,
    });
    global.fetch = vi.fn();
  });

  test('stub mode opens on a table with Email, SMS, and Passkey rows', () => {
    render(<OtpStepUpModal {...baseProps} mode="stub" />);

    expect(screen.getByText(/Choose how you want to verify/i)).toBeInTheDocument();
    expect(screen.getByTestId('mfa-choose-otp')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-choose-sms')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-choose-passkey')).toBeInTheDocument();
    expect(screen.getByText('Email code')).toBeInTheDocument();
    expect(screen.getByText('SMS code')).toBeInTheDocument();
    expect(screen.getByText('Passkey')).toBeInTheDocument();
    // OTP input is not shown until Email code is chosen
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument();
  });

  test('choosing Email code reveals the existing OTP entry UI', () => {
    render(<OtpStepUpModal {...baseProps} mode="stub" />);

    fireEvent.click(screen.getByTestId('mfa-choose-otp'));

    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
    expect(screen.getByText(/Enter the 6-digit code from your email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Methods/i })).toBeInTheDocument();
  });

  test('choosing SMS without an enrolled device opens phone enrollment', () => {
    render(<OtpStepUpModal {...baseProps} mode="stub" />);

    fireEvent.click(screen.getByTestId('mfa-choose-sms'));

    expect(screen.getByTestId('mfa-sms-enroll-phone')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('+15551234567')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send activation code/i })).toBeInTheDocument();
  });

  test('SMS enroll init+complete uses PingOne endpoints then challenges the device', async () => {
    const smsDevice = { id: 'd-sms', type: 'SMS', phone: { number: '+15551234567' } };
    global.fetch = vi.fn()
      // sms-init
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deviceId: 'enroll-1', status: 'ACTIVATION_REQUIRED' }),
      })
      // sms-complete
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deviceId: 'enroll-1', status: 'ACTIVE' }),
      });

    const onPasskeyRegistered = vi.fn(async () => ({
      daId: 'da-fresh',
      devices: [smsDevice],
    }));

    // After refresh, selectDevice PUT → OTP_REQUIRED
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'OTP_REQUIRED' }),
      });

    render(
      <OtpStepUpModal
        {...baseProps}
        mode="stub"
        onPasskeyRegistered={onPasskeyRegistered}
      />,
    );

    fireEvent.click(screen.getByTestId('mfa-choose-sms'));
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '5551234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send activation code/i }));

    await waitFor(() => expect(screen.getByTestId('mfa-sms-enroll-otp')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/mfa/enroll/sms-init'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '+15551234567' }),
      }),
    );

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123123' } });
    fireEvent.click(screen.getByRole('button', { name: /Activate SMS/i }));

    await waitFor(() => expect(onPasskeyRegistered).toHaveBeenCalled());
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/mfa/challenge/da-fresh'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ deviceId: 'd-sms' }),
        }),
      ),
    );
  });

  test('p1mfa enrolled SMS selects the device and requests OTP', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OTP_REQUIRED' }),
    });

    render(
      <OtpStepUpModal
        {...baseProps}
        mode="p1mfa"
        daId="da-99"
        devices={[
          { id: 'd-email', type: 'EMAIL', name: 'demo@example.com' },
          { id: 'd-sms', type: 'SMS', phone: { number: '+15559876543' } },
          { id: 'd-fido', type: 'FIDO2', name: 'MacBook Passkey' },
        ]}
      />,
    );

    expect(screen.getByTestId('mfa-choose-sms')).toHaveTextContent(/Continue/);
    fireEvent.click(screen.getByTestId('mfa-choose-sms'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/mfa/challenge/da-99'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ deviceId: 'd-sms' }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Enter the 6-digit code from your text message/i)).toBeInTheDocument(),
    );
  });

  test('Back to Methods restores the choice table without losing OTP flow', () => {
    render(<OtpStepUpModal {...baseProps} mode="stub" />);

    fireEvent.click(screen.getByTestId('mfa-choose-otp'));
    fireEvent.click(screen.getByRole('button', { name: /Methods/i }));

    expect(screen.getByTestId('mfa-choose-otp')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-choose-sms')).toBeInTheDocument();
    expect(screen.getByTestId('mfa-choose-passkey')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument();
  });

  test('stub OTP submit still calls onSubmit with the code', async () => {
    const onSubmit = vi.fn();
    render(<OtpStepUpModal {...baseProps} mode="stub" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId('mfa-choose-otp'));
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('123123'));
  });
});
