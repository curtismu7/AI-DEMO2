import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../useAuth';
import bffAxios from '../../services/bffAxios';
import { getCachedJson } from '../../services/cachedStatusService';
import { clearIdJagRunState, ID_JAG_PENDING_INTENT_KEY, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY, RUN_MODES, requestLiveIdJagRun } from '../../utils/idJagRunMode';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { notifyError } from '../../utils/appToast';
import { useUseCaseRunContext } from '../../utils/useCaseRunContext';

vi.mock('../../services/bffAxios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('axios', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { config: {} } }) } }));
vi.mock('../../services/cachedStatusService', () => ({ getCachedJson: vi.fn(), clearStatusCache: vi.fn() }));
vi.mock('../../services/configService', () => ({ savePublicConfig: vi.fn().mockResolvedValue() }));
vi.mock('../../utils/nrLog', () => ({ nrLog: vi.fn() }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: { subscribe: vi.fn() } }));

const originalLocation = window.location;
const intent = { mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: '/pingfederate-id-jag/demo' };

beforeEach(() => {
  clearIdJagRunState();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  delete window.location;
  window.location = { pathname: '/pingfederate-id-jag/demo', search: '', href: 'https://local.ping-devops.com:4000/pingfederate-id-jag/demo' };
  bffAxios.post.mockResolvedValue({ data: { mode: RUN_MODES.LIVE_ID_JAG } });
  bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: 'pingfederate' } } });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ logoutUrl: 'https://pf.example.test/idp/init_logout.openid', idJagHandoff: true }) });
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/status' ? { authenticated: false } : { authenticated: false } }));
});

afterEach(() => { window.location = originalLocation; });

test('explicit run posts server intent then starts provider-aware logout once', async () => {
  renderHook(() => useAuth());
  act(() => { requestLiveIdJagRun(intent); requestLiveIdJagRun(intent); });
  await waitFor(() => expect(window.location.href).toBe('https://pf.example.test/idp/init_logout.openid'));
  expect(bffAxios.post).toHaveBeenCalledTimes(1);
  expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/intent', expect.objectContaining({ useCaseId: ID_JAG_USE_CASE_ID, ...intent }));
  expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout?id_jag_handoff=1', expect.objectContaining({ credentials: 'include' }));
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).not.toBeNull();
});

test('PingOne selection blocks live handoff before sign-out and explains how to recover', async () => {
  bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: 'pingone' } } });
  renderHook(() => useAuth());
  act(() => requestLiveIdJagRun(intent));
  await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.stringMatching(/select PingFederate.*P1\/PF.*retry/i)));
  expect(bffAxios.post).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/logout?id_jag_handoff=1', expect.anything());
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  expect(window.location.href).toBe('https://local.ping-devops.com:4000/pingfederate-id-jag/demo');
});

test('failed intent leaves current session and page in place and clears client handoff', async () => {
  bffAxios.post.mockRejectedValueOnce(new Error('intent failed'));
  renderHook(() => useAuth());
  act(() => requestLiveIdJagRun(intent));
  await waitFor(() => expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull());
  expect(global.fetch).not.toHaveBeenCalledWith('/api/auth/logout?id_jag_handoff=1', expect.anything());
  expect(window.location.pathname).toBe('/pingfederate-id-jag/demo');
});

test.each(['pingone', 'pingfederate'])('ordinary %s login clears stale ID-JAG state', async (provider) => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ ...intent, useCaseId: ID_JAG_USE_CASE_ID }));
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: true, user: { username: 'demo' }, oauthProvider: provider, idJagRunIntent: null }
    : { authenticated: false } }));
  const authenticated = vi.fn();
  window.addEventListener('userAuthenticated', authenticated);
  renderHook(() => useAuth());
  await waitFor(() => expect(authenticated).toHaveBeenCalled());
  expect(authenticated.mock.calls[0][0].detail?.idJagCallbackValidated).not.toBe(true);
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  window.removeEventListener('userAuthenticated', authenticated);
});

test.each([
  { failedUrl: '/api/auth/oauth/status', workingUrl: '/api/auth/oauth/user/status' },
  { failedUrl: '/api/auth/oauth/user/status', workingUrl: '/api/auth/session' },
])('uses $workingUrl when $failedUrl is unavailable', async ({ failedUrl, workingUrl }) => {
  const activeUser = { id: 'customer-1', username: 'demo', role: 'customer' };
  getCachedJson.mockImplementation(async (url) => {
    if (url === failedUrl) throw new Error('status unavailable');
    return { data: url === workingUrl
      ? { authenticated: true, user: activeUser, oauthProvider: 'pingone' }
      : { authenticated: false, user: null } };
  });

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(activeUser));
  expect(result.current.loading).toBe(false);
});

