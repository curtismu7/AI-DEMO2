import { render, waitFor, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { openSignIn, _resetSignInServiceForTests } from '../../utils/signInService';

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

test('openSignIn({ force, keepHint }) opens the flow with force=true and keep_hint=1; without keepHint no keep_hint', async () => {
  _resetSignInServiceForTests();
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/admin/config')) return ok({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' } });
    if (u.includes('identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
    if (u.includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
    return ok({}, 404);
  });
  render(<PiFlowSignInModal />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  const loginUrls = () => global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/oauth/user/login'));
  await act(async () => { openSignIn({ force: true, keepHint: true }); });
  await waitFor(() => expect(loginUrls().length).toBeGreaterThan(0));
  expect(loginUrls()[0]).toContain('force=true');
  expect(loginUrls()[0]).toContain('keep_hint=1');
  global.fetch.mockClear();
  await act(async () => { openSignIn({ force: true }); });
  await waitFor(() => expect(loginUrls().length).toBeGreaterThan(0));
  expect(loginUrls()[0]).not.toContain('keep_hint');
});
