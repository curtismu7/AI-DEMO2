/**
 * MFATestTotpSection — enroll an authenticator app: init shows the otpauth link + secret,
 * the first 6-digit code activates the device.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { post: (...a) => mockPost(...a) },
}));

const { default: MFATestTotpSection } = await import('../MFATestTotpSection');

const KEY_URI = 'otpauth://totp/Demo:user?secret=JBSWY3DP&issuer=Demo';

describe('MFATestTotpSection', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('enrolls, shows the key URI and secret, then activates with the code', async () => {
    mockPost.mockImplementation(async (url) => {
      if (url.endsWith('/enroll-totp-init')) {
        return { data: { success: true, deviceId: 'dev-1', status: 'ACTIVATION_REQUIRED', secret: 'JBSWY3DP', keyUri: KEY_URI } };
      }
      return { data: { success: true, deviceId: 'dev-1', status: 'ACTIVE' } };
    });
    render(<MFATestTotpSection />);

    fireEvent.click(screen.getByTestId('mfa-totp-start'));
    expect(await screen.findByTestId('mfa-totp-keyuri')).toHaveAttribute('href', KEY_URI);
    expect(screen.getByTestId('mfa-totp-secret')).toHaveTextContent('JBSWY3DP');
    expect(mockPost).toHaveBeenCalledWith('/api/mfa/test/integration/enroll-totp-init', {});

    fireEvent.change(screen.getByTestId('mfa-totp-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('mfa-totp-verify'));

    await waitFor(() => expect(screen.getByTestId('mfa-totp-status')).toHaveTextContent('Passed'));
    expect(mockPost).toHaveBeenCalledWith('/api/mfa/test/integration/enroll-totp-complete', { deviceId: 'dev-1', otp: '123456' });
  });

  it('shows the server error when activation fails', async () => {
    mockPost.mockImplementation(async (url) => {
      if (url.endsWith('/enroll-totp-init')) {
        return { data: { success: true, deviceId: 'dev-1', secret: 'S', keyUri: KEY_URI } };
      }
      throw Object.assign(new Error('400'), { response: { data: { error: 'Invalid OTP' } } });
    });
    render(<MFATestTotpSection />);
    fireEvent.click(screen.getByTestId('mfa-totp-start'));
    fireEvent.change(await screen.findByTestId('mfa-totp-code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByTestId('mfa-totp-verify'));

    await waitFor(() => expect(screen.getByTestId('mfa-totp-status')).toHaveTextContent('Failed'));
    expect(screen.getByText(/Invalid OTP/)).toBeInTheDocument();
  });
});