test('recognizes a customer session while the admin status request hangs', async () => {
  const activeUser = { id: 'customer-2', username: 'demo', role: 'customer' };
  getCachedJson.mockImplementation((url) => url === '/api/auth/oauth/status'
    ? new Promise(() => {})
    : Promise.resolve({ data: url === '/api/auth/oauth/user/status'
      ? { authenticated: true, user: activeUser, oauthProvider: 'pingone' }
      : { authenticated: false } }));

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(activeUser));
  expect(result.current.loading).toBe(false);
});

test('recognizes a local session while an unrelated OAuth status request hangs', async () => {
  const localUser = { id: 'local-user', username: 'demo', role: 'customer' };
  getCachedJson.mockImplementation((url) => url === '/api/auth/oauth/status'
    ? new Promise(() => {})
    : Promise.resolve({ data: url === '/api/auth/session'
      ? { authenticated: true, authType: 'local_session', user: localUser }
      : { authenticated: false } }));

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(localUser));
  expect(result.current.loading).toBe(false);
});

test('tries PingOne silent reauth once for a stale customer session', async () => {
  const redirects = [];
  window.location = {
    pathname: '/dashboard', search: '',
    get href() { return 'https://local.ping-devops.com:4000/dashboard'; },
    set href(value) { redirects.push(value); },
  };
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: false, staleSession: true, sessionType: 'user', loginProvider: 'pingone_sso' }
    : { authenticated: false } }));

  const first = renderHook(() => useAuth());
  await waitFor(() => expect(redirects).toEqual(['/api/auth/oauth/user/silent-reauth?return_to=%2Fdashboard']));
  first.unmount();

  const second = renderHook(() => useAuth());
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(redirects).toHaveLength(1);
});

test('does not repeat silent reauth after PingOne says login is required', async () => {
  window.location = { pathname: '/dashboard', search: '?silent_reauth_failed=1', href: '/dashboard?silent_reauth_failed=1' };
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: false, staleSession: true, sessionType: 'user', loginProvider: 'pingone_sso' }
    : { authenticated: false } }));

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(window.location.href).toBe('/dashboard?silent_reauth_failed=1');
});

test('does not accept generic session status when the PingOne OAuth token is stale', async () => {
  const redirects = [];
  window.location = {
    pathname: '/dashboard', search: '',
    get href() { return 'https://local.ping-devops.com:4000/dashboard'; },
    set href(value) { redirects.push(value); },
  };
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: false, staleSession: true, sessionType: 'user', loginProvider: 'pingone_sso' }
    : url === '/api/auth/session'
      ? { authenticated: true, user: { username: 'stale-user' } }
      : { authenticated: false } }));

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(redirects).toHaveLength(1));
  expect(result.current.user).toBeNull();
});

test('rechecks a stale customer status when generic status confirms refresh completed', async () => {
  const activeUser = { id: 'refreshed-user', username: 'demo', role: 'customer' };
  let customerChecks = 0;
  getCachedJson.mockImplementation(async (url) => {
    if (url === '/api/auth/oauth/user/status') {
      customerChecks += 1;
      return { data: customerChecks === 1
        ? { authenticated: false, staleSession: true, sessionType: 'user', loginProvider: 'pingone_sso' }
        : { authenticated: true, user: activeUser, oauthProvider: 'pingone' } };
    }
    return { data: url === '/api/auth/session'
      ? { authenticated: true, authType: 'user', user: activeUser }
      : { authenticated: false } };
  });

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.user).toEqual(activeUser));
  expect(customerChecks).toBeGreaterThanOrEqual(2);
  expect(window.location.href).toBe('https://local.ping-devops.com:4000/pingfederate-id-jag/demo');
});

test('never starts PingOne silent reauth for a PingFederate stale session', async () => {
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: false, staleSession: true, sessionType: 'user', loginProvider: 'pingfederate' }
    : { authenticated: false } }));

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(window.location.href).toBe('https://local.ping-devops.com:4000/pingfederate-id-jag/demo');
});

