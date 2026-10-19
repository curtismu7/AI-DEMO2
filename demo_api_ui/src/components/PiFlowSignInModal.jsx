import { useCallback, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import { ForgotPasswordLink } from "./ForgotPasswordFlow";
import {
  PI_FLOW_SIGNIN_EVENT,
} from "../utils/authUi";
import { navigateWithOverlay } from "../utils/navigateWithOverlay";
import { authenticateWebAuthn } from "../utils/passkeyCeremony";
import SignInBrand from "./SignInBrand";
import CibaApprovalPanel from "./CibaApprovalPanel";
import { isAicLoginEnabled, isCibaLoginEnabled } from "../utils/aicLogin";

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
  // Plus-addressing policy from the BFF (public endpoint): when the demo
  // refuses cmuir+x@pingone.com-style aliases, the form says so inline
  // before any flow opens. Fetch failure = unknown policy = no local
  // check — the server-side gate stays the wall either way.
  const plusPolicyRef = useRef({ rejectPlusAddressing: false, allowedIdentifiers: [] });
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  // "password" -> "passkey" | "otp" | "device" as the flow (or the user) asks.
  const [step, setStep] = useState("password");
  const passkeyOptionsRef = useRef(null);
  // This modal's own config gate: a dispatched sign-in event is handled only
  // when the BFF reports the role's pi.flow drivable; otherwise the event's
  // sender falls back to the redirect login.
  const [userDrivable, setUserDrivable] = useState(false);
  const [adminDrivable, setAdminDrivable] = useState(false);
  // Lets pickDevice trigger the passkey ceremony after the passkey step renders.
  const verifyPasskeyRef = useRef(null);
  const returnToRef = useRef(undefined);
  const roleRef = useRef("customer");
  const forceRef = useRef(false);
  const providerRef = useRef("pingone");
  const cibaEnabledRef = useRef(false); // ciba_login_enabled; off = no choice screen (pre-CIBA behaviour)
  // 'ciba' only after the "password + approval link" button; submit() sends it as secondFactor.
  // Every other path (plain password, passwordless, flag off) leaves it null and sends nothing.
  const secondFactorRef = useRef(null);
  const [approvalChannels, setApprovalChannels] = useState([]); // channels the server said this user has
  // The remembered username (login hint) is stored by the server after a SUCCESSFUL sign-in only.
  // The modal used to save it as you typed; PingFederate binds the flow to the hint, so a typo
  // ('demadmin') saved before any sign-in locked the next PF login to it.

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/admin/config`, { credentials: "include" });
        const cfg = (await res.json())?.config || {};
        // Both providers the BFF can drive (PingOne, PingFederate); anything else keeps the redirect.
        const provider = cfg.oauth_provider || "pingone";
        const drivable = provider === "pingone" || provider === "pingfederate";
        const userOn = ["true", "1"].includes(String(cfg.PINGONE_USER_AUTHORIZE_PI_FLOW).toLowerCase());
        const adminOn = ["true", "1"].includes(String(cfg.PINGONE_ADMIN_AUTHORIZE_PI_FLOW).toLowerCase());
        if (!cancelled) {
          providerRef.current = provider;
          cibaEnabledRef.current = isCibaLoginEnabled(cfg);
          // AIC login is a redirect to an external IdP — keep the redirect login.
          setUserDrivable(drivable && userOn && !isAicLoginEnabled(cfg));
          setAdminDrivable(drivable && adminOn);
        }
      } catch {
        /* keep the redirect login */
      }
    })();
    // Plus-addressing policy: fetched once per mount, best-effort. The
    // server-side gate enforces it regardless; this only powers the inline
    // form error so a + alias fails before any flow opens.
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/auth/hosted-access/identifier-policy`, { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (body && !cancelled) {
          plusPolicyRef.current = {
            rejectPlusAddressing: Boolean(body.rejectPlusAddressing),
            allowedIdentifiers: Array.isArray(body.allowedIdentifiers) ? body.allowedIdentifiers : [],
          };
        }
      } catch {
        /* unknown policy → no local check; the server wall applies */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The demo refuses plus-addressed aliases (cmuir+x@pingone.com) except for
  // exact allowlisted demo accounts. Best-effort front-end mirror of the BFF
  // gate at /callback — the server decision is authoritative.
  const plusAddressed = (identifier) => {
    const value = String(identifier || "").trim().toLowerCase();
    if (!value.includes("+")) return false;
    const { rejectPlusAddressing, allowedIdentifiers } = plusPolicyRef.current;
    if (!rejectPlusAddressing) return false;
    return !allowedIdentifiers.some((id) => String(id).trim().toLowerCase() === value);
  };
  const begin = useCallback((detail) => {
    const target = detail.returnTo?.split("?")[0]; // BFF rejects query strings; keep the bare path
    const role = detail.role === "admin" ? "admin" : "customer";
    returnToRef.current = target;
    roleRef.current = role;
    forceRef.current = Boolean(detail.force);
    // Customer signs in passwordless-first: the device-only step is the modal's
    // default under the mfa_only policy. Admin is password-first (the admin
    // app's own policy already pairs password with MFA), so it opens on the
    // username/password form and MFA comes after. If the flow open fails with
    // passwordless=1 the open snaps back to the password form in the modal.
    passkeyOptionsRef.current = null;
    // PingFederate customers are device-first too (acr_values=mfa_only → identifier first →
    // PingOne MFA, scripts/pingfederate/enable-pf-passwordless.js). ?signin=mfa on PF keeps the
    // password form: its Multi_Factor flow starts with the password.
    // Admin is device-first too (user decision 2026-10-18); "Use your password instead" stays the
    // break-glass. If the admin app has no mfa_only policy the open fails and snaps to the password form.
    const passwordFirst = providerRef.current === "pingfederate" && mfaRequested();
    secondFactorRef.current = null;
    // With ciba_login_enabled on, CUSTOMERS (either provider) open on a CHOICE screen
    // (passwordless / password + approval link / "use a password") with no flow opened yet.
    // Admin and the ?signin=mfa test hook keep the legacy first step below.
    const choiceFirst = cibaEnabledRef.current && role === "customer" && !mfaRequested();
    setStep(choiceFirst ? "choice" : passwordFirst ? "password" : "device");
    setError("");
    setUsername("");
    setPassword("");
    setOtp("");
    setDeviceUsername("");
    setDevices([]);
    setSelectedDeviceId(null);
    setBusy(!choiceFirst);
    setOpen(true);
    if (choiceFirst) return; // the chosen button opens the flow it needs
    // ?signin=mfa is itself the acr selector (Multi_Factor): sending
    // passwordless=1 alongside would silently win the last-spread and turn
    // the on-demand MFA demo into the device-first policy.
    openFlow(target, role, { passwordless: !mfaRequested() && !passwordFirst });
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
    secondFactorRef.current = null; // leaving the password+approval path
    // The passkey step reaches this too (from the device-picker path), where the
    // password form was never filled — keep whatever username the user typed.
    if (username) setDeviceUsername(username);
    setError("");
    setStep("device");
    setBusy(true);
    openFlow(returnToRef.current, roleRef.current, { passwordless: true });
  };

  useEffect(() => {
    const onSignIn = (e) => {
      const forAdmin = e.detail.role === "admin";
      if (forAdmin ? !adminDrivable : !userDrivable) return; // sender redirects
      e.detail.handled = true;
      begin(e.detail);
    };
    window.addEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
    return () => window.removeEventListener(PI_FLOW_SIGNIN_EVENT, onSignIn);
  }, [begin, userDrivable, adminDrivable]);

  // Choice screen -> the existing password step (opens the password-first flow).
  // `secondFactor` is 'ciba' only from the "password + approval link" button.
  const openPasswordStep = (secondFactor) => {
    if (busy) return;
    secondFactorRef.current = secondFactor;
    setError("");
    setBusy(true);
    setStep("password");
    openFlow(returnToRef.current, roleRef.current);
  };
  const usePassword = () => openPasswordStep(null);
  const usePasswordWithApproval = () => openPasswordStep("ciba");
  // Approval cancelled/failed: a fresh begin() back to the choice screen. The server drops the parked
  // (password-verified) flow when the next pi.flow login opens (openPiFlow; tests/piFlowSecondFactor.test.js
  // 'starting a new pi.flow login discards a parked flow'), i.e. on the next button click, not at begin().
  const restartSignIn = () =>
    begin({ returnTo: returnToRef.current, role: roleRef.current, force: forceRef.current });

  const apiForRole = () => (roleRef.current === "admin" ? ADMIN_API : USER_API);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (plusAddressed(username)) {
      setError("Plus addressing is not allowed for this demo — sign in with your Ping account (no +alias), or a demo test account.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}${apiForRole()}/pi-flow/credentials`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(secondFactorRef.current ? { username, password, secondFactor: secondFactorRef.current } : { username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 502 && body.error === "approval_unavailable") {
        // Password was fine but the approval link can't be sent: stay on the form as a plain password login.
        // The server already saw this flow COMPLETE, so it is dead: reopen a fresh password-first one.
        secondFactorRef.current = null;
        setPassword("");
        setError("Approval link isn't available right now. Sign in with your password instead, or try again.");
        openFlow(returnToRef.current, roleRef.current); // stays busy until the new flow is open; failure falls back as usual
        return;
      }
      if (res.ok && body.step === "approval" && Array.isArray(body.channels)) {
        setPassword("");
        setApprovalChannels(body.channels);
        setStep("approval");
        setBusy(false);
        return;
      }
      if (res.status === 401) {
        setPassword("");
        setError(body.message || "Username or password is incorrect.");
        setBusy(false);
        return;
      }
      if (res.ok && body.redirectTo) {
        // Approval was requested but could not apply: signed in on the password alone — say so.
        const skipped = body.secondFactorSkipped && secondFactorRef.current === "ciba";
        navigateWithOverlay(body.redirectTo, {
          message: skipped ? "Signed in with your password only: no approval link is available for this account." : "Signing in...",
          assign: true,
        });
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
    if (plusAddressed(deviceUsername)) {
      setError("Plus addressing is not allowed for this demo — sign in with your Ping account (no +alias), or a demo test account.");
      return;
    }
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
      if (res.status === 409 && (body.error === "passwordless_unavailable" || body.error === "pi_flow_step_unsupported")) {
        // The policy needs a password (PingOne) or the provider cannot drive
        // passwordless at all (PingFederate): snap INSIDE the modal — never a
        // full-page redirect for the app's first screen.
        setError(body.message || (body.error === "pi_flow_step_unsupported" ? "Passwordless sign-in is not available for this provider — use your password." : "This account requires a password. Sign in with your password."));
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
      if (res.ok && body.step === "device") {
        setDevices(Array.isArray(body.devices) ? body.devices : []);
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
                onClick={() => {
                  if (busy) return;
                  // Other methods in the modal: the device step re-opens the flow
                  // passwordless (switchToDevice reuses the typed username). The
                  // step-up MFA request keeps its redirect — a passwordless reopen
                  // would overwrite the Multi_Factor acr selector.
                  if (mfaRequested()) {
                    redirectLogin(returnToRef.current, roleRef.current, forceRef.current);
                    return;
                  }
                  switchToDevice();
                }}
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
          ) : step === "choice" || step === "approval" ? null : (
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
              {/* Device step's way out lives at the bottom of the modal, next to
                  Cancel — the form body stays just the username field. */}
              {step === "device" && (
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
              )}
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
        {step === "choice" ? (
          <div className="pi-flow-signin__form">
            {/* Copy call: PingFederate has no passkey step, so the label covers both providers. */}
            <button type="button" className="signin-prompt__btn" data-default-button disabled={busy} aria-describedby="pi-flow-passwordless-hint" onClick={switchToDevice}>
              Sign in without a password
            </button>
            <p id="pi-flow-passwordless-hint" className="signin-modal__text ciba-login__hint">passkey or a one-time code</p>
            <button type="button" className="signin-prompt__btn" disabled={busy} onClick={usePasswordWithApproval}>
              Sign in with password + approval link (email or text)
            </button>
            <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" disabled={busy} onClick={usePassword}>
              Use a password instead
            </button>
          </div>
        ) : step === "approval" ? (
          <CibaApprovalPanel
            channels={approvalChannels}
            onApproved={(to) => navigateWithOverlay(to, { message: "Signing in...", assign: true })}
            onCancel={restartSignIn}
          />
        ) : step === "passkey" ? (
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
                  onChange={(e) => setDeviceUsername(e.target.value)}
                />
                {error ? (
                  <p className="signin-modal__text" role="alert">
                    ❌ {error}
                  </p>
                ) : null}
              </form>
            )}
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
