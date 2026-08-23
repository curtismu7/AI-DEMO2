/**
 * ActivityNarrativeContext — holds the per-request plain-English narration
 * shown in the "What's happening" panel. Ephemeral (no persistence).
 */
import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { identityStep, delegationStep } from '../components/activity/activityNarration';

const ActivityNarrativeContext = createContext(null);

// Without a cap, `requests` grows by one entry per turn for the life of the
// session (only `reset()` on a user/vertical/theme change ever clears it),
// and startRequest's collapse-the-rest map cost grows linearly with it.
// Matches the cap pattern already used by useActivityLog.js's MAX_EVENTS.
const MAX_REQUESTS = 50;

export function ActivityNarrativeProvider({ children }) {
  const [requests, setRequests] = useState([]);
  const idRef = useRef(0);

  const startRequest = useCallback((prompt) => {
    idRef.current += 1;
    const next = {
      id: idRef.current,
      prompt: prompt || '',
      steps: [identityStep(), delegationStep()],
      status: 'running',
      collapsed: false,
    };
    setRequests((prev) => {
      const collapsed = prev.map((r) => ({ ...r, collapsed: true }));
      const capped = collapsed.length >= MAX_REQUESTS
        ? collapsed.slice(collapsed.length - MAX_REQUESTS + 1)
        : collapsed;
      return [...capped, next];
    });
  }, []);

  const upsertStep = useCallback((step) => {
    if (!step || !step.key) return;
    setRequests((prev) => {
      if (prev.length === 0) return prev;
      const reqs = prev.slice();
      const cur = { ...reqs[reqs.length - 1] };
      const steps = cur.steps.slice();
      const idx = steps.findIndex((s) => s.key === step.key);
      if (idx === -1) steps.push(step);
      else steps[idx] = step;
      cur.steps = steps;
      reqs[reqs.length - 1] = cur;
      return reqs;
    });
  }, []);

  const finishRequest = useCallback((status) => {
    setRequests((prev) => {
      if (prev.length === 0) return prev;
      const reqs = prev.slice();
      const cur = { ...reqs[reqs.length - 1] };
      cur.status = status || 'done';
      cur.steps = cur.steps.map((s) => (s.status === 'running' ? { ...s, status: 'done' } : s));
      reqs[reqs.length - 1] = cur;
      return reqs;
    });
  }, []);

  const reset = useCallback(() => setRequests([]), []);

  const value = { requests, startRequest, upsertStep, finishRequest, reset };
  return <ActivityNarrativeContext.Provider value={value}>{children}</ActivityNarrativeContext.Provider>;
}

export function useActivityNarrative() {
  const ctx = useContext(ActivityNarrativeContext);
  if (!ctx) throw new Error('useActivityNarrative must be used within ActivityNarrativeProvider');
  return ctx;
}

export function useActivityNarrativeOptional() {
  return useContext(ActivityNarrativeContext);
}
