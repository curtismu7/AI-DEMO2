/**
 * MFATestCibaSection — initiates a real CIBA request via the BFF and polls to a result.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { post: (...a) => mockPost(...a), get: (...a) => mockGet(...a) },
}));

const { default: MFATestCibaSection } = await import('../MFATestCibaSection');

describe('MFATestCibaSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({
      data: { auth_req_id: 'req-test', expires_in: 120, interval: 2, binding_message: 'A1B2C3', engine: 'pingone' },
    });
  });
  afterEach(() => vi.useRealTimers());

  test('sends login_hint + short binding message, then reports approved after polling', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValueOnce({ data: { status: 'approved', scope: 'openid' } });
    render(<MFATestCibaSection loginHint="user@example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('mfa-ciba-start'));
    });
    expect(mockPost).toHaveBeenCalledWith('/api/auth/ciba/initiate', {
      login_hint: 'user@example.com',
      binding_message: 'Approve',
      channel: 'email',
    });
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Waiting for approval/);
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/A1B2C3/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mockGet).toHaveBeenCalledWith('/api/auth/ciba/poll/req-test');
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Approved/);
  });

  test('shows denied when the poll returns 403', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 403, data: { message: 'nope' } } });
    render(<MFATestCibaSection loginHint="user@example.com" />);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Denied/);
  });

  test('sends channel "sms" when the text-message option is chosen', async () => {
    render(<MFATestCibaSection loginHint="user@example.com" />);
    fireEvent.change(screen.getByTestId('mfa-ciba-channel'), { target: { value: 'sms' } });
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    expect(mockPost).toHaveBeenCalledWith('/api/auth/ciba/initiate', expect.objectContaining({ channel: 'sms' }));
  });

  test('binding message input is capped at 8 characters', () => {
    render(<MFATestCibaSection />);
    expect(screen.getByTestId('mfa-ciba-message')).toHaveAttribute('maxLength', '8');
  });
});
