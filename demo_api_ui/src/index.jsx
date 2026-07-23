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
import { initPosthog } from './posthogClient';

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
initPosthog();

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
