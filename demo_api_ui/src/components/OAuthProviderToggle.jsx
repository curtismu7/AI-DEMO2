import { useEffect, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifySuccess } from '../utils/appToast';
import { clearIdJagRunStateForProviderSwitch } from '../utils/idJagRunMode';
import './OAuthProviderToggle.css';

/**
 * OAuthProviderToggle — admin-only top-nav pill that switches the BFF's OAuth
 * provider (PingOne ⇄ PingFederate) at runtime via POST /api/admin/config.
 *
 * Why no restart is needed: every OAuth config getter (config/oauth.js,
 * config/oauthUser.js, services/oauthEndpointResolver.js) calls
 * configStore.getOAuthProvider() lazily per request, and getEffective resolves
 * oauth_provider from configStore/LMDB when the env var is absent.
 *
 * Switching provider invalidates the current token chain (a PingOne access
 * token will not validate against PingFederate's JWKS and vice versa), so the
 * caller should sign out / re-login after toggling. Clear the BFF session and
 * reload the current page so the next sign-in uses the selected provider
 * without losing the user's place.
 */
export default function OAuthProviderToggle() {
  const [provider, setProvider] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bffAxios.get('/api/admin/config')
      .then((res) => {
        if (!cancelled) setProvider(res?.data?.config?.oauth_provider || 'pingone');
      })
      .catch(() => { /* unconfigured / not admin — toggle stays hidden on null */ });
    return () => { cancelled = true; };
  }, []);

  if (!provider) return null;

  const next = provider === 'pingfederate' ? 'pingone' : 'pingfederate';

  async function toggle() {
    if (saving) return;
    setSaving(true);
    try {
      // Drop any saved pre-run provider WITHOUT restoring it, or it overwrites this choice.
      await clearIdJagRunStateForProviderSwitch();
      await bffAxios.post('/api/admin/config', { oauth_provider: next });
      setProvider(next);
      notifySuccess(`Login provider switched to ${next === 'pingone' ? 'PingOne' : 'PingFederate'} — please sign in again`);
      // Current session tokens belong to the previous provider — force re-login.
      await bffAxios.post('/api/auth/clear-session');
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
      window.location.reload();
    } catch (err) {
      if (err?.response?.data?.error === 'not_authorized') {
        notifyError('Admin session required to switch login provider');
      } else if (err?.response?.data?.error === 'pf_unreachable') {
        // Server refused the switch — PF discovery is unreachable from the BFF.
        // Do not flip the local state; the provider is unchanged.
        notifyError('PingFederate is not reachable from the server — staying on PingOne');
      } else {
        notifyError(`Provider switch or session clear failed: ${err?.response?.data?.message || err.message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`oauth-provider-toggle oauth-provider-toggle--${provider}${saving ? ' oauth-provider-toggle--saving' : ''}`}
      onClick={toggle}
      disabled={saving}
      title={`Login provider: ${provider === 'pingfederate' ? 'PingFederate' : 'PingOne'}. Click to switch to ${next === 'pingfederate' ? 'PingFederate' : 'PingOne'}. You will be signed out and asked to log in again.`}
      aria-pressed={provider === 'pingfederate'}
      aria-label="Toggle OAuth login provider"
    >
      <span className="oauth-provider-toggle__option">P1</span>
      <span className="oauth-provider-toggle__knob" aria-hidden="true" />
      <span className="oauth-provider-toggle__option">PF</span>
    </button>
  );
}
