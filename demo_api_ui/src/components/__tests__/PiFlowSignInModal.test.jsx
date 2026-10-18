/**
 * PiFlowSignInModal — redirect-free customer sign-in. Enabled only when the BFF
 * config says pi.flow is on for PingOne; every failure falls back to the plain
 * redirect login.
 */
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PiFlowSignInModal from '../PiFlowSignInModal';
import { VerticalContext } from '../../vertical/VerticalProvider';
import { navigateToCustomerOAuthLogin, navigateToCustomerOAuthForceLogin, navigateToAdminOAuthLogin } from '../../utils/authUi';
import { authenticateWebAuthn } from '../../utils/passkeyCeremony';

vi.mock('../../utils/passkeyCeremony', () => ({ authenticateWebAuthn: vi.fn() }));

const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

function mockBff({ config, login, credentials, assertion, passwordless, identifierPolicy }) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/admin/config')) return ok({ config });
    if (String(url).includes('/api/auth/hosted-access/identifier-policy')) {
      return identifierPolicy ? identifierPolicy() : ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
    }
    if (String(url).includes('/pi-flow/assertion')) return assertion();
    if (String(url).includes('/pi-flow/credentials')) return credentials();
    if (String(url).includes('/pi-flow/passwordless')) return passwordless?.() ?? ok({}, 404);
    if (String(url).includes('/oauth/user/login')) return login();
    return ok({}, 404);
  });
}


// With the flag on, customers (either provider) open on a choice screen (passwordless / password +
// approval link / password); the pre-existing tests exercise the passwordless and password paths, so
// they click through. No-op when no choice screen is shown (admin, ?signin=mfa keep their legacy first step).
function skipChoice(kind) {
  const label = kind === 'password' ? 'Use a password instead' : 'Sign in without a password';
  const btn = screen.queryByRole('button', { name: label });
  if (btn) fireEvent.click(btn);
}

