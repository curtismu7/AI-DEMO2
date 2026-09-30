import { useCallback, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import {
  PI_FLOW_SIGNIN_EVENT,
  setPiFlowSignInAvailable,
} from "../utils/authUi";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** Plain redirect login — the path every failure here falls back to. */
function redirectLogin(returnTo) {
  const suffix = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
  window.location.href = `${apiBase()}/api/auth/oauth/user/login${suffix}`;
}

/**
 * Redirect-free customer sign-in (PingOne pi.flow). The BFF opens the flow
 * (GET /login?pi_flow=1), this form posts the password to it, and on success the
 * browser goes straight to the BFF callback — no PingOne hosted page.
 *
 * Mounted once in App. It enables itself only when the BFF reports
 * PINGONE_USER_AUTHORIZE_PI_FLOW on AND the provider is PingOne; otherwise
 * navigateToCustomerOAuthLogin keeps doing the ordinary redirect.
 * Anything the password step cannot finish (MFA, a policy screen, an error
 * opening the flow) falls back to that redirect login.
 */
export default function PiFlowSignInModal() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const returnToRef = useRef(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: "include" });
        const cfg = (await res.json())?.config || {};
        const on = ["true", "1"].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase());
        if (!cancelled) setPiFlowSignInAvailable(on && (cfg.oauth_provider || "pingone") === "pingone");
      } catch {
        /* keep the redirect login */
      }
    })();
    return () => {
      cancelled = true;
      setPiFlowSignInAvailable(false);
    };
  }, []);

  const begin = useCallback(async (target) => {
    returnToRef.current = target;
    setError("");
    setUsername("");
    setPassword("");
    setBusy(true);
    setOpen(true);
    try {
      const qs = new URLSearchParams({ pi_flow: "1" });
      if (target) qs.set("return_to", target);
      const res = await fetch(`${apiBase()}/api/auth/oauth/user/login?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("pi.flow unavailable");
      setBusy(false);
    } catch {
      setOpen(false);
      redirectLogin(target);
    }
  }, []);

  useEffect(() => {
    const onSignIn = (e) => {
      e.detail.handled = true;
      begin(e.detail.returnTo);
    };
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
    return () => window.removeEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
  }, [begin]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/auth/oauth/user/pi-flow/credentials`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setPassword("");
        setError(body.message || "Username or password is incorrect.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        window.location.assign(body.redirectTo);
        return;
      }
      // fallback:true (needs MFA or another screen), 409 (flow expired), 5xx
      redirectLogin(returnToRef.current);
    } catch {
      redirectLogin(returnToRef.current);
    }
  };

  if (!open) return null;

  return (
    <DraggableModal
      isOpen
      onClose={() => setOpen(false)}
      title="Sign in"
      className="signin-modal pi-flow-signin"
      defaultWidth={420}
      defaultHeight={330}
      minHeight={260}
      footer={
        <div className="signin-modal__actions">
          <button
            type="submit"
            form="pi-flow-signin-form"
            className="signin-prompt__btn"
            disabled={busy || !username || !password}
          >
            {busy ? "Signing in" : "Sign in"}
          </button>
          <button
            type="button"
            className="signin-prompt__btn signin-prompt__btn--ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="dm-scroll">
        <form id="pi-flow-signin-form" className="pi-flow-signin__form" onSubmit={submit}>
          <label className="pi-flow-signin__label" htmlFor="pi-flow-username">
            Username
          </label>
          <input
            id="pi-flow-username"
            className="pi-flow-signin__input"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <label className="pi-flow-signin__label" htmlFor="pi-flow-password">
            Password
          </label>
          <input
            id="pi-flow-password"
            className="pi-flow-signin__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <p className="signin-modal__text" role="alert">
              ❌ {error}
            </p>
          ) : null}
          <p className="signin-modal__hint">
            No PingOne hosted page: this sign-in runs as a pi.flow.
          </p>
        </form>
      </div>
    </DraggableModal>
  );
}
