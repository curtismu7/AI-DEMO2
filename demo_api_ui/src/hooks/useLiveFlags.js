import { useCallback, useEffect, useState } from 'react';
import apiClient from '../services/apiClient';

/**
 * Read-only live feature-flag values from GET /api/admin/feature-flags
 * (open — no session required). Writes go through demoFlagsClient's
 * guest-safe enableUseCaseFlags instead of PATCHing this endpoint directly;
 * that PATCH route requires a signed-in session
 * (middleware/featureFlagsAuthGate.js) and a guest write to it 401s.
 *
 * `setFlag` is kept temporarily for the existing FlagGate call site in
 * UseCaseLauncherPage.js; Task 4 removes it when FlagGate is replaced with
 * the guest-safe enable flow.
 */
export default function useLiveFlags() {
  const [flagMap, setFlagMap] = useState(null); // null = loading
  const [flagsLoading, setFlagsLoading] = useState(true);

  const load = useCallback(() => {
    setFlagsLoading(true);
    return apiClient
      .get('/api/admin/feature-flags', { _silent: true })
      .then(({ data }) => {
        const map = {};
        for (const f of data.flags || []) map[f.id] = f.value;
        setFlagMap(map);
        setFlagsLoading(false);
      })
      .catch(() => {
        setFlagMap({}); // empty = all flags default-off (safe: gates remain closed)
        setFlagsLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [load]);

  const setFlag = useCallback((id, value) => {
    // Optimistic update — apply immediately so toggle feels instant.
    setFlagMap((prev) => ({ ...(prev || {}), [id]: value }));
    apiClient
      .patch('/api/admin/feature-flags', { updates: { [id]: value } })
      .catch(() => {
        // Roll back on failure
        setFlagMap((prev) => ({ ...(prev || {}), [id]: !value }));
      });
  }, []);

  return { flagMap, flagsLoading, refreshFlags: load, setFlag };
}