// Click through the choice screen, then let the chosen path's flow fetch settle
// (it starts on click now, not in begin()).
async function chooseAndSettle(kind) {
  skipChoice(kind);
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

// ciba_login_enabled ships OFF; the suite's default config turns it ON so the choice screen (and the
// chooseAndSettle helper) is exercised. The flag-off describe at the bottom pins the pre-feature behaviour.
const ON = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone', ciba_login_enabled: 'true' };

describe('PiFlowSignInModal', () => {
  let assign;
  beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign },
    });
  });

  // identity: the active vertical's manifest identity block, or undefined for no provider.
  async function mountAndClick(identity) {
    render(
      identity === undefined ? (
        <PiFlowSignInModal />
      ) : (
        <VerticalContext.Provider value={{ pageManifest: { identity } }}>
          <PiFlowSignInModal />
        </VerticalContext.Provider>
      ),
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
    await chooseAndSettle('passkey');
  }

  // The modal's default step is the device-only (passwordless) form. Tests that
  // exercise the password path click through to it explicitly; the switch
  // re-opens the flow without the passwordless selector.
  async function mountAndClickPassword(identity) {
    await mountAndClick(identity);
    fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeInTheDocument());
    return screen.getByLabelText('Username');
  }

  test('flag on: opens the modal, the password path goes to the BFF callback on success', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClickPassword();
    expect(window.location.href).toBe('');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
  });

  // Plus-addressing: the demo refuses cmuir+x@pingone.com-style aliases at the
  // sign-in form — inline, before any flow opens — unless the identifier is on
  // the BFF's public allowlist (the presenter's demo accounts).
  test('rejects a plus-addressed username inline and never contacts the BFF flow', async () => {
    mockBff({
      config: ON,
      identifierPolicy: () => ok({ rejectPlusAddressing: true, allowedIdentifiers: ['demoUser', 'cmuir+demo-user@pingone.com'] }),
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ redirectTo: 'https://app.test/x' }),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone+1@pingone.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/plus addressing is not allowed/i)).toBeInTheDocument();
    // No credentials call was made — the form stopped the attempt itself.
    const credentialCalls = global.fetch.mock.calls.filter(([u]) => String(u).includes('/pi-flow/credentials'));
    expect(credentialCalls).toHaveLength(0);
  });

  test('allowlisted demo identifier with a plus address signs in normally', async () => {
    mockBff({
      config: ON,
      identifierPolicy: () => ok({ rejectPlusAddressing: true, allowedIdentifiers: ['demoUser', 'cmuir+demo-user@pingone.com'] }),
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'cmuir+demo-user@pingone.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
  });

  test('policy fetch failure never blocks sign-in (fail open to the server wall)', async () => {
    mockBff({
      config: ON,
      identifierPolicy: () => ok({}, 500),
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'someone+1@pingone.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // The UI check is best-effort; when its policy fetch failed, the sign-in
    // proceeds and the SERVER-side gate is the wall.
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
  });

  test('the sign-in form offers Forgot password? and it opens the reset form', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({}),
    });
    await mountAndClick();
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(await screen.findByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify with MFA' })).toBeInTheDocument();
  });

  test('wrong password shows the error and stays on the form', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ error: 'invalid_credentials', message: 'Username or password is incorrect.' }, 401),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
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
      credentials: () => ok({ fallback: true, status: 'DEVICE_SELECTION_REQUIRED' }),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/login?return_to=%2Fdashboard'));
  });

  test('a transient BFF 5xx on credentials shows a retryable error and stays in pi.flow', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ error: 'pi_flow_failed' }, 502),
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('try again');
    // The point of this modal: a transient failure never dumps the user onto
    // the hosted PingOne page mid-sign-in.
    expect(window.location.href).toBe('');
    expect(assign).not.toHaveBeenCalled();
  });

  test('OTP_REQUIRED after the password: shows the code input and posts it to /pi-flow/otp', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({ step: 'otp' }),
      assertion: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    // Intercept the OTP step (not covered by mockBff) while keeping the spy.
    const inner = global.fetch;
    global.fetch = vi.fn((url, init) => {
      if (String(url).includes('/pi-flow/otp')) return ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' });
      return inner(url, init);
    });
    await mountAndClickPassword();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
    const otpCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/otp'));
    expect(JSON.parse(otpCall[1].body)).toEqual({ otp: '123456' });
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

  test('?signin=mfa on the page adds mfa=1 to the BFF login call', async () => {
    window.location.search = '?signin=mfa';
    mockBff({ config: ON, login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }), credentials: () => ok({}) });
    await mountAndClick();
    await screen.findByLabelText('Username');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/login?') && String(u).includes('mfa=1'))).toBe(true);
  });

  test('force re-auth opens the modal and sends force=true alongside pi_flow=1', async () => {
    mockBff({ config: ON, login: () => ok({ flowId: 'f1' }), credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }) });
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthForceLogin('/dashboard'); });
    await chooseAndSettle('passkey');
    fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
    const loginCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/oauth/user/login'));
    expect(String(loginCall[0])).toContain('pi_flow=1');
    expect(String(loginCall[0])).toContain('force=true');
  });

  test('?signin=mfa on PingFederate drives OTP in the modal (no hosted detour)', async () => {
    window.location.search = '?signin=mfa';
    mockBff({
      config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'pf1', usernameHint: 'demouser' }),
      credentials: () => ok({ step: 'otp', devices: [{ id: 'pf-otp-1', type: 'OTP' }] }),
      assertion: () => ok({}),
    });
    await mountAndClick(); // PF opens password-first
    await screen.findByLabelText('Password');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demouser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(window.location.href).toBe(''); // no redirect to /stepup
  });

  test('PingFederate selected: opens the same form (the BFF drives the PF flow)', async () => {
    mockBff({
      config: { ...ON, oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClickPassword(); // PF opens device-first; the password form is one click away
    expect(window.location.href).toBe('');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demouser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
  });

  test('PingFederate customer opens device-first (passwordless=1); the password form offers the device switch', async () => {
    mockBff({
      config: { ...ON, oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'f1', status: 'AUTHENTICATION_REQUIRED' }),
      credentials: () => ok({}),
    });
    await mountAndClick();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    const loginCall = global.fetch.mock.calls.find(([u]) => String(u).includes('/oauth/user/login'));
    expect(String(loginCall[0])).toContain('passwordless=1');
    fireEvent.click(screen.getByRole('button', { name: 'Use your password instead' }));
    await screen.findByLabelText('Password');
    expect(screen.getByRole('button', { name: 'Use a device instead' })).toBeInTheDocument();
  });

  test('PingFederate: the username hint from the BFF prefills the username box', async () => {
    mockBff({
      config: { ...ON, oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED', usernameHint: 'demouser' }),
      credentials: () => ok({}),
    });
    await mountAndClick();
    expect(await screen.findByLabelText('Username')).toHaveValue('demouser');
  });

  test('no hint (PingOne): the username box starts empty', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({}),
    });
    await mountAndClick();
    expect(await screen.findByLabelText('Username')).toHaveValue('');
  });

  test('any other provider stays on the redirect login even with the flag on', async () => {
    mockBff({ config: { ...ON, oauth_provider: 'something-else' }, login: () => ok({}), credentials: () => ok({}) });
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
      await mountAndClickPassword();
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
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

    test('"Use another method" switches to the device step inside the modal', async () => {
      await toPasskeyStep({ assertion: () => ok({}) });
      fireEvent.click(screen.getByRole('button', { name: 'Use another method' }));
      // Re-opens the flow passwordless; the device form replaces the passkey step.
      const logins = global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/user/login'));
      expect(String(logins[logins.length - 1][0])).toContain('passwordless=1');
      expect(await screen.findByLabelText('Username')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Use your password instead' })).toBeInTheDocument();
      expect(window.location.href).toBe('');
    });

    test('"Use another method" on the step-up MFA passkey keeps the redirect login', async () => {
      // Reopening passwordless would overwrite the Multi_Factor acr selector.
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { origin: 'https://app.test', pathname: '/dashboard', search: '?signin=mfa', href: '', assign },
      });
      await toPasskeyStep({ assertion: () => ok({}) });
      fireEvent.click(screen.getByRole('button', { name: 'Use another method' }));
      await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/stepup'));
    });
  });

  describe('admin pi.flow', () => {
    const ADMIN_ON = { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' };

    function mockAdminBff({ config, login, credentials }) {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config });
        if (String(url).includes('/pi-flow/credentials')) return credentials();
        if (String(url).includes('/oauth/login')) return login();
        return ok({}, 404);
      });
    }

    // Admin has no choice screen: it opens device-first. `toPassword` (default) strictly clicks
    // 'Use your password instead' (findBy throws if it is missing); false = no modal expected.
    async function mountAndClickAdmin({ toPassword = true } = {}) {
      render(<PiFlowSignInModal />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { navigateToAdminOAuthLogin('/admin'); });
      await chooseAndSettle('password');
      if (toPassword) {
        fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
        await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
      }
    }

    test('admin flag on: opens the PASSWORD form (username+password then MFA), no passwordless param', async () => {
      mockAdminBff({
        config: ADMIN_ON,
        login: () => ok({ flowId: 'fa', status: 'USERNAME_PASSWORD_REQUIRED' }),
        credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/callback?code=c&state=s' }),
      });
      await mountAndClickAdmin();
      // The password form is the password-first flow (the last open): no passwordless=1 on it.
      await waitFor(() => expect(screen.getByLabelText('Password')).toBeInTheDocument());
      const open = global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/login?') && String(u).includes('pi_flow=1')).pop();
      expect(String(open[0])).not.toContain('passwordless=1');
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demoAdmin' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/callback?code=c&state=s'));
      expect(document.querySelector('.pi-flow-signin--admin')).not.toBeNull();
    });

    test('admin flag off: navigateToAdminOAuthLogin keeps the plain redirect', async () => {
      mockAdminBff({
        config: ON,
        login: () => ok({}),
        credentials: () => ok({}),
      });
      await mountAndClickAdmin({ toPassword: false });
      await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/login?return_to=%2Fadmin'));
      expect(screen.queryByLabelText('Username')).toBeNull();
    });

    test('customer flag on but admin flag off: customer modal still works', async () => {
      // mockBff serves the customer route (/oauth/user/login); config ON leaves
      // the admin flag unset, so only the customer dispatch may open the modal.
      mockBff({
        config: ON,
        login: () => ok({ flowId: 'f1' }),
        credentials: () => ok({}),
      });
      render(<PiFlowSignInModal />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
      // Fetch -> res.json() -> setState takes more than one microtask hop; flush
      // until the config chain has settled before dispatching.
      await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
      await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
    await chooseAndSettle('passkey');
      expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    });

    test('admin "Use another method" on the passkey step switches to the device step (admin is device-first now)', async () => {
      mockAdminBff({
        config: ADMIN_ON,
        login: () => ok({ flowId: 'fa' }),
        credentials: () => ok({ step: 'passkey', publicKeyCredentialRequestOptions: { challenge: 'Y2g' } }),
      });
      await mountAndClickAdmin();
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demoAdmin' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Use another method' }));
      await waitFor(() => {
        const reopen = global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/login?')).pop();
        expect(String(reopen[0])).toContain('passwordless=1');
      });
      expect(window.location.href).toBe('');
    });
  });

  describe('passwordless (device step)', () => {
    function mockPasswordlessBff({ passwordless }) {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: ON });
        if (String(url).includes('/pi-flow/passwordless')) return passwordless();
        if (String(url).includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'SIGN_ON_REQUIRED' });
        return ok({}, 404);
      });
    }

    // The device-only form is the modal's default step; just open the modal.
    async function toDeviceStep() {
      await mountAndClick();
      return screen.findByLabelText('Username');
    }

    test('the device form is the default; "Use your password instead" lives in the footer, below the form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({}) });
      await toDeviceStep();
      const link = screen.getByRole('button', { name: 'Use your password instead' });
      expect(link).toBeInTheDocument();
      expect(screen.queryByLabelText('Password')).toBeNull();
      // Footer placement: the link renders after (below) the scrollable form body.
      const formBody = document.querySelector('.pi-flow-signin__form');
      expect(formBody.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // ...and inside the footer actions row, next to Cancel.
      expect(link.closest('.signin-modal__actions')).not.toBeNull();
    });

    test('device submit posts only the username to /pi-flow/passwordless; OTP_REQUIRED moves to the code form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({ step: 'otp' }) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      const submit = screen.getAllByRole('button', { name: 'Sign in' }).pop();
      fireEvent.click(submit);
      fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/passwordless'));
      expect(String(call[0])).toContain('/api/auth/oauth/user/pi-flow/passwordless');
      expect(JSON.parse(call[1].body)).toEqual({ username: 'demo' });
    });

    test('DEVICE_SELECTION_REQUIRED from the device submit shows the picker, not a redirect', async () => {
      mockPasswordlessBff({ passwordless: () => ok({
        step: 'device',
        devices: [
          { id: 'dev-email-1', type: 'EMAIL', email: 'cm****@pingidentity.com' },
          { id: 'dev-fido-1', type: 'FIDO2', nickname: 'My Passkey' },
        ],
      }) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
      expect(await screen.findByRole('radio', { name: /Passkey · My Passkey/ })).toBeInTheDocument();
      expect(window.location.href).not.toContain('/api/auth/oauth');
    });

    test('OTP step with multiple devices shows the picker; picking FIDO2 posts device select and starts the ceremony', async () => {
      const OPTIONS = { challenge: 'Y2g', rpId: 'ping-devops.com' };
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: ON });
        if (String(url).includes('/pi-flow/device')) return ok({ step: 'passkey', publicKeyCredentialRequestOptions: OPTIONS });
        if (String(url).includes('/pi-flow/credentials')) return ok({
          step: 'otp',
          selectedDeviceId: 'dev-email-1',
          devices: [
            { id: 'dev-email-1', type: 'EMAIL', email: 'cm****@pingidentity.com' },
            { id: 'dev-fido-1', type: 'FIDO2', nickname: 'My Passkey' },
          ],
        });
        if (String(url).includes('/oauth/user/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
        return ok({}, 404);
      });
      await mountAndClickPassword();
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      // Picker renders both devices
      expect(await screen.findByRole('radio', { name: /Email · cm\*\*\*\*@pingidentity\.com/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Passkey · My Passkey/ })).toBeInTheDocument();
      // Pick the passkey → device select → ceremony starts
      authenticateWebAuthn.mockResolvedValue({ assertionValue: { id: 'a', response: {} } });
      fireEvent.click(screen.getByRole('radio', { name: /Passkey · My Passkey/ }));
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/pi-flow/device'),
        expect.objectContaining({ method: 'POST' }),
      ));
      const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/device'));
      expect(JSON.parse(call[1].body)).toEqual({ deviceId: 'dev-fido-1' });
    });

    test('OTP step with a single device shows no picker', async () => {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: ON });
        if (String(url).includes('/pi-flow/credentials')) return ok({
          step: 'otp', selectedDeviceId: 'dev-1',
          devices: [{ id: 'dev-1', type: 'EMAIL', email: 'x****@y.z' }],
        });
        if (String(url).includes('/oauth/user/login')) return ok({ flowId: 'f1' });
        return ok({}, 404);
      });
      await mountAndClickPassword();
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await screen.findByLabelText('Verification code');
      expect(screen.queryByRole('radiogroup')).toBeNull();
    });

    test('admin role on the password step posts to the admin router path', async () => {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/admin/config')) return ok({ config: { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' } });
        if (String(url).includes('/pi-flow/credentials')) return ok({ step: 'otp' });
        if (String(url).includes('/oauth/login')) return ok({ flowId: 'fa', status: 'USERNAME_PASSWORD_REQUIRED' });
        return ok({}, 404);
      });
      render(<PiFlowSignInModal />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { navigateToAdminOAuthLogin('/admin'); });
    await chooseAndSettle('password');
      // Admin opens device-first; the password form is one click away.
      fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
      fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demoAdmin' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
      await waitFor(() => {
        const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/credentials'));
        expect(String(call[0])).toContain('/api/auth/oauth/pi-flow/credentials');
      });
    });

    test('409 passwordless_unavailable shows the message and returns to the password form', async () => {
      mockPasswordlessBff({ passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password. Sign in with your password.' }, 409) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
      expect(await screen.findByText(/This account requires a password/)).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      // The typed username survives the round trip.
      expect(screen.getByLabelText('Username')).toHaveValue('demo');
    });

    test('"Use your password instead" switches back, preserving username and password, and re-opens the password-first flow', async () => {
      mockPasswordlessBff({ passwordless: () => ok({}) });
      await mountAndClickPassword();
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use a device instead' }));
      await screen.findByRole('button', { name: 'Use your password instead' });
      const loginsBefore = global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/user/login')).length;
      fireEvent.click(screen.getByRole('button', { name: 'Use your password instead' }));
      expect(await screen.findByLabelText('Password')).toHaveValue('pw');
      expect(screen.getByLabelText('Username')).toHaveValue('demo');
      // Switching back re-opens the flow WITHOUT the passwordless selector.
      await waitFor(() => expect(
        global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/user/login')).length,
      ).toBe(loginsBefore + 1));
      const reopen = global.fetch.mock.calls.filter(([u]) => String(u).includes('/oauth/user/login')).pop();
      expect(String(reopen[0])).not.toContain('passwordless=1');
    });

    test('ignores a second submit while busy', async () => {
      let release;
      mockPasswordlessBff({ passwordless: () => new Promise((r) => { release = r; }) });
      const usernameInput = await toDeviceStep();
      fireEvent.change(usernameInput, { target: { value: 'demo' } });
      const submit = screen.getAllByRole('button', { name: 'Sign in' }).pop();
      fireEvent.click(submit);
      fireEvent.click(submit);
      expect(global.fetch.mock.calls.filter(([u]) => String(u).includes('/pi-flow/passwordless'))).toHaveLength(1);
      release(ok({ step: 'otp' }));
    });
  });

  describe('vertical branding', () => {
    const open = () => ({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({}),
    });

    test('shows the active vertical logo and name in the header', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'PingOne Admin', logoPath: '/branding/ping-logo.png' });
      expect(await screen.findByText('PingOne Admin')).toBeInTheDocument();
      // alt="" on purpose: the name is printed beside it, so the image is decorative.
      expect(document.querySelector('.pi-flow-signin__logo')).toHaveAttribute('src', '/branding/ping-logo.png');
    });

    test('brandCaps renders as the bold caps segment before the full name', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'United Airlines', brandCaps: 'UNITED', logoPath: '/branding/united-airlines-logo.svg' });
      expect(await screen.findByText('United Airlines')).toBeInTheDocument();
      const caps = document.querySelector('.pi-flow-signin__brand-caps');
      expect(caps).not.toBeNull();
      expect(caps).toHaveTextContent('UNITED');
      expect(caps.parentElement).toHaveTextContent('United Airlines');
    });

    test('no brandCaps: the bar shows the name alone, no empty caps segment', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'Some Vertical' });
      expect(await screen.findByText('Some Vertical')).toBeInTheDocument();
      expect(document.querySelector('.pi-flow-signin__brand-caps')).toBeNull();
    });

    test('headerTitle wins over displayName, like the top nav', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'Super Sports', headerTitle: 'Super Sports Pro' });
      expect(await screen.findByText('Super Sports Pro')).toBeInTheDocument();
      expect(screen.queryByText('Super Sports')).toBeNull();
    });

    test('a vertical with no logo shows its name only, no broken image', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'CivicPermit' });
      expect(await screen.findByText('CivicPermit')).toBeInTheDocument();
      expect(document.querySelector('.pi-flow-signin__logo')).toBeNull();
    });

    test('no vertical provider (or no identity): welcome hero without a logo, form still works', async () => {
      mockBff(open());
      await mountAndClick();
      expect(await screen.findByLabelText('Username')).toBeInTheDocument();
      expect(document.querySelector('.pi-flow-signin__hero')).not.toBeNull();
      expect(document.querySelector('.pi-flow-signin__logo')).toBeNull();
      expect(screen.getByText('Welcome back')).toBeInTheDocument();
    });

    test('the PingOne Admin vertical is wired to the Ping logo, and the file exists', () => {
      const root = path.resolve(__dirname, '../../../..');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, 'demo_api_server/config/verticals/pingone-admin/manifest.json'), 'utf8'),
      );
      expect(manifest.identity.logoPath).toBe('/branding/ping-logo.png');
      expect(fs.existsSync(path.join(root, 'demo_api_ui/public', manifest.identity.logoPath))).toBe(true);
    });

    test('every vertical declares a logo (none falls back to name-only in the sign-in modal)', () => {
      const root = path.resolve(__dirname, '../../../..');
      const dir = path.join(root, 'demo_api_server/config/verticals');
      const missing = [];
      for (const id of fs.readdirSync(dir)) {
        const file = path.join(dir, id, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        if (!JSON.parse(fs.readFileSync(file, 'utf8')).identity?.logoPath) missing.push(id);
      }
      expect(missing).toEqual([]);
    });

    test('every vertical that declares a logo points at a real file or a brand CDN URL', () => {
      const root = path.resolve(__dirname, '../../../..');
      const dir = path.join(root, 'demo_api_server/config/verticals');
      for (const id of fs.readdirSync(dir)) {
        const file = path.join(dir, id, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        const logoPath = JSON.parse(fs.readFileSync(file, 'utf8')).identity?.logoPath;
        if (!logoPath) continue;
        if (/^https?:\/\//.test(logoPath)) {
          // Real-company verticals reference the Brandfetch CDN (lockup assets
          // served by the brand), not a repo file.
          expect(logoPath, `${id}: CDN logo`).toMatch(/^https:\/\/cdn\.brandfetch\.io\//);
        } else {
          expect(fs.existsSync(path.join(root, 'demo_api_ui/public', logoPath)), `${id}: ${logoPath}`).toBe(true);
        }
      }
    });

    test('demo verticals declare brandCaps, lockup verticals and admin surfaces do not', () => {
      const root = path.resolve(__dirname, '../../../..');
      const dir = path.join(root, 'demo_api_server/config/verticals');
      // Lockup verticals: real companies whose Brandfetch logo carries its own
      // wordmark — caps would print the name twice (SignInBrand suppresses it).
      const LOCKUP = ['airlines', 'walbuy'];
      const noCaps = [];
      const lockupWithCaps = [];
      const adminWithCaps = [];
      for (const id of fs.readdirSync(dir)) {
        const file = path.join(dir, id, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        const caps = manifest.identity?.brandCaps;
        if (['admin', 'admin-console', 'pingone-admin'].includes(id)) {
          if (caps) adminWithCaps.push(id);
        } else if (LOCKUP.includes(id)) {
          if (caps) lockupWithCaps.push(id);
        } else if (!caps) {
          noCaps.push(id);
        }
      }
      expect(noCaps).toEqual([]);
      expect(lockupWithCaps).toEqual([]);
      expect(adminWithCaps).toEqual([]);
    });
  });
});

