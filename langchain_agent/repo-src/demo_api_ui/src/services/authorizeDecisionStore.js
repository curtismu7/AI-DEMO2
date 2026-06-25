// banking_api_ui/src/services/authorizeDecisionStore.js
/**
 * Lightweight in-memory store for PingOne Authorize decisions received via AG-UI.
 *
 * Pattern mirrors mcpCallStore.js — synchronous, subscriber-notified.
 * Populated by the AG-UI Step 6 sync effect in BankingAgent.js when
 * ff_agui_enabled=true. The PingOneAuthorizePanel subscribes to get
 * live updates without polling /api/authorize/recent-decisions.
 *
 * Usage:
 *   appendAuthorizeDecision(decision)  → from BankingAgent AG-UI sync effect
 *   getDecisions()                     → current snapshot (newest first)
 *   subscribe(fn)                      → live updates; returns unsub()
 *   clearDecisions()                   → reset (on logout / new run)
 */

const MAX_DECISIONS = 100;
let decisions = [];
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => { try { fn(decisions); } catch (_) {} });
}

/**
 * Append one Authorize decision received from an AG-UI STATE_DELTA.
 *
 * @param {{ id, timestamp, decision, policyId?, input?, obligations? }} entry
 */
export function appendAuthorizeDecision(entry) {
  decisions = [entry, ...decisions.slice(0, MAX_DECISIONS - 1)];
  notify();
}

/** Return current snapshot (most-recent first). */
export function getDecisions() { return decisions; }

/**
 * Subscribe to updates.
 * @param {(decisions: object[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearDecisions() {
  decisions = [];
  notify();
}
