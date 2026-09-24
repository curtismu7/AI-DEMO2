import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../useAuth';
import bffAxios from '../../services/bffAxios';
import { getCachedJson } from '../../services/cachedStatusService';
import { clearIdJagRunState, ID_JAG_PENDING_INTENT_KEY, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY, RUN_MODES, requestLiveIdJagRun } from '../../utils/idJagRunMode';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { notifyError } from '../../utils/appToast';

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
