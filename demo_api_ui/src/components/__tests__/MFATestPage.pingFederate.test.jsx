/**
 * MFATestPage under a PingFederate login — the BFF maps the PF session to its
 * linked PingOne user, so the page works as-is: no "switch to PingOne" gate,
 * and the signed-in user's PingOne account is the default test user.
 */
import { render, screen, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';

vi.mock('../../utils/signInService', () => ({ openSignIn: vi.fn(), openAdminSignIn: vi.fn() }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifyInfo: vi.fn(), notifySuccess: vi.fn() }));

const P1_USER = { id: 'p1-uuid', username: 'demoUser', name: 'Demo User' };
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/auth/oauth/user/status')) return Promise.resolve({ data: {
        authenticated: true, loginProvider: 'pingfederate', oauthProvider: 'pingfederate',
        user: { id: 'demouser', username: 'demouser', oauthProvider: 'pingfederate' },
      } });
      if (u.includes('/api/mfa/test/users')) return Promise.resolve({ data: { success: true, users: [P1_USER] } });
      return Promise.resolve({ data: {} });
    }),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const { default: MFATestPage } = await import('../MFATestPage');

test('a PingFederate login gets the MFA page, not the PingOne-only gate', async () => {
  render(<MFATestPage />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/api/mfa/test/config')));
  expect(screen.queryByText('PingOne sign-in required')).not.toBeInTheDocument();
});

test('the PF user is resolved to its PingOne account by username for the default test user', async () => {
  render(<MFATestPage />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/mfa/test/users?q=demouser'));
});
