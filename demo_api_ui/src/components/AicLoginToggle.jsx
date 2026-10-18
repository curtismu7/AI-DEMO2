import { useEffect, useState } from 'react';
import bffAxios from '../services/bffAxios';
import { isAicLoginEnabled } from '../utils/aicLogin';
import { notifyError } from '../utils/appToast';
import DeviceSignInLink from './DeviceSignInLink';
import './OAuthProviderToggle.css';

/**
 * AicLoginToggle — top-nav pill that sends customer sign-in to PingOne Advanced
 * Identity Cloud (AIC). PingOne stays the authorization server: AIC is an
 * external IdP behind it, reached through the AIC_Login sign-on policy, so the
 * token chain is unchanged. Only meaningful in PingOne mode; hidden otherwise.
 *
 * Reuses the P1 ⇄ PF pill's styles: "--pingone" highlights the left option,
 * "--aic" the right one with the same amber "non-default mode" tint.
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
          setEnabled(isAicLoginEnabled(cfg));
        }
      })
      .catch(() => { /* unconfigured — toggle stays hidden on null */ });
    return () => { cancelled = true; };
  }, []);

  if (enabled === null) return null;

  async function toggle() {
    if (saving) return;
    setSaving(true);
    let switched = false;
    try {
      await bffAxios.post('/api/admin/config', { aic_login_enabled: String(!enabled) });
      switched = true;
      setEnabled(!enabled);
      // Sign out so the next sign-in goes through the selected identity source.
      await bffAxios.post('/api/auth/clear-session');
      window.dispatchEvent(new CustomEvent('userLoggedOut'));
      // The reload lands on the sign-in prompt, which is the cue; a toast would die with the page.
      window.location.reload();
    } catch (err) {
      const reason = err?.response?.data?.message || err.message;
      if (err?.response?.data?.error === 'not_authorized') {
        notifyError('Admin session required to switch the sign-in source');
      } else if (switched) {
        notifyError(`Sign-in source switched, but the session was not cleared (${reason}) — sign out and back in`);
      } else {
        notifyError(`AIC switch failed: ${reason}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`oauth-provider-toggle oauth-provider-toggle--${enabled ? 'aic' : 'pingone'}${saving ? ' oauth-provider-toggle--saving' : ''}`}
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
      <DeviceSignInLink compact />
    </>
  );
}
