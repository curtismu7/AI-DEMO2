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
let pfDown = false;
let mappedId = 'p1-uuid';
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/auth/oauth/user/status')) return Promise.resolve({ data: {
        authenticated: true, loginProvider: 'pingfederate', oauthProvider: 'pingfederate',
        user: { id: 'demouser', username: 'demouser', oauthProvider: 'pingfederate' },
      } });
      if (u.includes('/api/mfa/test/users')) return Promise.resolve({ data: { success: true, users: [P1_USER] } });
      if (u.includes('/api/mfa/test/session-user')) return Promise.resolve({ data: { provider: 'pingfederate', username: 'demouser', pingOneUserId: mappedId } });
      if (u.includes('/api/auth/pingfederate/status')) return Promise.resolve({ data: { down: pfDown } });
      if (u.includes('/api/mfa/test/worker-token')) return Promise.resolve({ data: { success: true, status: 'valid' } });
      if (u.includes('/api/mfa/test/config')) return Promise.resolve({ data: { mfaEnabled: true } });
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

describe('PingFederate credentials line', () => {
  beforeEach(() => { pfDown = false; mappedId = 'p1-uuid'; });

  test('shows PF reachable and the PingOne account MFA runs on; pill is Ready', async () => {
    render(<MFATestPage />);
    const line = await screen.findByTestId('mfa-credentials-line');
    await waitFor(() => expect(line).toHaveTextContent(/PingFederate: reachable/));
    expect(line).toHaveTextContent(/MFA runs on PingOne.*demouser.*p1-uuid/);
    expect(await screen.findByText(/Ready/)).toBeInTheDocument();
  });

  test('PF down: the pill says PingFederate Down', async () => {
    pfDown = true;
    render(<MFATestPage />);
    expect(await screen.findByText(/PingFederate Down/)).toBeInTheDocument();
  });

  test('PF user with no PingOne account: the line warns that MFA is unavailable', async () => {
    mappedId = null;
    render(<MFATestPage />);
    const line = await screen.findByTestId('mfa-credentials-line');
    await waitFor(() => expect(line).toHaveTextContent(/no matching PingOne user/));
  });
});
