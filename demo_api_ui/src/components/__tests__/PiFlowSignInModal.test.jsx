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

  test('?signin=mfa on the page adds mfa=1 to the BFF login call', async () => {
    window.location.search = '?signin=mfa';
    mockBff({ config: ON, login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }), credentials: () => ok({}) });
    await mountAndClick();
    await screen.findByLabelText('Username');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/login?') && String(u).includes('mfa=1'))).toBe(true);
  });

  test('?signin=mfa on PingFederate goes straight to the hosted step-up login (no second password page)', async () => {
    window.location.search = '?signin=mfa';
    mockBff({ config: { ...ON, oauth_provider: 'pingfederate' }, login: () => ok({ flowId: 'f1' }), credentials: () => ok({}) });
    await mountAndClick();
    await waitFor(() => expect(window.location.href).toContain('/api/auth/oauth/user/stepup?return_to=%2Fdashboard'));
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/login?'))).toBe(false);
  });

  test('PingFederate selected: opens the same form (the BFF drives the PF flow)', async () => {
    mockBff({
      config: { ...ON, oauth_provider: 'pingfederate' },
      login: () => ok({ flowId: 'f1', status: 'USERNAME_PASSWORD_REQUIRED' }),
      credentials: () => ok({ redirectTo: 'https://app.test/api/auth/oauth/user/callback?code=c&state=s' }),
    });
    await mountAndClick();
    expect(window.location.href).toBe('');
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'demouser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.test/api/auth/oauth/user/callback?code=c&state=s'));
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

  describe('vertical branding', () => {
    const open = () => ({
      config: ON,
      login: () => ok({ flowId: 'f1' }),
      credentials: () => ok({}),
    });

    test('shows the active vertical logo and name in the header', async () => {
      mockBff(open());
      await mountAndClick({ displayName: 'PingOne Admin', logoPath: '/branding/ping-logo.svg' });
      expect(await screen.findByText('PingOne Admin')).toBeInTheDocument();
      // alt="" on purpose: the name is printed beside it, so the image is decorative.
      expect(document.querySelector('.pi-flow-signin__logo')).toHaveAttribute('src', '/branding/ping-logo.svg');
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

    test('no vertical provider (or no identity): no header, form still works', async () => {
      mockBff(open());
      await mountAndClick();
      expect(await screen.findByLabelText('Username')).toBeInTheDocument();
      expect(document.querySelector('.pi-flow-signin__brand')).toBeNull();
    });

    test('the PingOne Admin vertical is wired to the Ping logo, and the file exists', () => {
      const root = path.resolve(__dirname, '../../../..');
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, 'demo_api_server/config/verticals/pingone-admin/manifest.json'), 'utf8'),
      );
      expect(manifest.identity.logoPath).toBe('/branding/ping-logo.svg');
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

    test('every vertical that declares a logo points at a file that exists', () => {
      const root = path.resolve(__dirname, '../../../..');
      const dir = path.join(root, 'demo_api_server/config/verticals');
      for (const id of fs.readdirSync(dir)) {
        const file = path.join(dir, id, 'manifest.json');
        if (!fs.existsSync(file)) continue;
        const logoPath = JSON.parse(fs.readFileSync(file, 'utf8')).identity?.logoPath;
        if (logoPath) expect(fs.existsSync(path.join(root, 'demo_api_ui/public', logoPath)), `${id}: ${logoPath}`).toBe(true);
      }
    });
  });
});
