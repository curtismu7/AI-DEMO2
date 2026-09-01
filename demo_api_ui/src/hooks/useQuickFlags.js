// useQuickFlags — the read/write half of the Quick Flags pill, extracted so a
// second surface can host the same switches without a second copy of the
// lineup, the pinned handling, or the rollback.
//
// Only the DATA layer is shared. Each surface renders its own controls: the
// pill uses its segmented/qfp-toggle markup, the agent header's More menu uses
// the <Check variant="switch"> rows it already shows for local preferences.
// What must never drift is which flag a label refers to and what a write does.
//
// Read AND write paths of /api/admin/feature-flags are intentionally
// unauthenticated at the server (see server.js — demo posture, do not add a
// gate silently). The 403 / adminDenied handling is defensive for a future
// server-side gate. Env-pinned flags (pinned/pinnedBy from the API) must render
// locked: getEffective() is env-first, so their writes are silently inert.
import { useCallback, useEffect, useRef, useState } from 'react';

const FLAGS_URL = '/api/admin/feature-flags';

/**
 * @param {{ user?: unknown, enabled?: boolean }} [opts] `enabled` gates the
 *   initial fetch so a closed menu costs nothing; flip it true when it opens to
 *   re-read and stay honest across sessions and tabs.
 */
export default function useQuickFlags({ user, enabled = true } = {}) {
  const [flagsById, setFlagsById] = useState(null); // null = not loaded
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);
  const [adminDenied, setAdminDenied] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const canEdit = !!user && !adminDenied;

  const load = useCallback(async () => {
    try {
      const res = await fetch(FLAGS_URL, { credentials: 'include' });
      if (!aliveRef.current) return;
      if (!res.ok) { setLoadFailed(true); return; }
      const data = await res.json();
      if (!aliveRef.current) return;
      const byId = {};
      for (const f of data.flags || []) byId[f.id] = f;
      setFlagsById(byId);
      setLoadFailed(false);
    } catch (_) {
      if (!aliveRef.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  /** Optimistic write with rollback (FeatureFlagsPage pattern). */
  const save = useCallback(async (id, value) => {
    if (!flagsById) return;
    const prev = flagsById[id];
    if (!prev || prev.pinned) return;
    setSavingId(id);
    setError(null);
    setFlagsById((cur) => ({ ...cur, [id]: { ...cur[id], value } }));
    try {
      const res = await fetch(FLAGS_URL, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [id]: value } }),
      });
      if (!aliveRef.current) return;
      if (res.status === 403) {
        setAdminDenied(true);
        setFlagsById((cur) => ({ ...cur, [id]: prev }));
        return;
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const data = await res.json();
      if (!aliveRef.current) return;
      if (Array.isArray(data.flags) && data.flags.length) {
        setFlagsById((cur) => {
          const next = { ...cur };
          for (const f of data.flags) next[f.id] = f;
          return next;
        });
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setFlagsById((cur) => ({ ...cur, [id]: prev }));
      setError(e.message || 'save failed');
    } finally {
      if (aliveRef.current) setSavingId(null);
    }
  }, [flagsById]);

  return {
    flagsById, setFlagsById, loadFailed, savingId, setSavingId,
    error, setError, adminDenied, setAdminDenied, canEdit, load, save, aliveRef,
  };
}
