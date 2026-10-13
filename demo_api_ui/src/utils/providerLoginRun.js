import bffAxios from '../services/bffAxios';
import { notifyError } from './appToast';
import { navigateToCustomerOAuthForceLogin } from './authUi';

export const LOGIN_RUN_PROVIDERS = Object.freeze({
  'UC-LOGIN': 'pingone',
  'UC-LOGIN-PF': 'pingfederate',
  'UC-LOGIN-AIC': 'aic',
});

const LABELS = { pingone: 'PingOne', pingfederate: 'PingFederate', aic: 'AIC' };

/**
 * Live sign-in for the Login steps: point the BFF at `provider`, then force a
 * fresh sign-in (force=true clears the current session and sends prompt=login).
 * Switching the provider needs an admin session. If that write is refused, a
 * PingOne run carries on (it is the default provider) and a PingFederate run
 * stops with a message instead of silently signing in on the wrong provider.
 *
 * `aic` is not a provider of its own: PingOne stays the provider and
 * aic_login_enabled routes the sign-in to AIC behind it. Every run writes that
 * flag, so the PingOne and PingFederate steps turn AIC sign-in back off.
 */
export async function runProviderLogin(provider) {
  const aic = provider === 'aic';
  try {
    await bffAxios.post('/api/admin/config', {
      oauth_provider: aic ? 'pingone' : provider,
      aic_login_enabled: String(aic),
    });
  } catch (err) {
    const code = err?.response?.data?.error;
    if (code === 'pf_unreachable') {
      notifyError('PingFederate is not reachable from the server');
      return false;
    }
    if (provider !== 'pingone') {
      notifyError(code === 'not_authorized'
        ? `Admin session required to switch the login provider to ${LABELS[provider]}`
        : `Could not switch the login provider to ${LABELS[provider]}: ${err?.response?.data?.message || err.message}`);
      return false;
    }
  }
  // Ends on the OIDC Resource Server page: the login token itself is shown
  // and used there, with no exchange, P1AZ or Agent Gateway in between.
  navigateToCustomerOAuthForceLogin('/resource-server');
  return true;
}
