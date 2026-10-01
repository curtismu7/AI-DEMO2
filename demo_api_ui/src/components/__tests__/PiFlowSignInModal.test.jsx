/**
 * PiFlowSignInModal — redirect-free customer sign-in. Enabled only when the BFF
 * config says pi.flow is on for PingOne; every failure falls back to the plain
 * redirect login.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';
import { authenticateWebAuthn } from '../../utils/passkeyCeremony';

vi.mock('../../utils/passkeyCeremony', () => ({ authenticateWebAuthn: vi.fn() }));

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

function mockBff({ config, login, credentials, assertion }) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/admin/config')) return ok({ config });
    if (String(url).includes('/pi-flow/assertion')) return assertion();
    if (String(url).includes('/pi-flow/credentials')) return credentials();
    if (String(url).includes('/oauth/user/login')) return login();
    return ok({}, 404);
  });
}

const ON = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' };

describe('PiFlowSignInModal', () => {
  let assign;
  beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign },
    });
  });

  async function mountAndClick() {
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
  }

  test('flag on: opens the form instead of redirecting, then goes to the BFF callback on success', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClick();
    expect(window.location.href).toBe('');
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
  });

  test('wrong password shows the error and stays on the form', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ error: 'invalid_credentials', message: 'Username or password is incorrect.' }, 401),
    });
    await mountAndClick();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Username or password is incorrect.');
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  test('a flow needing more than a password falls back to the redirect login', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ fallback: true, status: 'OTP_REQUIRED' }),
    });
    await mountAndClick();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard'));
  });

  test('BFF cannot open the flow: redirect login, no form left behind', async () => {
    mockBff({ config: ON, login: () => ok({ error: 'pi_flow_unavailable' }, 502), credentials: () => ok({}) });
    await mountAndClick();
    await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard'));
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  test('flag off: navigateToCustomerOAuthLogin is the plain redirect and no form appears', async () => {
    mockBff({ config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'false', oauth_provider: 'pingone' }, login: () => ok({}), credentials: () => ok({}) });
    await mountAndClick();
    expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard');
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  test('PingFederate selected: stays on the redirect login even with the flag on', async () => {
    mockBff({ config: { ...ON, oauth_provider: 'pingfederate' }, login: () => ok({}), credentials: () => ok({}) });
    await mountAndClick();
    expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard');
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  describe('passkey step', () => {
    const OPTIONS = { challenge: 'Y2g', rpId: 'ping-devops.com', allowCredentials: [{ type: 'public-key', id: 'aWQ' }] };
    const ASSERTION = { id: 'cred', rawId: 'cmF3', type: 'public-key', response: {} };

    async function toPasskeyStep(extra = {}) {
      mockBff({
        config: ON,
        login: () => ok({ flowId: 'f1' }),
        credentials: () => ok({ step: 'passkey', publicKeyCredentialRequestOptions: OPTIONS }),
        ...extra,
      });
      await mountAndClick();
      fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      return screen.findByRole('button', { name: 'Verify with passkey' });
    }

    const assertionCall = () => global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/assertion'));

    beforeEach(() => {
      authenticateWebAuthn.mockReset();
    });

    test('password then passkey: runs the ceremony on the flow options and posts assertion + page origin, then goes to the callback', async () => {
      authenticateWebAuthn.mockResolvedValue({ assertionValue: ASSERTION });
      const verify = await toPasskeyStep({
        assertion: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
      });
      expect(window.location.href).toBe('');
      fireEvent.click(verify);
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
      expect(authenticateWebAuthn).toHaveBeenCalledWith(OPTIONS);
      expect(JSON.parse(assertionCall()[1].body)).toEqual({ assertion: ASSERTION, origin: 'https://app.test' });
    });

    test('a dismissed passkey prompt stays on the step with a retry, and posts nothing', async () => {
      authenticateWebAuthn.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
      const verify = await toPasskeyStep({ assertion: () => ok({}) });
      fireEvent.click(verify);
      expect(await screen.findByRole('alert')).toHaveTextContent('No passkey was used');
      expect(assertionCall()).toBeUndefined();
      expect(screen.getByRole('button', { name: 'Verify with passkey' })).not.toBeDisabled();
    });

    test('a rejected assertion shows the error and stays on the step', async () => {
      authenticateWebAuthn.mockResolvedValue({ assertionValue: ASSERTION });
      const verify = await toPasskeyStep({
        assertion: () => ok({ error: 'assertion_failed', message: 'The passkey could not be verified.' }, 401),
      });
      fireEvent.click(verify);
      expect(await screen.findByRole('alert')).toHaveTextContent('The passkey could not be verified.');
      expect(assign).not.toHaveBeenCalled();
      expect(window.location.href).toBe('');
    });

    test('"Use another method" leaves for the redirect login', async () => {
      await toPasskeyStep({ assertion: () => ok({}) });
      fireEvent.click(screen.getByRole('button', { name: 'Use another method' }));
      expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard');
    });
  });
});
