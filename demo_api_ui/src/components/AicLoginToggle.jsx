import { useEffect, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { notifyError, notifySuccess } from '../utils/appToast';
import './OAuthProviderToggle.css';

/**
 * AicLoginToggle — top-nav pill that sends customer sign-in to PingOne Advanced
 * Identity Cloud (AIC). PingOne stays the authorization server: AIC is an
 * external IdP behind it, reached through the AIC_Login sign-on policy, so the
 * token chain is unchanged. Only meaningful in PingOne mode; hidden otherwise.
 *
 * Reuses the P1 ⇄ PF pill's styles: "--pingone" highlights the left option,
 * "--pingfederate" the right one with the amber "non-default mode" tint.
 */
export default function AicLoginToggle() {
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bffAxios.get('/api/admin/config')
      .then((res) => {
        const cfg = res?.data?.config || {};
        if (!cancelled && (cfg.oauth_provider || 'pingone') === 'pingone') {
          setEnabled(String(cfg.aic_login_enabled).toLowerCase() === 'true');
        }
      })
      .catch(() => { /* unconfigured — toggle stays hidden on null */ });
    return () => { cancelled = true; };
  }, []);

  if (enabled === null) return null;

  async function toggle() {
    if (saving) return;
    setSaving(true);
    try {
      await bffAxios.post('/api/admin/config', { aic_login_enabled: String(!enabled) });
      setEnabled(!enabled);
      notifySuccess(`Customer sign-in now uses ${!enabled ? 'AIC' : 'PingOne'} — please sign in again`);
      // Sign out so the next sign-in goes through the selected identity source.
      await bffAxios.post('/api/auth/clear-session');
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
      window.location.reload();
    } catch (err) {
      if (err?.response?.data?.error === 'not_authorized') {
        notifyError('Admin session required to switch the sign-in source');
      } else {
        notifyError(`AIC switch or session clear failed: ${err?.response?.data?.message || err.message}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`oauth-provider-toggle oauth-provider-toggle--${enabled ? 'pingfederate' : 'pingone'}${saving ? ' oauth-provider-toggle--saving' : ''}`}
      onClick={toggle}
      disabled={saving}
      title={`Customer sign-in: ${enabled ? 'AIC (federated through PingOne)' : 'PingOne'}. Click to switch to ${enabled ? 'PingOne' : 'AIC'}. You will be signed out and asked to log in again.`}
      aria-pressed={enabled}
      aria-label="Toggle AIC customer sign-in"
    >
      <span className="oauth-provider-toggle__option">P1</span>
      <span className="oauth-provider-toggle__knob" aria-hidden="true" />
      <span className="oauth-provider-toggle__option">AIC</span>
    </button>
  );
}
