import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OAuthProviderToggle from '../OAuthProviderToggle';
import bffAxios from '../../services/bffAxios';
import { ID_JAG_PENDING_INTENT_KEY, ID_JAG_USE_CASE_ID, RUN_MODES } from '../../utils/idJagRunMode';

vi.mock('../../services/bffAxios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

const originalLocation = window.location;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  delete window.location;
  window.location = { href: 'https://local.ping-devops.com:4000/dashboard' };
  bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: 'pingfederate' } } });
  bffAxios.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { window.location = originalLocation; });

test('provider switch clears pending ID-JAG launch and one-shot replay state', async () => {
  sessionStorage.setItem(ID_JAG_PENDING_INTENT_KEY, JSON.stringify({ useCaseId: ID_JAG_USE_CASE_ID, mode: RUN_MODES.LIVE_ID_JAG }));
  sessionStorage.setItem('bx_id_jag_replayed', '1');
  render(<OAuthProviderToggle />);
  fireEvent.click(await screen.findByRole('button', { name: 'Toggle OAuth login provider' }));
  await waitFor(() => expect(window.location.href).toBe('/logout'));
  expect(sessionStorage.getItem(ID_JAG_PENDING_INTENT_KEY)).toBeNull();
  expect(sessionStorage.getItem('bx_id_jag_replayed')).toBeNull();
});
