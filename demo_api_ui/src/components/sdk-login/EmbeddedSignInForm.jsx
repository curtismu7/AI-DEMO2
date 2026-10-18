import { useState } from "react";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";
import { startEmbeddedSignIn, submitPassword, startPasswordlessSignIn, lookupUser, selectDevice, checkOtp } from "../../lib/embeddedPiFlow";

const DEVICE_LABEL = { EMAIL: "Email", SMS: "SMS", VOICE: "Voice", TOTP: "Authenticator app", FIDO2: "Passkey" };
const deviceLabel = (d) => [DEVICE_LABEL[d.type] || d.type, d.email || d.phone || d.nickname].filter(Boolean).join(" · ");

// Embedded sign-in for /sdk-login. The password goes only from this browser to
// PingOne (pi.flow) and never to the BFF; the code is exchanged by the SDK here.
// "Sign in with a device instead" drives PingOne's passwordless policy (mfa_only)
// the same way: username -> device -> one-time code. Anything else (a passkey, a
// policy screen), or a browser that blocks PingOne's third-party session cookie,
// falls back to the hosted sign-ins.
export default function EmbeddedSignInForm({ onSignedIn, onUsePopup, onUseRedirect, disabled, onBusyChange }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null); // { code, message }
  // "password" | "device" (username) | "pick" (device list) | "otp" (code entry)
  // Device-first like the main sign-in pop-up (user decision 2026-10-18); password is one click away.
  const [mode, setMode] = useState("device");
  const [pwlFlow, setPwlFlow] = useState(null);
  const [devices, setDevices] = useState([]);
  const [otp, setOtp] = useState("");

  const run = async (work) => {
    setBusy(true);
    onBusyChange?.(true);
    setFailure(null);
    try {
      await work();
    } catch (err) {
      setFailure({ code: err.code || "start_failed", message: err.message });
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const finish = async (client, code, state) => {
    const result = await client.token.exchange(code, state);
    if (isSdkError(result)) throw Object.assign(new Error(result.error || "Token exchange failed."), { code: "start_failed" });
    onSignedIn();
  };

  const submit = (event) => {
    event.preventDefault();
    const typed = password;
    setPassword("");
    return run(async () => {
      const client = await getSdkClient();
      const flow = await startEmbeddedSignIn(client);
      const { code, state } = await submitPassword(flow, username, typed);
      await finish(client, code, state);
    });
  };

  // One passwordless step's answer: next screen, or done.
  const advance = async (client, next) => {
    if (next.step === "done") return finish(client, next.code, next.state);
    setDevices(next.devices);
    setMode(next.step === "device" ? "pick" : "otp");
  };

  const submitUsername = (event) => {
    event.preventDefault();
    return run(async () => {
      const client = await getSdkClient();
      const flow = await startPasswordlessSignIn(client);
      setPwlFlow(flow);
      await advance(client, await lookupUser(flow, username));
    });
  };

  const pickDevice = (id) => run(async () => advance(await getSdkClient(), await selectDevice(pwlFlow, id)));

  const submitOtp = (event) => {
    event.preventDefault();
    const typed = otp;
    setOtp("");
    return run(async () => advance(await getSdkClient(), await checkOtp(pwlFlow, typed)));
  };

  const switchTo = (next) => {
    setMode(next);
    setFailure(null);
    setPwlFlow(null);
  };

  const needsHosted = failure && (failure.code === "unsupported_step" || failure.code === "resume_blocked");
  const controlsDisabled = busy || disabled;
  const usernameField = (
    <label className="sdk-field">
      <span>Username</span>
      <input className="sdk-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
    </label>
  );

  return (
    <div className="sdk-embedded-form">
      {mode === "password" && (
        <form className="sdk-embedded-form" onSubmit={submit}>
          {usernameField}
          <label className="sdk-field">
            <span>Password</span>
            <input className="sdk-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" className="sdk-btn sdk-btn-primary" disabled={controlsDisabled}>
            {busy ? "Signing in…" : "Sign in here"}
          </button>
          <button type="button" className="sdk-btn sdk-btn-ghost" disabled={controlsDisabled} onClick={() => switchTo("device")}>
            Sign in with a device instead
          </button>
        </form>
      )}
      {mode === "device" && (
        <form className="sdk-embedded-form" onSubmit={submitUsername}>
          <p>No password: PingOne sends a one-time code to your email or phone.</p>
          {usernameField}
          <button type="submit" className="sdk-btn sdk-btn-primary" disabled={controlsDisabled}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      )}
      {mode === "pick" && (
        <div className="sdk-embedded-form" role="group" aria-label="Choose where to send the code">
          <p>Where should PingOne send the code?</p>
          {devices.map((d) => (
            <button key={d.id} type="button" className="sdk-btn sdk-btn-ghost" disabled={controlsDisabled} onClick={() => pickDevice(d.id)}>
              {deviceLabel(d)}
            </button>
          ))}
        </div>
      )}
      {mode === "otp" && (
        <form className="sdk-embedded-form" onSubmit={submitOtp}>
          <label className="sdk-field">
            <span>Verification code</span>
            <input className="sdk-input" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value)} required />
          </label>
          <button type="submit" className="sdk-btn sdk-btn-primary" disabled={controlsDisabled}>
            {busy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}
      {mode !== "password" && (
        <button type="button" className="sdk-btn sdk-btn-ghost" disabled={controlsDisabled} onClick={() => switchTo("password")}>
          Use your password instead
        </button>
      )}
      {failure && (
        <div className="sdk-signin-error" role="alert">
          <p>{failure.message}</p>
          {needsHosted && (
            <div className="sdk-signin-row">
              <button type="button" className="sdk-btn sdk-btn-ghost" disabled={controlsDisabled} onClick={onUsePopup}>Use the pop-out</button>
              <button type="button" className="sdk-btn sdk-btn-ghost" disabled={controlsDisabled} onClick={onUseRedirect}>Use the redirect</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
