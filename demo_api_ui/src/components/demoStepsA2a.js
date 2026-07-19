// demo_api_ui/src/components/demoStepsA2a.js
'use strict';
import { isA2aUseCase } from '../utils/a2aFacts';

/**
 * A2A token events for the explain-icon path: the last run's a2a-* events from
 * the token-chain trace store, but only for A2A use cases. Empty array
 * otherwise (icon opened before any run, or non-A2A step) — the modal renders
 * static prose + an empty live-panel in that case.
 *
 * Tolerates both the flat `{ tokenEvents }` shape and the real store's
 * `{ trace: { tokenEvents } }` shape (tokenChainTraceStore.getState() nests
 * tokenEvents under `trace`).
 */
export function a2aEventsForExplain(uc, store) {
  if (!isA2aUseCase(uc)) return [];
  const state = store?.getState?.() || {};
  const events = Array.isArray(state.tokenEvents)
    ? state.tokenEvents
    : state.trace?.tokenEvents;
  if (!Array.isArray(events)) return [];
  return events.filter((e) => e && typeof e.id === 'string' && e.id.startsWith('a2a-'));
}
