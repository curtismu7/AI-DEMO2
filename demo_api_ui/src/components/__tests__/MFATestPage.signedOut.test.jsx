/**
 * MFATestPage — a signed-out visitor sees a sign-in prompt, never the raw "Failed to load config … 401" text.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockOpenSignIn = vi.fn();
vi.mock('../../utils/signInService', () => ({
  openSignIn: (...a) => mockOpenSignIn(...a),
  openAdminSignIn: vi.fn(),
}));

let configError = { response: { status: 401 } };
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn((url) => (String(url).includes('/api/mfa/test/config')
      ? Promise.reject(configError)
      : Promise.resolve({ data: {} }))),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { default: MFATestPage } = await import('../MFATestPage');

describe('MFATestPage when signed out', () => {
  beforeEach(() => { mockOpenSignIn.mockReset(); });

  test('401 on config shows a sign-in prompt instead of an error message', async () => {
    configError = { response: { status: 401 } };
    render(<MFATestPage />);
    expect(await screen.findByTestId('mfa-test-signin-required')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load config/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockOpenSignIn).toHaveBeenCalledWith({ returnTo: window.location.pathname });
  });

  test('other config failures still show the error with Retry', async () => {
    configError = Object.assign(new Error('Network down'), { response: { status: 500 } });
    render(<MFATestPage />);
    await waitFor(() => expect(screen.getByText(/Failed to load config: Network down/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