test('a generic fallback preserves and later validates a pending PF ID-JAG callback', async () => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ ...intent, useCaseId: ID_JAG_USE_CASE_ID }));
  const activeUser = { id: 'pf-user', username: 'demo', role: 'customer' };
  let customerChecks = 0;
  let resolveCustomerRecheck;
  const customerRecheck = new Promise((resolve) => { resolveCustomerRecheck = resolve; });
  getCachedJson.mockImplementation(async (url) => {
    if (url === '/api/auth/oauth/user/status') {
      customerChecks += 1;
      if (customerChecks === 1) throw new Error('temporary status failure');
      return customerRecheck;
    }
    return { data: url === '/api/auth/session'
      ? { authenticated: true, authType: 'user', user: activeUser }
      : { authenticated: false } };
  });
  const authenticated = vi.fn();
  window.addEventListener('userAuthenticated', authenticated);
  renderHook(() => {
    useUseCaseRunContext({ pathname: '/pingfederate-id-jag/demo', state: null });
    return useAuth();
  });

  await waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
  expect(authenticated.mock.calls[0][0].detail).toMatchObject({ authSessionProvisional: true });
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).not.toBeNull();
  await act(async () => resolveCustomerRecheck({ data: { authenticated: true, user: activeUser,
    oauthProvider: 'pingfederate', idJagRunIntent: { ...intent, useCaseId: ID_JAG_USE_CASE_ID } } }));
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem(ID_JAG_VALIDATED_CALLBACK_KEY)))
    .toMatchObject({ idJagCallbackValidated: true, message: intent.message }));
  expect(authenticated.mock.calls.filter(([event]) => event.detail?.idJagCallbackValidated)).toHaveLength(1);
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  window.removeEventListener('userAuthenticated', authenticated);
});

test('a generic fallback clears pending ID-JAG state after an ordinary PF login is confirmed', async () => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ ...intent, useCaseId: ID_JAG_USE_CASE_ID }));
  const activeUser = { id: 'pf-user', username: 'demo', role: 'customer' };
  let customerChecks = 0;
  let resolveCustomerRecheck;
  const customerRecheck = new Promise((resolve) => { resolveCustomerRecheck = resolve; });
  getCachedJson.mockImplementation(async (url) => {
    if (url === '/api/auth/oauth/user/status') {
      customerChecks += 1;
      if (customerChecks === 1) throw new Error('temporary status failure');
      return customerRecheck;
    }
    return { data: url === '/api/auth/session'
      ? { authenticated: true, authType: 'user', user: activeUser }
      : { authenticated: false } };
  });
  const authenticated = vi.fn();
  window.addEventListener('userAuthenticated', authenticated);
  renderHook(() => {
    useUseCaseRunContext({ pathname: '/pingfederate-id-jag/demo', state: null });
    return useAuth();
  });

  await waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
  expect(authenticated.mock.calls[0][0].detail).toMatchObject({ authSessionProvisional: true });
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).not.toBeNull();
  await act(async () => resolveCustomerRecheck({ data: { authenticated: true, user: activeUser,
    oauthProvider: 'pingfederate', idJagRunIntent: null } }));
  await waitFor(() => expect(authenticated).toHaveBeenCalledTimes(2));
  expect(authenticated.mock.calls[1][0].detail?.authSessionProvisional).not.toBe(true);
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  window.removeEventListener('userAuthenticated', authenticated);
});

test('only a PF status with the server intent emits a validated callback event', async () => {
  getCachedJson.mockImplementation(async (url) => ({ data: url === '/api/auth/oauth/user/status'
    ? { authenticated: true, user: { username: 'demo' }, oauthProvider: 'pingfederate', idJagRunIntent: { useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance', returnTo: intent.returnTo } }
    : { authenticated: false } }));
  const authenticated = vi.fn();
  window.addEventListener('userAuthenticated', authenticated);
  renderHook(() => useAuth());
  await waitFor(() => expect(authenticated).toHaveBeenCalled());
  expect(authenticated.mock.calls[0][0].detail).toMatchObject({ idJagCallbackValidated: true, useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG, message: 'show my balance' });
  expect(JSON.parse(sessionStorage.getItem(ID_JAG_VALIDATED_CALLBACK_KEY))).toMatchObject(authenticated.mock.calls[0][0].detail);
  window.removeEventListener('userAuthenticated', authenticated);
});

test('completed live trace consumes the server run grant once and retains evidence', async () => {
  renderHook(() => useAuth());
  const listener = tokenChainTraceStore.subscribe.mock.calls[0][0];
  const completed = { trace: { runId: 42, mode: RUN_MODES.LIVE_ID_JAG, provenance: RUN_MODES.LIVE_ID_JAG, outcome: 'ok' } };
  act(() => { listener(completed); listener(completed); });
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete'));
  expect(bffAxios.post).toHaveBeenCalledTimes(1);
});

test('failed native trace with only PF issuance clears the server grant and callback state', async () => {
  sessionStorage.setItem(ID_JAG_VALIDATED_CALLBACK_KEY, JSON.stringify({ useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG }));
  renderHook(() => useAuth());
  const listener = tokenChainTraceStore.subscribe.mock.calls[0][0];
  act(() => listener({ trace: { runId: 43, mode: RUN_MODES.LIVE_ID_JAG, provenance: RUN_MODES.LIVE_ID_JAG,
    outcome: 'error', tokenEvents: [{ id: 'pf-id-jag-issued', provider: 'pingfederate' }] } }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete'));
  await waitFor(() => expect(sessionStorage.getItem(ID_JAG_VALIDATED_CALLBACK_KEY)).toBeNull());
});
