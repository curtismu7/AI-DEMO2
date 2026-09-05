import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './theme/refinedSurface.css';
import './theme/refinedDashboardV2.css';
import './theme/refinedTopNav.css';
import './theme/refinedAgent.css';
import './styles/controls.css';
import App from './App';
import { patchFetch } from './services/apiTrafficStore';
import ErrorBoundary from './components/ErrorBoundary';
// PostHog off for now — no project token configured. Re-enable by uncommenting
// this import and the initPosthog() call below (build wiring is already in place:
// demo_api_ui/Dockerfile + docker-compose.yml ui build args).
// import { initPosthog } from './posthogClient';

// Redirect localhost → canonical host (api.ping.demo) so CORS + cookies work correctly
if (
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost' &&
  process.env.REACT_APP_CLIENT_URL
) {
  const canonical = new URL(process.env.REACT_APP_CLIENT_URL);
  if (canonical.hostname !== 'localhost') {
    window.location.replace(
      canonical.origin + window.location.pathname + window.location.search + window.location.hash
    );
  }
}

// Patch window.fetch before React renders so every /api/* call is captured
patchFetch();
// initPosthog();  // disabled — see the posthogClient import note above

// PWA installability (mobile/iOS "Add to Home Screen"). The service worker
// only cache-firsts content-hashed build assets — see public/service-worker.js
// for why it never touches API/WS/auth traffic. Guarded so it's a no-op under
// vitest (jsdom has no navigator.serviceWorker) and on non-secure origins,
// where registration would throw.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

// Server restart notification is automatically initialized via monitorApiHealth() in App.js
// See: bankingRestartNotificationService.js for implementation details

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
