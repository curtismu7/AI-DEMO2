import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OAuthProviderToggle from '../OAuthProviderToggle';
import bffAxios from '../../services/bffAxios';
import { ID_JAG_PENDING_INTENT_KEY, ID_JAG_USE_CASE_ID, RUN_MODES } from '../../utils/idJagRunMode';

vi.mock('../../services/bffAxios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const onLoggedOut = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.addEventListener('userLoggedOut', onLoggedOut);
  bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: 'pingfederate' } } });
  bffAxios.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { window.removeEventListener('userLoggedOut', onLoggedOut); });

test('provider switch clears pending ID-JAG state before logging out', async () => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG }));
  sessionStorage.setItem('bx_id_jag_replayed', '1');
  render(<OAuthProviderToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Toggle OAuth login provider' }));
  await waitFor(() => expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull());
  expect(bffAxios.post).toHaveBeenNthCalledWith(1, '/api/admin/config', { oauth_provider: 'pingone' });
  expect(bffAxios.post).toHaveBeenNthCalledWith(2, '/api/auth/clear-session');
  expect(onLoggedOut).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  expect(sessionStorage.getItem('bx_id_jag_replayed')).toBeNull();
});

// Stale pre-run provider (abandoned live ID-JAG run) must never overwrite the user's toggle.
const PRE_RUN_KEY = 'bx_id_jag_pre_run_provider';
const configPosts = () => bffAxios.post.mock.calls.filter(([url]) => url === '/api/admin/config');

test('P1 toggle is not reverted by a stale pre-run provider', async () => {
  sessionStorage.setItem(PRE_RUN_KEY, 'pingfederate');
  let toggled = false;
  bffAxios.get.mockImplementation(async () => ({ data: { config: { oauth_provider: toggled ? 'pingone' : 'pingfederate' } } }));
  bffAxios.post.mockImplementation(async (url) => {
    if (url === '/api/admin/config') toggled = true;
    return { data: { ok: true } };
  });
  render(<OAuthProviderToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Toggle OAuth login provider' }));
  await waitFor(() => expect(onLoggedOut).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 0));
  expect(configPosts().map(([, body]) => body)).toEqual([{ oauth_provider: 'pingone' }]);
  expect(sessionStorage.getItem(PRE_RUN_KEY)).toBeNull();
});

test('reverse direction (P1 to PF) still posts only pingfederate', async () => {
  bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: 'pingone' } } });
  render(<OAuthProviderToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Toggle OAuth login provider' }));
  await waitFor(() => expect(onLoggedOut).toHaveBeenCalledTimes(1));
  expect(configPosts().map(([, body]) => body)).toEqual([{ oauth_provider: 'pingfederate' }]);
});
