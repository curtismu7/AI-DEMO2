// demo_api_ui/src/hooks/useActivityLog.js
/**
 * Manages live app-event state for the Activity Log tab.
 *
 * - Wraps useAppEventsSSE (handles EventSource lifecycle).
 * - Maintains a 200-event ring buffer (newest first).
 * - Per-category filter: 15 known categories, all active by default.
 * - Pause: stops prepending to visible list but keeps SSE open.
 * - Clear: empties visible list; new events continue.
 * - newCount: events received while isPaused (shown in Resume button label).
 *
 * @param {{ enabled: boolean }} opts
 *   enabled — connect SSE when the modal is open (true keeps stream alive across tab switches).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppEventsSSE } from './useAppEventsSSE';

function resolveUseCaseId(event) {
  return event.useCaseId ?? event.metadata?.useCaseId ?? null;
}

export const ALL_CATEGORIES = [
  'oauth',
  'token_exchange',
  'mcp',
  'delegation',
  'hitl',
  'authorize',
  'gateway_path',
  'threshold',
  'introspection',
  'helix',
  'agent',
  'agent_prompt',
  'session',
  'jwks',
  'auth_lifecycle',
];

const MAX_EVENTS = 200;

export function useActivityLog({ enabled = false } = {}) {
  const [events, setEvents] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [activeFilters, setActiveFiltersState] = useState(
    () => new Set(ALL_CATEGORIES),
  );

  // Keep a ref to avoid stale closures inside the SSE callback.
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const handleEvent = useCallback((event) => {
    if (isPausedRef.current) {
      // Only count while paused — used by Resume button label.
      setNewCount((n) => n + 1);
      return;
    }
    setEvents((prev) => {
      const next = [event, ...prev];
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
    });
  }, []);

  useAppEventsSSE(handleEvent, { enabled });

  const pause = useCallback(() => setIsPaused(true), []);

  const resume = useCallback(() => {
    setIsPaused(false);
    setNewCount(0);
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    setNewCount(0);
  }, []);

  const resetNewCount = useCallback(() => setNewCount(0), []);

  const toggleFilter = useCallback((category) => {
    setActiveFiltersState((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const setAllFilters = useCallback((enabledArg) => {
    setActiveFiltersState(enabledArg ? new Set(ALL_CATEGORIES) : new Set());
  }, []);

  // use-case filter — independent of category filter.
  // null means "no use-case filter active" (show all).
  // When a Set, only events whose resolved useCaseId is in the Set are shown.
  const [activeUseCaseFilters, setActiveUseCaseFiltersState] = useState(null);

  const toggleUseCaseFilter = useCallback((ucId) => {
    setActiveUseCaseFiltersState((prev) => {
      const base = prev ?? new Set();
      const next = new Set(base);
      if (next.has(ucId)) {
        next.delete(ucId);
        return next.size === 0 ? null : next;
      } else {
        next.add(ucId);
        return next;
      }
    });
  }, []);

  const clearUseCaseFilter = useCallback(() => setActiveUseCaseFiltersState(null), []);

  // Apply category filter for display.
  const categoryFiltered = events.filter((e) => activeFilters.has(e.category));

  // BUG FIX: derive from ALL events (not categoryFiltered) so toggling a
  // category off doesn't remove its use-case IDs from the picker.
  const availableUseCaseIds = useMemo(
    () => [...new Set(events.map(resolveUseCaseId).filter(Boolean))].sort(),
    [events],
  );

  const filteredEvents = activeUseCaseFilters
    ? categoryFiltered.filter((e) => {
        const ucId = resolveUseCaseId(e);
        // When a UC filter is active, untagged events (no useCaseId) are
        // intentionally excluded — they don't belong to any specific use case.
        // When NO filter is active (activeUseCaseFilters === null, see below)
        // all events including untagged ones are shown.
        return ucId != null && activeUseCaseFilters.has(ucId);
      })
    : categoryFiltered;

  return {
    events: filteredEvents,
    isPaused,
    newCount,
    activeFilters,
    toggleFilter,
    setAllFilters,
    pause,
    resume,
    clear,
    resetNewCount,
    // use-case filter
    availableUseCaseIds,
    activeUseCaseFilters,
    toggleUseCaseFilter,
    clearUseCaseFilter,
  };
}
