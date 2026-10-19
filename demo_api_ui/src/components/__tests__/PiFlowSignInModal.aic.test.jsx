/**
 * PiFlowSignInModal with AIC login on: no redirect. The flow opens at EXTERNAL_AUTHENTICATION_REQUIRED, the
 * "Continue with AIC" click opens PingOne's link in a popup, and the modal polls the BFF until it can finish.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const LINK = 'https://auth.pingone.com/env/rp/authenticate?flowId=f1';
const CALLBACK = 'https://app.test/api/auth/oauth/user/callback?code=c&state=s';
const CONFIG = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone', aic_login_enabled: 'true' };

describe('PiFlowSignInModal: AIC in a popup', () => {
  let assign;
  let popup;
  let polls;
  beforeEach(() => {
    assign = vi.fn();
    polls = [];
    popup = { closed: false, close: vi.fn() };
    window.open = vi.fn(() => popup);
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign } });
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config: CONFIG });
      if (u.includes('identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
      if (u.includes('/pi-flow/external')) return polls.shift()?.() ?? ok({ step: 'external', waiting: true });
      if (u.includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'EXTERNAL_AUTHENTICATION_REQUIRED', externalAuthUrl: LINK });
      return ok({}, 404);
    });
  });

  async function start() {
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
    return screen.findByRole('button', { name: 'Continue with AIC' });
  }

  test('opens a flow (not a redirect), offers the AIC button, and opens the link in a popup on click', async () => {
    const button = await start();
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(window.open).toHaveBeenCalledWith(LINK, 'aic-signin', expect.stringContaining('popup'));
    expect(await screen.findByRole('button', { name: 'Waiting for AIC…' })).toBeDisabled();
  });

  test('when the BFF answers redirectTo, the popup closes and the modal goes to the callback', async () => {
    polls = [() => ok({ step: 'external', waiting: true }), () => ok({ redirectTo: CALLBACK })];
    const button = await start();
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CALLBACK), { timeout: 6000 });
    expect(popup.close).toHaveBeenCalled();
  });

  test('an expired flow stops the wait and offers another try', async () => {
    polls = [() => ok({ error: 'pi_flow_expired' }, 410)];
    const button = await start();
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent('expired');
    expect(screen.getByRole('button', { name: 'Try AIC again' })).not.toBeDisabled();
    expect(assign).not.toHaveBeenCalled();
  });
});

// The hosted-access front door is a plain password flow that runs BEFORE the app sign-in, even with AIC on:
// a flow without an AIC link must not be treated as an AIC failure there.
describe('PiFlowSignInModal: AIC with the hosted-access front door', () => {
  const urls = () => global.fetch.mock.calls.map(([u]) => String(u));
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://app.test', pathname: '/dashboard', search: '', href: '', assign: vi.fn() } });
  });
  const bff = (checkStatus) => {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config: CONFIG });
      if (u.includes('/hosted-access/identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [], frontDoorPiFlow: true });
      if (u.includes('/hosted-access/check')) return Promise.resolve({ ok: checkStatus < 400, status: checkStatus });
      if (u.includes('/hosted-access/login')) return ok({ flowId: 'fd1', status: 'USERNAME_PASSWORD_REQUIRED' });
      if (u.includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'EXTERNAL_AUTHENTICATION_REQUIRED', externalAuthUrl: LINK });
      return ok({}, 404);
    });
  };
  const signIn = async () => {
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(urls().some((u) => u.includes('/hosted-access/identifier-policy'))).toBe(true));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  };

  test('not past the wall: the front-door password flow opens in the modal, not an AIC step or a redirect', async () => {
    bff(401);
    await signIn();
    expect(urls().some((u) => u.includes('/hosted-access/login'))).toBe(true);
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with AIC' })).toBeNull();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  test('past the wall: the app sign-in is the AIC step', async () => {
    bff(204);
    await signIn();
    expect(await screen.findByRole('button', { name: 'Continue with AIC' })).toBeInTheDocument();
  });
});
