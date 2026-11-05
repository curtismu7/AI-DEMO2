import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth } from '../useAuth';
import bffAxios from '../../services/bffAxios';
import { getCachedJson } from '../../services/cachedStatusService';

vi.mock('../../services/bffAxios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('axios', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { config: {} } }) } }));
vi.mock('../../services/cachedStatusService', () => ({ getCachedJson: vi.fn(), clearStatusCache: vi.fn() }));
vi.mock('../../services/configService', () => ({ savePublicConfig: vi.fn().mockResolvedValue() }));
vi.mock('../../utils/nrLog', () => ({ nrLog: vi.fn() }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: { subscribe: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  bffAxios.get.mockResolvedValue({ data: { config: {} } });
  getCachedJson.mockResolvedValue({ data: { authenticated: false } });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

// Sign-out must land the user back on the page they signed out from, query included.
test.each([
  ['/profile', '', '/profile'],
  ['/group-policy', '?verticalId=healthcare', '/group-policy?verticalId=healthcare'],
  ['/', '', '/'],
])('logout from %s%s remembers %s', async (pathname, search, expected) => {
  window.history.pushState({}, '', `${pathname}${search}`);
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.logout());
  expect(sessionStorage.getItem('logoutReturnTo')).toBe(expected);
});
