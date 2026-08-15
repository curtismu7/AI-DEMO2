/**
 * performLogout — unified logout helper for all UI callsites.
 *
 * Uses fetch() so the BFF's Set-Cookie: connect.sid=; Max-Age=0 headers are
 * delivered on this response directly. If we navigate via window.location.href
 * the 302→PingOne redirect causes the CRA proxy to lose those headers and the
 * session cookie is not cleared in the browser.
 *
 * The BFF returns { logoutUrl } (JSON) when Accept does not include text/html.
 * We then navigate to the PingOne signoff URL directly.
 */
import { nrLog } from '../utils/nrLog';

export function performLogout() {
  nrLog('ui.logout', { page: window.location.pathname });
  fetch('/api/auth/logout', { credentials: 'include' })
    .then((r) => r.json())
    .then(({ logoutUrl }) => {
      window.location.href = logoutUrl || '/';
    })
    .catch(() => {
      window.location.href = '/';
    });
}
