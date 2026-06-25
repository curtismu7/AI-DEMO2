// banking_api_ui/src/hooks/useDemoMode.js
import { useState, useEffect } from 'react';
import axios from 'axios';

/** Module cache so multiple callers share one GET /api/admin/config for demoMode. */
let cachedDemoMode;
let inflight;

function getDemoModePromise() {
  if (cachedDemoMode !== undefined) return Promise.resolve(cachedDemoMode);
  if (!inflight) {
    inflight = axios
      .get('/api/admin/config')
      .then(({ data }) => {
        cachedDemoMode = !!data.demoMode;
        return cachedDemoMode;
      })
      .catch(() => {
        cachedDemoMode = false;
        return false;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Returns whether the server has DEMO_MODE set (shared/public demo deployments).
 * `undefined` until the first request completes.
 */
export function useDemoMode() {
  const [demoMode, setDemoMode] = useState(cachedDemoMode);

  useEffect(() => {
    getDemoModePromise().then((v) => setDemoMode(v));
  }, []);

  return demoMode;
}
