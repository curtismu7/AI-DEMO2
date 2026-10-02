import { useCallback, useContext, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import {
  PI_FLOW_SIGNIN_EVENT,
  setPiFlowSignInAvailable,
} from "../utils/authUi";
import { authenticateWebAuthn } from "../utils/passkeyCeremony";
import { VerticalContext } from "../vertical/VerticalProvider";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** Test hook: any page opened with ?signin=mfa asks this sign-in for MFA. */
const mfaRequested = () => new URLSearchParams(window.location.search).get("signin") === "mfa";

/** Plain redirect login — the path every failure here falls back to. An MFA request keeps its MFA (the step-up route). */
function redirectLogin(returnTo) {
  const suffix = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
  window.location.href = `${apiBase()}/api/auth/oauth/user/${mfaRequested() ? "stepup" : "login"}${suffix}`;
}

/**
 * Redirect-free customer sign-in (PingOne pi.flow). The BFF opens the flow
 * (GET /login?pi_flow=1), this form posts the password to it, and on success the
 * browser goes straight to the BFF callback — no PingOne hosted page.
 *
 * Mounted once in App. It enables itself only when the BFF reports
 * PINGONE_USER_AUTHORIZE_PI_FLOW on AND the provider is PingOne or PingFederate; otherwise
 * navigateToCustomerOAuthLogin keeps doing the ordinary redirect.
 * After the password, a passkey (ASSERTION_REQUIRED) step is driven here too.
 * Anything else (SMS/email codes, a policy screen, an error opening the flow)
 * falls back to that redirect login.
 */
export default function PiFlowSignInModal() {
  // The context directly, not useVertical(): this mounts above the pages that
  // need a Router, and signed-out visitors still get identity + theme from
  // /api/verticals/me, which is all the header needs.
  const identity = useContext(VerticalContext)?.pageManifest?.identity;
  const brandName = identity?.headerTitle || identity?.displayName || "";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // "password" -> "passkey" when the flow asks for a passkey assertion.
  const [step, setStep] = useState("password");
  const passkeyOptionsRef = useRef(null);
  const returnToRef = useRef(undefined);
  const providerRef = useRef("pingone");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: "include" });
        const cfg = (await res.json())?.config || {};
        const on = ["true", "1"].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase());
        // Both providers the BFF can drive (PingOne, PingFederate); anything else keeps the redirect.
        const provider = cfg.oauth_provider || "pingone";
        providerRef.current = provider;
        if (!cancelled) setPiFlowSignInAvailable(on && (provider === "pingone" || provider === "pingfederate"));
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
    // PF's MFA steps are not driven in the modal yet: go straight to the hosted step-up login rather than
    // asking for the password here and then again there.
    if (mfaRequested() && providerRef.current === "pingfederate") {
      redirectLogin(target);
      return;
    }
    setStep("password");
    passkeyOptionsRef.current = null;
    setError("");
    setUsername("");
    setPassword("");
    setBusy(true);
    setOpen(true);
    try {
      const qs = new URLSearchParams({ pi_flow: "1" });
      if (target) qs.set("return_to", target);
      if (mfaRequested()) qs.set("mfa", "1");
      const res = await fetch(`${apiBase()}/api/auth/oauth/user/login?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("pi.flow unavailable");
      // PingFederate locks the flow to a username hint; prefill it like the hosted page does.
      const flow = await res.json().catch(() => ({}));
      if (flow && typeof flow.usernameHint === "string") setUsername(flow.usernameHint);
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
      if (res.ok && body.step === "passkey") {
        passkeyOptionsRef.current = body.publicKeyCredentialRequestOptions;
        setPassword("");
        setStep("passkey");
        setBusy(false);
        return;
      }
      // fallback:true (another MFA method or screen), 409 (flow expired), 5xx
      redirectLogin(returnToRef.current);
    } catch {
      redirectLogin(returnToRef.current);
    }
  };

  const verifyPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    let assertionValue;
    try {
      ({ assertionValue } = await authenticateWebAuthn(passkeyOptionsRef.current));
    } catch (err) {
      // Dismissed prompt or no passkey on this device: stay here so the user can
      // retry, or leave for the hosted login (which offers every other method).
      setError(
        err?.name === "NotAllowedError"
          ? "No passkey was used. Try again, or use another sign-in method."
          : "The passkey could not be used on this device."
      );
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/api/auth/oauth/user/pi-flow/assertion`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assertion: assertionValue, origin: window.location.origin }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError(body.message || "The passkey could not be verified.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        window.location.assign(body.redirectTo);
        return;
      }
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
      defaultHeight={410}
      minHeight={320}
      footer={
        <div className="signin-modal__actions">
          {step === "passkey" ? (
            <>
              <button
                type="button"
                className="signin-prompt__btn signin-prompt__btn--ghost"
                onClick={() => redirectLogin(returnToRef.current)}
              >
                Use another method
              </button>
              <button
                type="button"
                className="signin-prompt__btn"
                disabled={busy}
                onClick={verifyPasskey}
              >
                {busy ? "Waiting for passkey" : "Verify with passkey"}
              </button>
            </>
          ) : (
            <button
              type="submit"
              form="pi-flow-signin-form"
              className="signin-prompt__btn"
              disabled={busy || !username || !password}
            >
              {busy ? "Signing in" : "Sign in"}
            </button>
          )}
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
        {identity?.logoPath || brandName ? (
          <div className="pi-flow-signin__brand">
            {identity?.logoPath ? (
              <img
                className="pi-flow-signin__logo"
                src={identity.logoPath}
                alt={identity.logoAlt || ""}
              />
            ) : null}
            {brandName ? <span className="pi-flow-signin__brand-name">{brandName}</span> : null}
          </div>
        ) : null}
        {step === "passkey" ? (
          <div className="pi-flow-signin__form">
            <p className="signin-modal__text">Verify it is you with your passkey.</p>
            {error ? (
              <p className="signin-modal__text" role="alert">
                ❌ {error}
              </p>
            ) : null}
          </div>
        ) : (
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
            No hosted login page: this sign-in runs as a pi.flow.
          </p>
        </form>
        )}
      </div>
    </DraggableModal>
  );
}
