// One entry point for every sign-in in the app: opens the branded pi.flow
// modal when the BFF reports it drivable, and falls back to the redirect
// login in exactly one place. `authUi`'s navigateTo*Login functions are thin
// wrappers over this module, and the de-bypassed pages call it directly.
import { PI_FLOW_SIGNIN_EVENT, navigateToCustomerOAuthLoginRaw, navigateToCustomerOAuthForceLoginRaw, navigateToAdminOAuthLoginRaw } from './authUi';

let inited = null;
let available = { customer: false, admin: false };

export function isSignInAvailable() {
  return available;
}

export function initSignInService() {
  if (!inited) {
    inited = (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: 'include' });
        if (!res.ok) throw new Error('config walled');
        const cfg = (await res.json())?.config || {};
        const drivable = ['pingone', 'pingfederate'].includes(cfg.oauth_provider || 'pingone');
        available = {
          // AIC login runs in the modal too: a popup does the hop to AIC (see PiFlowSignInModal).
          customer: drivable
            && ['true', '1'].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase()),
          admin: drivable && ['true', '1'].includes(String(cfg.PINGONE_ADMIN_AUTHORIZE_PI_FLOW).toLowerCase()),
        };
      } catch {
        // Signed out of the wall, /api/admin/config answers 401, so the config is unknown. The public
        // identifier-policy says whether the front-door pi.flow can run; only the customer front door exists.
        available = { customer: false, admin: false }; // redirect fallback unless the front door says otherwise
        try {
          const pol = await fetch(`${apiBase()}/api/auth/hosted-access/identifier-policy`, { credentials: 'include' });
          const body = pol.ok ? await pol.json().catch(() => null) : null;
          if (body?.frontDoorPiFlow === true) available = { customer: true, admin: false };
        } catch {
          /* keep the redirect fallback */
        }
      }
    })();
  }
  return inited;
}

export function openSignIn({ role = 'customer', returnTo, force, redirect = false, keepHint = false } = {}) {
  // Dispatch when the service KNOWS the role's modal is drivable — or before
  // init has run at all, where "false" just means "unknown" and the modal's
  // own config gate (detail.handled) is the authority. redirect: skip the modal
  // and go to the provider's own login page.
  const known = role === 'admin' ? 'admin' : 'customer';
  // Every caller lands back on the page it started from; the redirect fallback already did this, the modal did not.
  if (!returnTo && typeof window !== 'undefined' && window.location.pathname !== '/') returnTo = window.location.pathname;
  if (!redirect && (available[known] || !inited) && typeof window !== 'undefined') {
    const detail = { returnTo, role, force: Boolean(force), keepHint: Boolean(keepHint), handled: false };
    window.dispatchEvent(new CustomEvent(PI_FLOW_SIGNIN_EVENT, { detail }));
    if (detail.handled) return;
  }
  // One fallback, in one place.
  if (role === 'admin') navigateToAdminOAuthLoginRaw(returnTo);
  else if (force) navigateToCustomerOAuthForceLoginRaw(returnTo);
  else navigateToCustomerOAuthLoginRaw(returnTo);
}

export function openAdminSignIn({ returnTo, force } = {}) {
  return openSignIn({ role: 'admin', returnTo, force });
}

function apiBase() {
  return process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function _resetSignInServiceForTests() {
  inited = null;
  available = { customer: false, admin: false };
}
