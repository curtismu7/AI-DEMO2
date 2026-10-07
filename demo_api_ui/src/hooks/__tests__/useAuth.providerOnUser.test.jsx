import { renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../useAuth';
import bffAxios from '../../services/bffAxios';
import { getCachedJson } from '../../services/cachedStatusService';
import { clearIdJagRunState } from '../../utils/idJagRunMode';

vi.mock('../../services/bffAxios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('axios', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { config: {} } }) } }));
vi.mock('../../services/cachedStatusService', () => ({ getCachedJson: vi.fn(), clearStatusCache: vi.fn() }));
vi.mock('../../services/configService', () => ({ savePublicConfig: vi.fn().mockResolvedValue() }));
vi.mock('../../utils/nrLog', () => ({ nrLog: vi.fn() }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: { subscribe: vi.fn() } }));

const signedOut = { authenticated: false };

function serve(userStatus) {
  getCachedJson.mockImplementation(async (url) => ({
    data: url === '/api/auth/oauth/user/status' ? userStatus : signedOut,
  }));
}

beforeEach(() => {
  clearIdJagRunState();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  bffAxios.get.mockResolvedValue({ data: { config: {} } });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe('useAuth reports which server signed the session in', () => {
  test('signIn carries the status provider and issuer, and the user object is left exactly as the server sent it', async () => {
    const storedUser = { username: 'demouser', oauthProvider: 'pingone', oauthIssuer: 'https://auth.pingone.com/env' };
    serve({
      authenticated: true,
      oauthProvider: 'pingfederate',
      oauthIssuer: 'https://local.ping-devops.com:9031',
      // The stored record can lag behind the session that is actually signed in.
      user: storedUser,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.signIn).toEqual({ provider: 'pingfederate', issuer: 'https://local.ping-devops.com:9031' });
    expect(result.current.user).toEqual(storedUser);
  });

  test('signIn is null when the status names no provider', async () => {
    serve({ authenticated: true, user: { username: 'demouser', oauthProvider: 'pingone' } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.signIn).toBeNull();
  });

  test('falls back to the user record\'s issuer when the status has none', async () => {
    serve({ authenticated: true, oauthProvider: 'pingone', user: { username: 'demouser', oauthIssuer: 'https://auth.pingone.com/env' } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.signIn).toEqual({ provider: 'pingone', issuer: 'https://auth.pingone.com/env' });
  });
});
