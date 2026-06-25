/**
 * useNewItems.js
 *
 * Fires onNew(newEntries) whenever items array grows, passing only the
 * newly-appended entries. Used by AG-UI sync effects to push incremental
 * STATE_DELTA slices into observer stores without re-processing old entries.
 *
 * @param {Array}    items    - the growing array to watch (e.g. aguiState.mcpTraffic)
 * @param {boolean}  enabled  - when false, does nothing (feature flag gate)
 * @param {Function} onNew    - called with the new slice on each growth
 */
import { useEffect, useRef } from 'react';

export function useNewItems(items, enabled, onNew) {
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (!enabled || !Array.isArray(items)) return;
    const newCount = items.length - prevLenRef.current;
    if (newCount <= 0) return;
    prevLenRef.current = items.length;
    onNew(items.slice(-newCount));
  // onNew is intentionally excluded from deps: callers should pass a stable reference
  // (e.g. useCallback or module-level function). Including it would cause spurious fires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, items]);
}
