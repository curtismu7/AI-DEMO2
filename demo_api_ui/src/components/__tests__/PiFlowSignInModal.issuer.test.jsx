/**
 * PiFlowSignInModal, issuer role: the ID-JAG playground's PingFederate -> PingFederate sign-in at the SE PingFederate,
 * driven in the modal (password form), then to the playground's /issuer/callback. No redirect page in between.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { openSignIn, _resetSignInServiceForTests } from '../../utils/signInService';

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const CALLBACK = 'https://app.test/api/id-jag-playground/issuer/callback?code=c&state=s';

describe('PiFlowSignInModal: issuer role', () => {
  let assign;
  beforeEach(() => {
    _resetSignInServiceForTests();
    assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://app.test', pathname: '/pingfederate-id-jag/playground', search: '', href: '', assign } });
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone', ciba_login_enabled: 'true' } });
      if (u.includes('identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [], frontDoorPiFlow: true });
      if (u.includes('/issuer/login')) return ok({ flowId: 'iss1', status: 'USERNAME_PASSWORD_REQUIRED' });
      if (u.includes('/issuer/pi-flow/credentials')) return ok({ redirectTo: CALLBACK });
      return ok({}, 404);
    });
  });
  const urls = () => global.fetch.mock.calls.map(([u]) => String(u));

  test('opens the issuer flow (not the app login, not the front door) on the password form and ends at /issuer/callback', async () => {
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(urls().some((u) => u.includes('identifier-policy'))).toBe(true));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { openSignIn({ role: 'issuer', returnTo: '/pingfederate-id-jag/playground', force: true }); });
    await waitFor(() => expect(urls().some((u) => u.includes('/api/id-jag-playground/issuer/login'))).toBe(true));
    const open = urls().find((u) => u.includes('/issuer/login'));
    expect(open).toContain('pi_flow=1');
    expect(urls().some((u) => u.includes('/oauth/user/login') || u.includes('/hosted-access/login') || u.includes('/hosted-access/check'))).toBe(false);
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CALLBACK));
    expect(urls().some((u) => u.includes('/api/id-jag-playground/issuer/pi-flow/credentials'))).toBe(true);
  });

  test('when the issuer flow cannot open, the modal falls back to the issuer redirect login', async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' } });
      if (u.includes('identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
      if (u.includes('/issuer/login')) return ok({ error: 'pf_pf_unavailable' }, 409);
      return ok({}, 404);
    });
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(urls().some((u) => u.includes('identifier-policy'))).toBe(true));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { openSignIn({ role: 'issuer', returnTo: '/pingfederate-id-jag/playground', force: true }); });
    await waitFor(() => expect(assign.mock.calls.length + (window.location.href ? 1 : 0)).toBeGreaterThan(0));
  });
});
