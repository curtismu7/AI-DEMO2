/**
 * PiFlowSignInModal, SE front door: when the hosted-access wall is on and not yet passed, the modal runs the
 * front door's pi.flow first (hosted-access endpoints), then continues with the normal app sign-in.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';

vi.mock('../../utils/passkeyCeremony', () => ({ authenticateWebAuthn: vi.fn() }));

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const CONFIG = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' };
const KEY = 'piFlowFrontDoorResume';

function mockBff({ checkStatus = 401, frontDoorPiFlow = true } = {}) {
  global.fetch = vi.fn((url, init) => {
    const u = String(url);
    if (u.includes('/api/admin/config')) return ok({ config: CONFIG });
    if (u.includes('/hosted-access/identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [], frontDoorPiFlow });
    if (u.includes('/hosted-access/check')) return Promise.resolve({ ok: checkStatus < 400, status: checkStatus });
    if (u.includes('/hosted-access/login')) return ok({ flowId: 'fd1', status: 'USERNAME_PASSWORD_REQUIRED' });
    if (u.includes('/hosted-access/pi-flow/credentials')) return ok({ redirectTo: 'https://app.test/api/auth/hosted-access/callback?code=c&state=s' });
    if (u.includes('/oauth/user/login')) return ok({ flowId: 'app1', status: 'USERNAME_PASSWORD_REQUIRED' });
    return ok({}, 404);
  });
}
const urls = () => global.fetch.mock.calls.map(([u]) => String(u));

async function mountAndSignIn(returnTo = '/mfa-test') {
  render(<PiFlowSignInModal />);
  await waitFor(() => expect(urls().some((u) => u.includes('/hosted-access/identifier-policy'))).toBe(true));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  await act(async () => { navigateToCustomerOAuthLogin(returnTo); });
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}

describe('PiFlowSignInModal front door', () => {
  let assign;
  beforeEach(() => {
    assign = vi.fn();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/mfa-test', search: '', href: '', assign },
    });
  });

  test('not past the wall: opens the FRONT-DOOR flow (not the app login) and shows the access hint', async () => {
    mockBff({ checkStatus: 401 });
    await mountAndSignIn();
    const open = urls().find((u) => u.includes('/hosted-access/login'));
    expect(open).toContain('pi_flow=1');
    expect(open).toContain('return_to=%2Fmfa-test');
    expect(urls().some((u) => u.includes('/oauth/user/login'))).toBe(false);
    expect(await screen.findByText(/confirm you can access this demo/i)).toBeInTheDocument();
  });

  test('front-door password goes to the hosted callback, and the app sign-in is remembered for the return', async () => {
    mockBff({ checkStatus: 401 });
    await mountAndSignIn();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/hosted-access/callback?code=c&state=s'));
    expect(urls().some((u) => u.includes('/hosted-access/pi-flow/credentials'))).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(KEY))).toMatchObject({ returnTo: '/mfa-test', role: 'customer' });
  });

  test('already past the wall (check 204): goes straight to the normal app sign-in', async () => {
    mockBff({ checkStatus: 204 });
    await mountAndSignIn();
    expect(urls().some((u) => u.includes('/hosted-access/login'))).toBe(false);
    expect(urls().some((u) => u.includes('/oauth/user/login'))).toBe(true);
    expect(screen.queryByText(/confirm you can access this demo/i)).toBeNull();
  });

  test('server says the front-door modal cannot run: no check, normal sign-in (wall redirect is the fallback)', async () => {
    mockBff({ frontDoorPiFlow: false });
    await mountAndSignIn();
    expect(urls().some((u) => u.includes('/hosted-access/check'))).toBe(false);
    expect(urls().some((u) => u.includes('/oauth/user/login'))).toBe(true);
  });

  test('after the hosted callback the app sign-in resumes by itself, without another wall check', async () => {
    mockBff({ checkStatus: 401 });
    sessionStorage.setItem(KEY, JSON.stringify({ returnTo: '/mfa-test', role: 'customer', force: false, at: Date.now() }));
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(urls().some((u) => u.includes('/oauth/user/login'))).toBe(true));
    expect(urls().some((u) => u.includes('/hosted-access/check'))).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  test('a stale resume hand-off (older than 5 minutes) is dropped and never reopens the modal', async () => {
    mockBff({ checkStatus: 401 });
    sessionStorage.setItem(KEY, JSON.stringify({ returnTo: '/mfa-test', role: 'customer', force: false, at: Date.now() - 6 * 60 * 1000 }));
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(urls().some((u) => u.includes('/api/admin/config'))).toBe(true));
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(urls().some((u) => u.includes('/oauth/user/login'))).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