// File-scope mounts (the shared helpers live inside the main describe). Each
// appended describe stubs window.location itself — the main describe's
// beforeEach does not reach them.
async function mountAndClickLocal() {
  render(<PiFlowSignInModal />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { navigateToCustomerOAuthLogin('/dashboard'); });
  await chooseAndSettle('passkey');
}
async function mountAndClickAdminLocal() {
  render(<PiFlowSignInModal />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { navigateToAdminOAuthLogin('/admin'); });
  await chooseAndSettle('password');
}

function stubLocation() {
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign },
  });
  return assign;
}

describe('PiFlowSignInModal login-hint persistence', () => {
  let assign;
  beforeEach(() => {
    assign = stubLocation();
  });

  test('username prefills from the open response usernameHint; typing never stores a hint (only a successful sign-in does)', async () => {
    vi.useFakeTimers();
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED', usernameHint: 'stored@pingone.com' }),
      credentials: () => ok({ error: 'invalid_credentials', message: 'no' }, 401),
    });
    await mountAndClickLocal();
    const box = await screen.findByLabelText('Username');
    expect(box.value).toBe('stored@pingone.com'); // prefilled from the open response
    fireEvent.change(box, { target: { value: 'typed@pingone.com' } });
    await act(async () => { vi.advanceTimersByTime(900); });
    const put = global.fetch.mock.calls.find(([u, i]) => String(u).includes('/login-hint') && i?.method === 'PUT');
    expect(put).toBeUndefined();
    vi.useRealTimers();
  });

  test('admin: prefills from usernameHint; typing never stores a hint', async () => {
    vi.useFakeTimers();
    // mockAdminBff lives in the 'admin pi.flow' describe's scope; inline the
    // same arms here for the admin router's URL set.
    const adminCfg = { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' };
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/api/admin/config')) return ok({ config: adminCfg });
      if (String(url).includes('/pi-flow/credentials')) return ok({ error: 'invalid_credentials', message: 'no' }, 401);
      if (String(url).includes('/oauth/login')) return ok({ flowId: 'fa', status: 'USERNAME_PASSWORD_REQUIRED', usernameHint: 'storedAdmin@pingone.com' });
      return ok({}, 404);
    });
    await mountAndClickAdminLocal();
    const box = await screen.findByLabelText('Username');
    expect(box.value).toBe('storedAdmin@pingone.com');
    fireEvent.change(box, { target: { value: 'typedAdmin@pingone.com' } });
    await act(async () => { vi.advanceTimersByTime(900); });
    const put = global.fetch.mock.calls.find(([u, i]) => String(u).includes('/login-hint') && i?.method === 'PUT');
    expect(put).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('PiFlowSignInModal passwordless-first default', () => {
  let assign;
  beforeEach(() => {
    assign = stubLocation();
  });

  test('the modal opens on the device-only (passwordless) step with passwordless=1', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'SIGN_ON_REQUIRED' }),
      credentials: () => ok({}),
    });
    await mountAndClickLocal();
    const open = global.fetch.mock.calls.find(([u]) => String(u).includes('/login?') && String(u).includes('pi_flow=1'));
    expect(String(open[0])).toContain('passwordless=1');
    expect(await screen.findByText("We'll verify it's you with your registered device — no password needed.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  test('policy-absent 400 on the passwordless open snaps to the password form inside the modal', async () => {
    let call = 0;
    mockBff({
      config: ON,
      login: () => (++call === 1
        ? ok({ error: 'invalid_sign_on_policy' }, 400)
        : ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' })),
      credentials: () => ok({}),
    });
    await mountAndClickLocal();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(window.location.href).toBe('');
    expect(assign).not.toHaveBeenCalled();
  });

  test('409 passwordless_unavailable keeps the typed username in the password form', async () => {
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'SIGN_ON_REQUIRED' }),
      passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password.' }, 409),
      credentials: () => ok({}),
    });
    await mountAndClickLocal();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'keepme@pingone.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('keepme@pingone.com');
  });

  test('passkey ceremony failure keeps the password one click away (no dead end)', async () => {
    // FIDO2-only user whose authenticator is missing: the passkey step's error
    // state must still offer the path back to the password form.
    mockBff({
      config: ON,
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ step: 'passkey', publicKeyCredentialRequestOptions: { challenge: 'abc' } }),
      assertion: () => ok({ error: 'pi_flow_failed' }, 502),
      passwordless: () => ok({ error: 'passwordless_unavailable', message: 'This account requires a password.' }, 409),
    });
    await mountAndClickLocal();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'fidouser@pingone.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/This account requires a password/i)).toBeInTheDocument();
    // switch to password, sign in, land on the passkey step, see the retry affordances
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Verify it is you with your passkey/i)).toBeInTheDocument();
    vi.mocked(authenticateWebAuthn).mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    fireEvent.click(screen.getByRole('button', { name: /verify with passkey/i }));
    expect(await screen.findByText(/No passkey was used/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use another method' })).toBeInTheDocument();
  });
});

