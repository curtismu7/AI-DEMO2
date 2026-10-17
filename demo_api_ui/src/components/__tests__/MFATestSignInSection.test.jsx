/**
 * MFATestSignInSection — launches the app's real sign-in pop-up in each MFA mode.
 */
import { render, screen, fireEvent } from '@testing-library/react';

const mockOpenSignIn = vi.fn();
const mockOpenAdminSignIn = vi.fn();
vi.mock('../../utils/signInService', () => ({
  openSignIn: (...a) => mockOpenSignIn(...a),
  openAdminSignIn: (...a) => mockOpenAdminSignIn(...a),
}));
vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { authenticated: true, loginProvider: 'pingfederate', user: { username: 'demouser' } } })) },
}));

const { default: MFATestSignInSection } = await import('../MFATestSignInSection');

beforeEach(() => { mockOpenSignIn.mockReset(); mockOpenAdminSignIn.mockReset(); window.history.replaceState(null, '', '/mfa-test'); });

test('shows the session and the provider the pop-up will use', async () => {
  render(<MFATestSignInSection />);
  expect(await screen.findByTestId('mfa-signin-session')).toHaveTextContent(/demouser.*PingFederate/);
});

test('device-first opens the customer pop-up with a forced sign-in back to this page', () => {
  render(<MFATestSignInSection />);
  fireEvent.click(screen.getByTestId('mfa-signin-device'));
  expect(mockOpenSignIn).toHaveBeenCalledWith({ returnTo: '/mfa-test', force: true });
  expect(window.location.search).toBe('');
});

test('password + MFA sets ?signin=mfa (the Multi_Factor selector) before opening the pop-up', () => {
  render(<MFATestSignInSection />);
  fireEvent.click(screen.getByTestId('mfa-signin-mfa'));
  expect(window.location.search).toBe('?signin=mfa');
  expect(mockOpenSignIn).toHaveBeenCalledWith({ returnTo: '/mfa-test?signin=mfa', force: true });
});

test('admin opens the admin pop-up', () => {
  render(<MFATestSignInSection />);
  fireEvent.click(screen.getByTestId('mfa-signin-admin'));
  expect(mockOpenAdminSignIn).toHaveBeenCalledWith({ returnTo: '/mfa-test', force: true });
});
