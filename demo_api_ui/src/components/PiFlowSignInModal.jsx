import { useCallback, useContext, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import { ForgotPasswordLink } from "./ForgotPasswordFlow";
import {
  PI_FLOW_SIGNIN_EVENT,
  setPiFlowSignInAvailable,
  setAdminPiFlowSignInAvailable,
} from "../utils/authUi";
import { navigateWithOverlay } from "../utils/navigateWithOverlay";
import { authenticateWebAuthn } from "../utils/passkeyCeremony";
import { VerticalContext } from "../vertical/VerticalProvider";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** Test hook: any page opened with ?signin=mfa asks this sign-in for MFA. */
const mfaRequested = () => new URLSearchParams(window.location.search).get("signin") === "mfa";

const ADMIN_API = "/api/auth/oauth";
const USER_API = "/api/auth/oauth/user";

/** Plain redirect login — the path every failure here falls back to. An MFA request keeps its MFA (the step-up route). */
function redirectLogin(returnTo, role, force) {
  let base;
  if (role === "admin") base = `${ADMIN_API}/login`;
  else if (mfaRequested()) base = `${USER_API}/stepup`;
  else base = force ? `${USER_API}/login?force=true` : `${USER_API}/login`;
  const sep = base.includes("?") ? "&" : "?";
  const suffix = returnTo ? `${sep}return_to=${encodeURIComponent(returnTo)}` : "";
  navigateWithOverlay(`${apiBase()}${base}${suffix}`, {
    message: "Signing in...",
  });
}

/**
 * Redirect-free sign-in (PingOne / PingFederate pi.flow), customer and admin.
 * The BFF opens the flow (GET .../login?pi_flow=1), this form posts the password
 * to it, and on success the browser goes straight to the BFF callback — no
 * hosted login page.
 *
 * Mounted once in App. It enables itself only when the BFF reports
 * PINGONE_USER_AUTHORIZE_PI_FLOW (and, for the admin role,
 * PINGONE_ADMIN_AUTHORIZE_PI_FLOW) on and the provider is PingOne or
 * PingFederate; otherwise the redirect login stays as it was.
 * After the password, a passkey (ASSERTION_REQUIRED) or OTP step is driven here
 * too. Anything else (device selection, a policy screen, an error opening the
 * flow) falls back to that redirect login.
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
  const [otp, setOtp] = useState("");
  // "password" -> "passkey" | "otp" as the flow asks for them.
  const [step, setStep] = useState("password");
  const passkeyOptionsRef = useRef(null);
  const returnToRef = useRef(undefined);
  const roleRef = useRef("customer");
  const forceRef = useRef(false);
  const providerRef = useRef("pingone");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: "include" });
        const cfg = (await res.json())?.config || {};
        // Both providers the BFF can drive (PingOne, PingFederate); anything else keeps the redirect.
        const provider = cfg.oauth_provider || "pingone";
        providerRef.current = provider;
        const drivable = provider === "pingone" || provider === "pingfederate";
        const userOn = ["true", "1"].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase());
        const adminOn = ["true", "1"].includes(String(cfg.PINGONE_ADMIN_AUTHORIZE_PI_FLOW).toLowerCase());
        if (!cancelled) {
          setPiFlowSignInAvailable(userOn && drivable);
          setAdminPiFlowSignInAvailable(adminOn && drivable);
        }
      } catch {
        /* keep the redirect login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const begin = useCallback((detail) => {
    const target = detail.returnTo;
    const role = detail.role === "admin" ? "admin" : "customer";
    // PF's MFA steps are not driven in the modal yet: go straight to the hosted step-up login rather than
    // asking for the password here and then again there.
    if (mfaRequested() && providerRef.current === "pingfederate") {
      redirectLogin(target, role, detail.force);
      return;
    }
    returnToRef.current = target;
    roleRef.current = role;
    forceRef.current = Boolean(detail.force);
    setStep("password");
    passkeyOptionsRef.current = null;
    setError("");
    setUsername("");
    setPassword("");
    setOtp("");
    setBusy(true);
    setOpen(true);
    (async () => {
      try {
        const qs = new URLSearchParams({ pi_flow: "1" });
        if (target) qs.set("return_to", target);
        if (forceRef.current) qs.set("force", "true");
        if (mfaRequested()) qs.set("mfa", "1");
        const api = role === "admin" ? ADMIN_API : USER_API;
        const res = await fetch(`${apiBase()}${api}/login?${qs}`, { credentials: "include" });
        if (!res.ok) throw new Error("pi.flow unavailable");
        // PingFederate locks the flow to a username hint; prefill it like the hosted page does.
        const flow = await res.json().catch(() => ({}));
        if (flow && typeof flow.usernameHint === "string") setUsername(flow.usernameHint);
        setBusy(false);
      } catch {
        setOpen(false);
        redirectLogin(target, role, forceRef.current);
      }
    })();
  }, []);

  useEffect(() => {
    const onSignIn = (e) => {
      e.detail.handled = true;
      begin(e.detail);
    };
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
    return () => window.removeEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
  }, [begin]);

  const apiForRole = () => (roleRef.current === "admin" ? ADMIN_API : USER_API);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/credentials`, {
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
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      if (res.ok && body.step === "passkey") {
        passkeyOptionsRef.current = body.publicKeyCredentialRequestOptions;
        setPassword("");
        setStep("passkey");
        setBusy(false);
        return;
      }
      if (res.ok && body.step === "otp") {
        setPassword("");
        setStep("otp");
        setBusy(false);
        return;
      }
      // fallback:true (device selection, a policy screen), 409 (flow expired), 5xx
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    } catch {
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/otp`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setOtp("");
        setError(body.message || "That code is not valid. Check it and try again.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    } catch {
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
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
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/assertion`, {
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
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    } catch {
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    }
  };

  if (!open) return null;

  const admin = roleRef.current === "admin";
  const welcome = admin ? "Administrator sign in" : "Welcome back";

  return (
    <DraggableModal
      isOpen
      onClose={() => setOpen(false)}
      title="Sign in"
      className={`signin-modal pi-flow-signin${admin ? " pi-flow-signin--admin" : ""}`}
      defaultWidth={440}
      defaultHeight={470}
      minHeight={360}
      footer={
        <div className="signin-modal__actions">
          {step === "passkey" ? (
            <>
              <button
                type="button"
                className="signin-prompt__btn signin-prompt__btn--ghost"
                onClick={() => redirectLogin(returnToRef.current, roleRef.current, forceRef.current)}
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
            <>
              <button
                type="submit"
                form={step === "otp" ? "pi-flow-otp-form" : "pi-flow-signin-form"}
                className="signin-prompt__btn"
                disabled={busy || (step === "otp" ? !otp : !username || !password)}
              >
                {busy ? "Signing in" : "Sign in"}
              </button>
              {step !== "otp" && <ForgotPasswordLink />}
            </>
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
        <div className="pi-flow-signin__hero">
          {identity?.logoPath ? (
            <img
              className="pi-flow-signin__logo"
              src={identity.logoPath}
              alt={identity.logoAlt || ""}
            />
          ) : null}
          <div className="pi-flow-signin__hero-text">
            <p className="pi-flow-signin__welcome">{welcome}</p>
            {brandName ? <p className="pi-flow-signin__brand-name">{brandName}</p> : null}
          </div>
        </div>
        {step === "passkey" ? (
          <div className="pi-flow-signin__form">
            <p className="signin-modal__text">Verify it is you with your passkey.</p>
            {error ? (
              <p className="signin-modal__text" role="alert">
                ❌ {error}
              </p>
            ) : null}
          </div>
        ) : step === "otp" ? (
          <form id="pi-flow-otp-form" className="pi-flow-signin__form" onSubmit={submitOtp}>
            <p className="signin-modal__text">
              We sent a verification code to your registered {admin ? "admin" : ""} contact. Enter it to continue.
            </p>
            <label className="pi-flow-signin__label" htmlFor="pi-flow-otp">
              Verification code
            </label>
            <input
              id="pi-flow-otp"
              className="pi-flow-signin__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
            {error ? (
              <p className="signin-modal__text" role="alert">
                ❌ {error}
              </p>
            ) : null}
          </form>
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
        </form>
        )}
      </div>
    </DraggableModal>
  );
}