// ── Review-fix pins ──────────────────────────────────────────────────────────
describe('PiFlowSignInModal review-fix pins', () => {
  let assign;
  beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'https://app.test', pathname: '/dashboard', href: '', assign },
    });
  });

  test('PF passwordless 409 (pi_flow_step_unsupported) snaps to the password form inside the modal', async () => {
    mockBff({
      config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'pf1', usernameHint: 'demouser' }),
      credentials: () => ok({}),
      passwordless: () => ok({ error: 'pi_flow_step_unsupported' }, 409),
    });
    await mountAndClickLocal();
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demouser' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).pop());
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(window.location.href).toBe(''); // no full-page redirect
    expect(assign).not.toHaveBeenCalled();
  });

  test('?signin=mfa does not send passwordless=1 (the mfa selector owns acr_values)', async () => {
    window.location.search = '?signin=mfa';
    mockBff({
      config: { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' },
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    // This pin only inspects the OPEN call — the dispatch alone is enough; no
    // need to reach the password form (mountAndClickPassword is main-scope).
    await mountAndClickLocal();
    const open = global.fetch.mock.calls.find(([u]) => String(u).includes('/login?') && String(u).includes('pi_flow=1'));
    expect(String(open[0])).toContain('mfa=1');
    expect(String(open[0])).not.toContain('passwordless=1');
  });
});

// Passwordless sign-in project: customers open on a choice screen; password + approval link adds a CIBA second factor.
describe('PiFlowSignInModal choice screen (passwordless / password + approval link / password)', () => {
  let assign;
  beforeEach(() => { assign = stubLocation(); });

  const ADMIN_ON = { ...ON, PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true' };
  const START = { authReqId: 'b'.repeat(48), matchCode: 'Q9-17', expiresIn: 120, interval: 2 };
  const APPROVAL_BTN = 'Sign in with password + approval link (email or text)';
  const NO_PASSWORD_BTN = 'Sign in without a password';

  function mockChoiceBff({ config = ADMIN_ON, credentials, poll, start } = {}) {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config });
      if (u.includes('/identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
      if (u.includes('/ciba/login/start')) return start ? start() : ok(START);
      if (u.includes('/ciba/login/poll/')) return poll ? poll() : ok({ status: 'pending' });
      if (u.includes('/pi-flow/credentials')) return credentials ? credentials() : ok({}, 404);
      if (u.includes('/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
      return ok({}, 404);
    });
  }
  const credentialBodies = () =>
    global.fetch.mock.calls.filter(([u]) => String(u).includes('/pi-flow/credentials')).map(([, init]) => JSON.parse(init.body));

  async function open(role) {
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { (role === 'admin' ? navigateToAdminOAuthLogin : navigateToCustomerOAuthLogin)('/x'); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  }
  async function submitPassword() {
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  test.each(['pingone', 'pingfederate'])('%s customer: choice screen with both paths and a plain-password link, no flow opened yet', async (provider) => {
    mockChoiceBff({ config: { ...ADMIN_ON, oauth_provider: provider } });
    await open('customer');
    expect(screen.getByRole('button', { name: NO_PASSWORD_BTN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: APPROVAL_BTN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a password instead' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('pi_flow=1'))).toBe(false);
  });

  test('admin: NO choice screen; opens device-first as before', async () => {
    mockChoiceBff();
    await open('admin');
    expect(screen.queryByRole('button', { name: APPROVAL_BTN })).toBeNull();
    expect(screen.queryByRole('button', { name: NO_PASSWORD_BTN })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Use your password instead' })).toBeInTheDocument();
    const o = global.fetch.mock.calls.find(([u]) => String(u).includes('pi_flow=1'));
    expect(String(o[0])).toContain('passwordless=1');
  });

  test('"Use a password instead" opens the plain password step and sends NO secondFactor', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=1' }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=1'));
    const o = global.fetch.mock.calls.find(([u]) => String(u).includes('pi_flow=1'));
    expect(String(o[0])).not.toContain('passwordless=1');
    expect(credentialBodies()).toEqual([{ username: 'demo', password: 'pw' }]);
  });

  test('the passwordless button opens the device flow and a later password submit sends NO secondFactor', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=2' }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: NO_PASSWORD_BTN }));
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    const o = global.fetch.mock.calls.find(([u]) => String(u).includes('pi_flow=1'));
    expect(String(o[0])).toContain('passwordless=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(credentialBodies()).toEqual([{ username: 'demo', password: 'pw' }]);
  });

  test('approval button: password form; the credentials POST carries secondFactor ciba', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=3' }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=3')); // secondFactorSkipped-style redirect: as today
    expect(credentialBodies()).toEqual([{ username: 'demo', password: 'pw', secondFactor: 'ciba' }]);
    const o = global.fetch.mock.calls.find(([u]) => String(u).includes('pi_flow=1'));
    expect(String(o[0])).not.toContain('passwordless=1');
  });

  test('{step:approval} shows the panel with only the offered channels and NO navigation', async () => {
    mockChoiceBff({ credentials: () => ok({ step: 'approval', channels: ['email'] }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    expect(await screen.findByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Text message' })).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  test('approved navigates exactly as after a COMPLETED pi.flow', async () => {
    let approved = false;
    mockChoiceBff({
      credentials: () => ok({ step: 'approval', channels: ['email', 'sms'] }),
      poll: () => ok(approved ? { status: 'approved', redirectTo: 'https://app.test/cb?code=1' } : { status: 'pending' }),
    });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    expect(await screen.findByText('Q9-17')).toBeInTheDocument();
    const start = global.fetch.mock.calls.find(([u]) => String(u).includes('/ciba/login/start'));
    expect(JSON.parse(start[1].body)).toEqual({ channel: 'email' });
    expect(assign).not.toHaveBeenCalled();
    approved = true;
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?code=1'), { timeout: 4000 });
  });

  test('Cancel on the waiting screen returns to the choice screen via a fresh begin()', async () => {
    mockChoiceBff({ credentials: () => ok({ step: 'approval', channels: ['email'] }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    await screen.findByText('Q9-17');
    // The modal footer has its own Cancel (closes the modal); the panel's Cancel comes first in the DOM.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    expect(await screen.findByRole('button', { name: APPROVAL_BTN })).toBeInTheDocument();
  });

  test('a poll failure shows Try again, which returns to the choice screen', async () => {
    mockChoiceBff({
      credentials: () => ok({ step: 'approval', channels: ['email'] }),
      poll: () => ok({ status: 'denied' }, 403),
    });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    fireEvent.click(await screen.findByRole('button', { name: 'Email' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }));
    expect(await screen.findByRole('button', { name: APPROVAL_BTN })).toBeInTheDocument();
  }, 10000);

  test('502 approval_unavailable reopens a FRESH password-first flow; the next submit is plain and works only against it', async () => {
    // Server model: the 502 means the flow already COMPLETED, so a credentials post is refused
    // (400 -> 502 pi_flow_failed upstream) unless /login?pi_flow=1 was opened again since.
    let freshFlow = true;
    let n = 0;
    mockChoiceBff({
      credentials: () => {
        if (++n === 1) { freshFlow = false; return ok({ error: 'approval_unavailable' }, 502); }
        return freshFlow ? ok({ redirectTo: 'https://app.test/cb?x=4' }) : ok({ error: 'pi_flow_failed' }, 502);
      },
    });
    const base = global.fetch;
    global.fetch = vi.fn((url, init) => {
      if (String(url).includes('pi_flow=1') && n >= 1) freshFlow = true;
      return base(url, init);
    });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    expect(await screen.findByText(/Approval link isn't available right now\. Sign in with your password instead, or try again\./)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    const opens = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/login?') && String(u).includes('pi_flow=1'));
    await waitFor(() => expect(opens()).toHaveLength(2));
    expect(String(opens()[1][0])).not.toContain('passwordless=1');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=4'));
    expect(credentialBodies()).toEqual([
      { username: 'demo', password: 'pw', secondFactor: 'ciba' },
      { username: 'demo', password: 'pw' },
    ]);
  });

  const SKIPPED_MSG = 'Signed in with your password only: no approval link is available for this account.';

  test('approval chosen + secondFactorSkipped redirect: still navigates, and the overlay says password only', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=5', secondFactorSkipped: true }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=5'));
    expect(screen.getByText(SKIPPED_MSG)).toBeInTheDocument();
  });

  test('plain redirect after the approval button (no skipped marker) keeps the normal Signing in message', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=6' }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: APPROVAL_BTN }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=6'));
    expect(screen.queryByText(SKIPPED_MSG)).toBeNull();
    expect(screen.getByText('Signing in...')).toBeInTheDocument();
  });

  test('skipped marker without the approval button (plain password) keeps the normal Signing in message', async () => {
    mockChoiceBff({ credentials: () => ok({ redirectTo: 'https://app.test/cb?x=7', secondFactorSkipped: true }) });
    await open('customer');
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    await submitPassword();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/cb?x=7'));
    expect(screen.queryByText(SKIPPED_MSG)).toBeNull();
    expect(screen.getByText('Signing in...')).toBeInTheDocument();
  });
});

// Flag off (the shipped default): the modal is exactly the pre-CIBA modal, no choice screen, no CIBA button.
describe('PiFlowSignInModal with ciba_login_enabled off', () => {
  beforeEach(() => { stubLocation(); });
  const OFF = { PINGONE_USER_AUTHORIZE_PI_FLOW: 'true', PINGONE_ADMIN_AUTHORIZE_PI_FLOW: 'true', oauth_provider: 'pingone' };

  async function openOff(role, config) {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config });
      if (u.includes('/identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
      if (u.includes('/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
      return ok({}, 404);
    });
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { (role === 'admin' ? navigateToAdminOAuthLogin : navigateToCustomerOAuthLogin)('/x'); });
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  }
  const openUrl = () => String(global.fetch.mock.calls.find(([u]) => String(u).includes('pi_flow=1'))[0]);

  test.each([['absent', OFF], ['"false"', { ...OFF, ciba_login_enabled: 'false' }]])('flag %s: customer opens device-first, no choice screen or CIBA button', async (_n, cfg) => {
    await openOff('customer', cfg);
    expect(screen.queryByRole('button', { name: 'Sign in with CIBA (email or SMS)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use a password instead' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Use your password instead' })).toBeInTheDocument();
    expect(openUrl()).toContain('passwordless=1');
  });

  test('flag off: admin opens device-first (passwordless=1); the password form is one click away', async () => {
    await openOff('admin', OFF);
    expect(screen.queryByRole('button', { name: 'Sign in with CIBA (email or SMS)' })).toBeNull();
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(openUrl()).toContain('passwordless=1');
    expect(screen.getByRole('button', { name: 'Use your password instead' })).toBeInTheDocument();
  });

  test('flag off: the credentials POST never carries secondFactor', async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/admin/config')) return ok({ config: OFF });
      if (u.includes('/identifier-policy')) return ok({ rejectPlusAddressing: false, allowedIdentifiers: [] });
      if (u.includes('/pi-flow/credentials')) return ok({ redirectTo: 'https://app.test/cb' });
      if (u.includes('/login')) return ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' });
      return ok({}, 404);
    });
    render(<PiFlowSignInModal />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/config'), expect.anything()));
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
    await act(async () => { navigateToCustomerOAuthLogin('/x'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Use your password instead' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/pi-flow/credentials'))).toBe(true));
    const [, init] = global.fetch.mock.calls.find(([u]) => String(u).includes('/pi-flow/credentials'));
    expect(JSON.parse(init.body)).toEqual({ username: 'demo', password: 'pw' });
  });
});
