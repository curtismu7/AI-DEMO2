/**
 * MFATestCibaSection — one CIBA test card per delivery channel: initiates via the BFF and polls to a result.
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
      data: {
        auth_req_id: 'req-test', expires_in: 120, interval: 2, binding_message: 'A1B2C3',
        engine: 'pingone', login_hint_display: 'al***@example.com',
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  test('email card sends the hint, short binding message and channel email, then reports approved after polling', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { status: 'pending' } })
      .mockResolvedValueOnce({ data: { status: 'approved', scope: 'openid' } });
    render(<MFATestCibaSection channel="email" loginHint="user@example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('mfa-ciba-start'));
    });
    expect(mockPost).toHaveBeenCalledWith('/api/auth/ciba/initiate', {
      login_hint: 'user@example.com',
      binding_message: 'Approve',
      channel: 'email',
    });
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Waiting for approval/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mockGet).toHaveBeenCalledWith('/api/auth/ciba/poll/req-test');
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Passed: Approved/);
  });

  test('leaving the login hint empty sends none, so the server uses the signed-in user', async () => {
    render(<MFATestCibaSection channel="email" />);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    expect(mockPost).toHaveBeenCalledWith('/api/auth/ciba/initiate', {
      login_hint: undefined,
      binding_message: 'Approve',
      channel: 'email',
    });
  });

  test('shows a prominent sent banner with channel, account and the code to match', async () => {
    render(<MFATestCibaSection channel="email" />);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    const banner = screen.getByTestId('mfa-ciba-sent');
    expect(banner.textContent).toMatch(/Email sent\. Open it and click the approval link\./);
    expect(banner.textContent).toMatch(/al\*\*\*@example\.com/);
    expect(banner.textContent).toMatch(/Code to match: A1B2C3/);
  });

  test('sms card sends channel sms and its banner says a text message was sent', async () => {
    render(<MFATestCibaSection channel="sms" loginHint="user@example.com" />);
    expect(screen.getByText(/texts an approval link/i)).toBeInTheDocument();
    expect(screen.getByTestId('mfa-ciba-start').textContent).toMatch(/text approval/i);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    expect(mockPost).toHaveBeenCalledWith('/api/auth/ciba/initiate', expect.objectContaining({ channel: 'sms' }));
    expect(screen.getByTestId('mfa-ciba-sent').textContent).toMatch(/Text message sent\. Open it on your phone/);
  });

  test('explains a subject mismatch (502 ciba_token_invalid) instead of "status code 502"', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 502, data: { error: 'ciba_token_invalid' } } });
    render(<MFATestCibaSection channel="email" />);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText(/different account than the one signed in/i)).toBeInTheDocument();
    expect(screen.queryByText(/status code 502/)).not.toBeInTheDocument();
  });

  test('shows denied when the poll returns 403', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 403, data: { message: 'nope' } } });
    render(<MFATestCibaSection channel="email" loginHint="user@example.com" />);
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-ciba-start')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('mfa-ciba-status').textContent).toMatch(/Failed: Denied/);
  });

  test('uses the page card styling (no unstyled controls) and caps the binding message at 8 characters', () => {
    const { container } = render(<MFATestCibaSection channel="email" />);
    expect(container.querySelector('.mfa-test-card')).not.toBeNull();
    expect(screen.getByTestId('mfa-ciba-start').className).toContain('mfa-test-button--primary');
    expect(screen.getByTestId('mfa-ciba-message')).toHaveAttribute('maxLength', '8');
    expect(screen.getByTestId('mfa-ciba-message').className).toContain('otp-input');
  });
});
