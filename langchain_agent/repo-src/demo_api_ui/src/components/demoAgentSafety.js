/**
 * Small pure helpers extracted from BankingAgent for testability.
 * Keep this dependency-free.
 */

/**
 * Atomically read-and-delete a sessionStorage key.
 * Returns the trimmed string value, or null if absent/blank/unavailable.
 * Guarantees a second caller (another mounted instance, a later retry) gets null,
 * so a post-OAuth NL command replays exactly once.
 */
export function claimPendingNl(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    sessionStorage.removeItem(key);
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Clamp a floating-panel top-left so at least a grab strip of the header
 * stays on screen. Used on drag-end and on window resize (NOT during an
 * active drag — second-monitor drag is intentional).
 *
 * @param {{x:number,y:number}} pos
 * @param {{width:number,height:number}} panel
 * @param {{width:number,height:number}} viewport
 * @param {number} margin minimum visible px of the panel on each axis
 * @returns {{x:number,y:number}}
 */
export function clampPanelPosition(pos, panel, viewport, margin = 48) {
  const maxX = Math.max(0, viewport.width - margin);
  const maxY = Math.max(0, viewport.height - margin);
  const minX = margin - panel.width;
  const minY = 0; // header is at the top; never let it go above the viewport
  return {
    x: Math.min(maxX, Math.max(minX, pos.x)),
    y: Math.min(maxY, Math.max(minY, pos.y)),
  };
}

/**
 * A synchronous (non-async-state) single-flight guard.
 * Back this with a useRef so the flag updates immediately and wins the
 * same-tick double-submit race that `disabled={nlLoading}` cannot.
 */
export function makeReentrancyGuard() {
  let held = false;
  return {
    tryAcquire() {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
  };
}

/**
 * Map a route to the agent's embeddedFocus persona. This is a verbatim port
 * of EmbeddedAgentDock's historical isConfigPage predicate so the bottom
 * dock's behavior is provably unchanged; middle/float now match it.
 */
export function resolveEmbeddedFocus(pathname) {
  const p = typeof pathname === "string" ? pathname.replace(/\/$/, "") : "";
  return p === "/config" ? "config" : "banking";
}

/**
 * True for fetch/AbortController cancellation. Such errors are intentional
 * (component unmounted / route changed / superseded send) and must be
 * swallowed silently — never surfaced as a user-facing failure.
 */
export function isAbortError(err) {
  return Boolean(err) && err.name === "AbortError";
}

/**
 * Minimal stand-in for AbortSignal.any() for our short-lived two-signal call
 * sites (jsdom lacks AbortSignal.any). Listeners are {once:true}; do not pass
 * long-lived signals expecting eager listener cleanup.
 */
export function anySignal(signals) {
  const c = new AbortController();
  const onAbort = () => { c.abort(); };
  for (const s of signals) {
    if (s.aborted) {
      c.abort();
      break;
    }
    s.addEventListener("abort", onAbort, { once: true });
  }
  return c.signal;
}
