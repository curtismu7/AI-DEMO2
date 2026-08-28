/**
 * The "What the server said" disclosure gets its text from the SESSION_REAUTH
 * event's `detail`. These cover the two ways that used to come back empty while
 * the server had in fact said something.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// notifySessionExpiredIfNeeded rate-limits itself through module-level state, so
// a fresh module per case is the only way each one actually dispatches. Faking
// the clock is not enough — the timestamp lives in the module, not the timer.
beforeEach(() => vi.resetModules());

/**
 * Fire one session-expiry notification and return the event detail, or null if
 * nothing dispatched. Returning null rather than undefined keeps "no event" and
 * "event with no detail" distinguishable — otherwise a suppressed event looks
 * exactly like a correctly-empty one and the test passes for the wrong reason.
 */
async function fire(body) {
  const { notifySessionExpiredIfNeeded, SESSION_REAUTH_EVENT } = await import("./authUi");
  let seen = null;
  const onEvent = (e) => { seen = { detail: e.detail }; };
  window.addEventListener(SESSION_REAUTH_EVENT, onEvent);
  try {
    notifySessionExpiredIfNeeded({ status: 401, body, pathname: "/dashboard" });
  } finally {
    window.removeEventListener(SESSION_REAUTH_EVENT, onEvent);
  }
  return seen;
}

describe("session-expiry detail", () => {
  it("falls back to `error` when that is all the server sent", async () => {
    // pathInfo.js, mcpDecisionPolling.js and resourceServer.js all return
    // exactly this shape — the case from the reported screenshot.
    const evt = await fire({ error: "authentication_required" });
    expect(evt?.detail?.detail).toBe("authentication_required");
  });

  it("does not let an empty error_description suppress a real message", async () => {
    const evt = await fire({
      error: "authentication_required",
      error_description: "   ",
      message: "Sign in to use the banking agent.",
    });
    expect(evt?.detail?.detail).toBe("Sign in to use the banking agent.");
  });

  it("still prefers error_description when it has content", async () => {
    const evt = await fire({
      error_description: "PingOne token validation failed: jwt expired",
      message: "Unauthorized",
      error: "invalid_token",
    });
    expect(evt?.detail?.detail).toBe("PingOne token validation failed: jwt expired");
  });

  it("leaves detail undefined on a bare 401 with no JSON body", async () => {
    // The genuine "nothing to disclose" case: SignInModal then omits the
    // disclosure entirely rather than rendering an empty one.
    const evt = await fire(undefined);
    // The event must still fire — asserting only on detail would pass just as
    // happily if nothing dispatched at all.
    expect(evt).not.toBeNull();
    expect(evt.detail.detail).toBeUndefined();
  });
});
