/**
 * MFATestForgotPasswordSection — forgot-password MFA check; setting the password is opt-in behind a checkbox.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPost = vi.fn();
const mockPut = vi.fn();
const mockGet = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { post: (...a) => mockPost(...a), put: (...a) => mockPut(...a), get: (...a) => mockGet(...a) },
}));

const { default: MFATestForgotPasswordSection } = await import('../MFATestForgotPasswordSection');

const DEVICES = [{ id: 'dev-1', type: 'EMAIL', email: 'a***@example.com' }, { id: 'dev-2', type: 'SMS', phone: '***1234' }];

async function startAndVerify() {
  render(<MFATestForgotPasswordSection />);
  await waitFor(() => expect(screen.getByTestId('mfa-forgot-username').value).toBe('alice'));
  fireEvent.click(screen.getByTestId('mfa-forgot-start'));
  await screen.findByTestId('mfa-forgot-device-dev-2');
  fireEvent.click(screen.getByTestId('mfa-forgot-device-dev-2'));
  await screen.findByTestId('mfa-forgot-otp');
  fireEvent.change(screen.getByTestId('mfa-forgot-otp'), { target: { value: '424242' } });
  fireEvent.click(screen.getByTestId('mfa-forgot-verify'));
  await waitFor(() => expect(screen.getByTestId('mfa-forgot-status').textContent).toMatch(/Passed/));
}

describe('MFATestForgotPasswordSection', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue({ data: { user: { username: 'alice' } } });
    mockPost.mockReset().mockImplementation(async (url) => {
      if (url.endsWith('/start')) return { data: { daId: 'da-1', status: 'DEVICE_SELECTION_REQUIRED', devices: DEVICES } };
      return { data: { message: 'Password reset.' } };
    });
    mockPut.mockReset().mockImplementation(async (_url, body) => ({
      data: body.otp ? { status: 'COMPLETED', completed: true } : { status: 'OTP_REQUIRED', completed: false },
    }));
  });

  test('start sends the signed-in username and lists the devices', async () => {
    render(<MFATestForgotPasswordSection />);
    await waitFor(() => expect(screen.getByTestId('mfa-forgot-username').value).toBe('alice'));
    fireEvent.click(screen.getByTestId('mfa-forgot-start'));
    await screen.findByTestId('mfa-forgot-device-dev-1');
    expect(mockPost).toHaveBeenCalledWith('/api/auth/mfa/forgot-password/start', { username: 'alice' });
    expect(screen.getByTestId('mfa-forgot-device-dev-2')).toBeTruthy();
  });

  test('verifying the code passes without calling complete', async () => {
    await startAndVerify();
    expect(mockPut).toHaveBeenCalledWith('/api/auth/mfa/challenge/da-1', { deviceId: 'dev-2' });
    expect(mockPut).toHaveBeenCalledWith('/api/auth/mfa/challenge/da-1', { deviceId: 'dev-2', otp: '424242' });
    expect(screen.getByText(/Identity verified/)).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalledWith('/api/auth/mfa/forgot-password/complete', expect.anything());
  });

  test('set new password stays disabled until the real-password checkbox is ticked', async () => {
    await startAndVerify();
    fireEvent.change(screen.getByTestId('mfa-forgot-new-password'), { target: { value: 'N3w-Passw0rd!' } });
    const complete = screen.getByTestId('mfa-forgot-complete');
    const ack = screen.getByTestId('mfa-forgot-ack');
    expect(ack.checked).toBe(false);
    expect(complete.disabled).toBe(true);
    fireEvent.click(ack);
    expect(complete.disabled).toBe(false);
    fireEvent.click(complete);
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/auth/mfa/forgot-password/complete', { newPassword: 'N3w-Passw0rd!' }),
    );
  });
});
