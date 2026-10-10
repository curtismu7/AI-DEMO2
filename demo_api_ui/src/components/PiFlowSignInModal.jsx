import { useCallback, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import { ForgotPasswordLink } from "./ForgotPasswordFlow";
import {
  PI_FLOW_SIGNIN_EVENT,
  setPiFlowSignInAvailable,
  setAdminPiFlowSignInAvailable,
} from "../utils/authUi";
import { navigateWithOverlay } from "../utils/navigateWithOverlay";
import { authenticateWebAuthn } from "../utils/passkeyCeremony";
import SignInBrand from "./SignInBrand";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** Test hook: any page opened with ?signin=mfa asks this sign-in for MFA. */
const mfaRequested = () => new URLSearchParams(window.location.search).get("signin") === "mfa";

const ADMIN_API = "/api/auth/oauth";
const USER_API = "/api/auth/oauth/user";

const DEVICE_LABEL = { EMAIL: "Email", SMS: "SMS", FIDO2: "Passkey", TOTP: "Authenticator app" };

const deviceLabel = (d) => {
  const kind = DEVICE_LABEL[d.type] || d.type;
  if (d.type === "EMAIL") return `${kind} · ${d.email || ""}`;
  if (d.type === "SMS") return `${kind} · ${d.phone || ""}`;
  return d.nickname ? `${kind} · ${d.nickname}` : kind;
};

/**
 * DevicePicker — the flow's offered MFA devices as a radio-style list. Picking a
 * device submits it (POST /pi-flow/device): an OTP device re-renders the code
 * form for that device, a FIDO2 device starts the passkey ceremony immediately.
 * Only rendered when the flow offered more than one usable device.
 */
function DevicePicker({ devices, selectedDeviceId, disabled, onPick }) {
  return (
    <div className="pi-flow-device-picker" role="radiogroup" aria-label="Verification device">
      {devices.map((d) => (
        <button
          key={d.id}
          type="button"
          role="radio"
          aria-checked={d.id === selectedDeviceId}
          className={`pi-flow-device-picker__option${d.id === selectedDeviceId ? " pi-flow-device-picker__option--selected" : ""}`}
          disabled={disabled}
          onClick={() => onPick(d)}
        >
          {deviceLabel(d)}
        </button>
      ))}
    </div>
  );
}


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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  // The device-only form's username, kept separate so switching between the
  // password and device forms never clobbers what the user typed in either.
  const [deviceUsername, setDeviceUsername] = useState("");
  // Devices the flow offered (OTP_REQUIRED's _embedded.devices / PF's devices):
  // [{ id, type, nickname, email, phone }]. Rendered as a picker when the flow
  // offers more than one; a FIDO2 entry runs the passkey ceremony on pick.
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  // "password" -> "passkey" | "otp" | "device" as the flow (or the user) asks.
  const [step, setStep] = useState("password");
  const passkeyOptionsRef = useRef(null);
  // Lets pickDevice trigger the passkey ceremony after the passkey step renders.
  const verifyPasskeyRef = useRef(null);
  const returnToRef = useRef(undefined);
  const roleRef = useRef("customer");
  const forceRef = useRef(false);
  const providerRef = useRef("pingone");
  // Remember who is signing in as: 800 ms after the last keystroke in a
  // username field, store the value as the role's login hint so the next
  // sign-in prefills it. The sign-in callback also stores it; this covers a
  // value typed then abandoned. Prefill only — never an auth decision.
  const hintTimerRef = useRef(null);
  const apiForRoleRef = useRef(() => USER_API);
  const queueHintWrite = (value) => {
    clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return;
      fetch(`${apiBase()}${apiForRoleRef.current()}/login-hint`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: trimmed }),
      }).catch(() => { /* prefill loss is not the user's problem */ });
    }, 800);
  };

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
    apiForRoleRef.current = () => (role === "admin" ? ADMIN_API : USER_API);
    clearTimeout(hintTimerRef.current);
    // Passwordless first: the device-only step is the modal's default. The
    // flow opens under the mfa_only policy; if the policy does not exist yet
    // the open snaps back to the password form inside the modal.
    passkeyOptionsRef.current = null;
    setStep("device");
    setError("");
    setUsername("");
    setPassword("");
    setOtp("");
    setDeviceUsername("");
    setDevices([]);
    setSelectedDeviceId(null);
    setBusy(true);
    setOpen(true);
    openFlow(target, role, { passwordless: true });
  }, []);

  // Opens the pi.flow on the BFF. `passwordless` selects the identifier-first
  // sign-on policy via acr_values — the app's default policy is password-first,
  // so the device-only flow exists only when the authorize asks for this policy.
  const openFlow = (target, role, { passwordless = false } = {}) => {
    (async () => {
      try {
        const qs = new URLSearchParams({ pi_flow: "1" });
        if (target) qs.set("return_to", target);
        if (forceRef.current) qs.set("force", "true");
        if (mfaRequested()) qs.set("mfa", "1");
        if (passwordless) qs.set("passwordless", "1");
        const api = role === "admin" ? ADMIN_API : USER_API;
        const res = await fetch(`${apiBase()}${api}/login?${qs}`, { credentials: "include" });
        if (!res.ok) throw new Error("pi.flow unavailable");
        // PingFederate locks the flow to a username hint; prefill it like the hosted page does.
        const flow = await res.json().catch(() => ({}));
        if (flow && typeof flow.usernameHint === "string") {
          setUsername(flow.usernameHint);
          setDeviceUsername(flow.usernameHint); // the device step is the first screen
        }
        setBusy(false);
      } catch (openErr) {
        if (passwordless) {
          // The mfa_only policy may not exist yet (400 on open). Snap to the
          // password-first flow INSIDE the modal — the default step never
          // redirects to the hosted page.
          setError("Device sign-in is not available yet — use your password.");
          setStep("password");
          setDeviceUsername(username);
          openFlow(target, role, {});
          return;
        }
        setOpen(false);
        redirectLogin(target, role, forceRef.current);
      }
    })();
  };

  // Switching to the device step replaces the session's flow with one opened
  // under the identifier-first policy; the old flow is abandoned (it expires).
  const switchToDevice = () => {
    if (busy) return;
    setDeviceUsername(username);
    setError("");
    setStep("device");
    setBusy(true);
    openFlow(returnToRef.current, roleRef.current, { passwordless: true });
  };

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
        setDevices(Array.isArray(body.devices) ? body.devices : []);
        setSelectedDeviceId(body.selectedDeviceId || null);
        setStep("otp");
        setBusy(false);
        return;
      }
      if (res.ok && body.step === "device") {
        setDevices(Array.isArray(body.devices) ? body.devices : []);
        setSelectedDeviceId(body.selectedDeviceId || null);
        setStep("device");
        setBusy(false);
        return;
      }
      // A policy screen the BFF can't drive hands off to the hosted page, which
      // offers every method. A 5xx (transient: PingOne unreachable, a step that
      // errored) is NOT a policy — it happened after we already committed to
      // pi.flow, and dumping the user onto the hosted login mid-sign-in both
      // loses their place and, on a different host than the BFF's registered
      // callback origin, loses the session cookie entirely (Invalid state on
      // return). Stay here with a retryable error instead.
      if (res.status >= 500) {
        setError("Sign-in couldn't be completed just now. Please try again.");
        setBusy(false);
        return;
      }
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

  // The user picked a device from the picker. An OTP device moves to the code
  // form; a FIDO2 device moves to the passkey ceremony — both via the same
  // /pi-flow/device step, whose response routes like any other step.
  const pickDevice = async (device) => {
    if (busy || !device?.id) return;
    setBusy(true);
    setError("");
    setSelectedDeviceId(device.id);
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/device`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: device.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.redirectTo) {
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      if (res.ok && body.step === "passkey") {
        passkeyOptionsRef.current = body.publicKeyCredentialRequestOptions;
        setStep("passkey");
        setBusy(false);
        // Start the ceremony immediately — the user picked a passkey to use it.
        // verifyPasskey reads busy=false then re-sets it; invoke after a tick.
        setTimeout(() => { verifyPasskeyRef.current?.(); }, 0);
        return;
      }
      if (res.ok && body.step === "otp") {
        setDevices(Array.isArray(body.devices) ? body.devices : devices);
        setStep("otp");
        setBusy(false);
        return;
      }
      if (res.ok && body.step === "device") {
        setDevices(Array.isArray(body.devices) ? body.devices : devices);
        setBusy(false);
        return;
      }
      // fallback / 409 / 5xx — the hosted page offers every method
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    } catch {
      redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
    }
  };

  // Passwordless: identify with the username alone; the BFF posts username.check
  // to the open flow and the device step (otp/passkey) takes over. A policy that
  // requires the password 409s and we return to the password form — never a dead end.
  const submitPasswordless = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/passwordless`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: deviceUsername }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.error === "passwordless_unavailable") {
        setError(body.message || "This account requires a password. Sign in with your password.");
        setUsername(deviceUsername);
        setStep("password");
        setBusy(false);
        return;
      }
      if (res.status === 401) {
        setError(body.message || "Could not verify that account.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        navigateWithOverlay(body.redirectTo, { message: "Signing in...", assign: true });
        return;
      }
      if (res.ok && body.step === "passkey") {
        passkeyOptionsRef.current = body.publicKeyCredentialRequestOptions;
        setStep("passkey");
        setBusy(false);
        return;
      }
      if (res.ok && body.step === "otp") {
        setDevices(Array.isArray(body.devices) ? body.devices : []);
        setSelectedDeviceId(body.selectedDeviceId || null);
        setStep("otp");
        setBusy(false);
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

  verifyPasskeyRef.current = verifyPasskey;
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
                form={step === "otp" ? "pi-flow-otp-form" : step === "device" && !devices.length ? "pi-flow-device-form" : "pi-flow-signin-form"}
                className="signin-prompt__btn"
                disabled={busy || (step === "otp" ? !otp : step === "device" && !devices.length ? !deviceUsername : step === "device" ? false : !username || !password)}
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
        <SignInBrand welcome={welcome} />
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
            {devices.length > 1 ? (
              <DevicePicker
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                disabled={busy}
                onPick={pickDevice}
              />
            ) : null}
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
        ) : step === "device" ? (
          <div className="pi-flow-signin__form">
            <p className="signin-modal__text">
              We&apos;ll verify it&apos;s you with your registered device — no password needed.
            </p>
            {devices.length > 0 ? (
              <DevicePicker
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                disabled={busy}
                onPick={pickDevice}
              />
            ) : (
              <form id="pi-flow-device-form" onSubmit={submitPasswordless}>
                <label className="pi-flow-signin__label" htmlFor="pi-flow-device-username">
                  Username
                </label>
                <input
                  id="pi-flow-device-username"
                  className="pi-flow-signin__input"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={deviceUsername}
                  onChange={(e) => { setDeviceUsername(e.target.value); queueHintWrite(e.target.value); }}
                />
                {error ? (
                  <p className="signin-modal__text" role="alert">
                    ❌ {error}
                  </p>
                ) : null}
              </form>
            )}
            <button
              type="button"
              className="signin-prompt__btn signin-prompt__btn--ghost"
              onClick={() => {
                if (busy) return;
                // Back to the password form — and to the password-first flow the
                // session originally opened (the identifier-first flow is abandoned).
                setUsername(deviceUsername);
                setError("");
                setBusy(true);
                openFlow(returnToRef.current, roleRef.current);
                setStep("password");
              }}
            >
              Use your password instead
            </button>
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
            onChange={(e) => { setUsername(e.target.value); queueHintWrite(e.target.value); }}
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
          <button
            type="button"
            className="signin-prompt__btn signin-prompt__btn--ghost"
            onClick={switchToDevice}
          >
            Use a device instead
          </button>
        </form>
        )}
      </div>
    </DraggableModal>
  );
}
