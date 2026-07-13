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
 * Minimal stand-in for AbortSignal.any() (jsdom lacks AbortSignal.any).
 * The first abort — or any source signal already aborted on entry — removes the
 * listeners from every source signal, so no listeners are leaked even when an
 * early signal in the list outlives the call.
 */
export function anySignal(signals) {
  const c = new AbortController();
  // Function declarations (hoisted) so onAbort/cleanup can reference each other.
  function cleanup() {
    for (const s of signals) s.removeEventListener("abort", onAbort);
  }
  function onAbort() {
    cleanup();
    c.abort();
  }
  for (const s of signals) {
    if (s.aborted) {
      cleanup();
      c.abort();
      break;
    }
    s.addEventListener("abort", onAbort);
  }
  return c.signal;
}

/**
 * True when a caught error should offer the in-place "pre-warm & retry"
 * action. Only meaningful for the local llama.cpp backend — Helix/Anthropic
 * timeouts have no local tier to pre-warm.
 */
export function isLocalModelTimeout(err, provider) {
  const isTimeout =
    err?.name === "TimeoutError" ||
    (typeof err?.message === "string" && err.message.includes("timed out"));
  return isTimeout && provider === "llamacpp";
}

/**
 * Force-load the given llama.cpp tier (swap mode — see demo_llm_proxy),
 * then re-run the request that timed out. Throws without calling `retry`
 * if the pre-warm call itself fails; the caller surfaces that to the user.
 */
export async function prewarmTierAndRetry(model, retry) {
  const res = await fetch("/api/langchain/llamacpp/prewarm", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error("Pre-warm failed");
  await retry();
}
