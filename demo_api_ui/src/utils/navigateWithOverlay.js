// demo_api_ui/src/utils/navigateWithOverlay.js
//
// Full-page redirects (sign-in, sign-out, door switch) leave the app for a
// moment with nothing of ours on screen, which reads as a flash of blank white.
// Draw a themed card over the live page first. The old document keeps painting,
// with the overlay on it, until the next one commits, so the page stays visible
// behind a dimmed, blurred veil instead of vanishing.
//
// The overlay is plain DOM, not React: redirects fire from hooks, utilities and
// error handlers that have no component to render into.
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import PingIdentitySpinner from '../components/shared/PingIdentitySpinner';
import './navigateWithOverlay.css';

const OVERLAY_ID = 'nav-overlay';
let overlayRoot = null;

export function hideNavOverlay() {
  if (typeof document === 'undefined') return;
  overlayRoot?.unmount();
  overlayRoot = null;
  document.getElementById(OVERLAY_ID)?.remove();
}

function showNavOverlay(message) {
  if (typeof document === 'undefined' || document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'nav-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');

  const card = document.createElement('div');
  card.className = 'nav-overlay__card';

  overlay.append(card);
  document.body.appendChild(overlay);

  // The standard Ping spinner, rendered synchronously so it paints before the
  // navigation below unloads the page.
  overlayRoot = createRoot(card);
  flushSync(() => overlayRoot.render(createElement(PingIdentitySpinner, { size: 40, label: message })));
}

// Back/forward restores this page from the bfcache with the overlay still in
// it; without this the user lands on a spinner that never goes away.
if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) hideNavOverlay();
  });
}

/**
 * Show the overlay, then navigate. Navigation is synchronous (callers and their
 * tests read location.href straight after); the overlay paints during the
 * network round trip before the next document commits.
 */
export function navigateWithOverlay(url, { message = 'Redirecting...', assign = false } = {}) {
  try {
    showNavOverlay(message);
  } catch {
    // The redirect matters more than the polish.
  }
  if (assign) window.location.assign(url);
  else window.location.href = url;
}
