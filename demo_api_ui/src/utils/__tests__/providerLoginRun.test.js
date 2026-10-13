import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const notifyError = vi.fn();
const forceLogin = vi.fn();
vi.mock('../../services/bffAxios', () => ({ default: { post: (...a) => post(...a) } }));
vi.mock('../appToast', () => ({ notifyError: (...a) => notifyError(...a) }));
vi.mock('../authUi', () => ({ navigateToCustomerOAuthForceLogin: (...a) => forceLogin(...a) }));

const { LOGIN_RUN_PROVIDERS, runProviderLogin } = await import('../providerLoginRun');

const refused = (error) => Object.assign(new Error('refused'), { response: { data: { error } } });

describe('runProviderLogin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the Login steps to their providers', () => {
    expect(LOGIN_RUN_PROVIDERS).toEqual({ 'UC-LOGIN': 'pingone', 'UC-LOGIN-PF': 'pingfederate', 'UC-LOGIN-AIC': 'aic' });
  });

  it('switches the provider, then forces a fresh sign-in', async () => {
    post.mockResolvedValue({});
    expect(await runProviderLogin('pingfederate')).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/admin/config', { oauth_provider: 'pingfederate', aic_login_enabled: 'false' });
    expect(forceLogin).toHaveBeenCalledWith('/resource-server');
  });

  it('an AIC run keeps PingOne as the provider and turns AIC sign-in on', async () => {
    post.mockResolvedValue({});
    expect(await runProviderLogin('aic')).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/admin/config', { oauth_provider: 'pingone', aic_login_enabled: 'true' });
    expect(forceLogin).toHaveBeenCalledWith('/resource-server');
  });

  it('stops an AIC run when the switch is refused, instead of signing in on PingOne', async () => {
    post.mockRejectedValue(refused('not_authorized'));
    expect(await runProviderLogin('aic')).toBe(false);
    expect(forceLogin).not.toHaveBeenCalled();
  });

  it('stops a PingFederate run when the switch is refused', async () => {
    post.mockRejectedValue(refused('not_authorized'));
    expect(await runProviderLogin('pingfederate')).toBe(false);
    expect(forceLogin).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('Admin session required'));
  });

  it('lets a PingOne run carry on when the switch is refused', async () => {
    post.mockRejectedValue(refused('not_authorized'));
    expect(await runProviderLogin('pingone')).toBe(true);
    expect(forceLogin).toHaveBeenCalledTimes(1);
  });

  it('never signs in when PingFederate is unreachable', async () => {
    post.mockRejectedValue(refused('pf_unreachable'));
    expect(await runProviderLogin('pingone')).toBe(false);
    expect(forceLogin).not.toHaveBeenCalled();
  });
});
