import { useState } from "react";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";
import { startEmbeddedSignIn, submitPassword } from "../../lib/embeddedPiFlow";

// Embedded username/password sign-in for /sdk-login. The password goes from this
// browser straight to PingOne (pi.flow); the code is exchanged by the SDK here, so
// the BFF never sees the password or the tokens. Anything beyond a password step,
// or a browser that blocks PingOne's third-party session cookie, falls back to
// the hosted sign-ins.
export default function EmbeddedSignInForm({ onSignedIn, onUsePopup, onUseRedirect }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null); // { code, message }

  const submit = async (event) => {
    event.preventDefault();
    const typed = password;
    setPassword("");
    setBusy(true);
    setFailure(null);
    try {
      const client = await getSdkClient();
      const flow = await startEmbeddedSignIn(client);
      const { code, state } = await submitPassword(flow, username, typed);
      const result = await client.token.exchange(code, state);
      if (isSdkError(result)) throw Object.assign(new Error(result.error || "Token exchange failed."), { code: "start_failed" });
      onSignedIn();
    } catch (err) {
      setFailure({ code: err.code || "start_failed", message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const needsHosted = failure && (failure.code === "unsupported_step" || failure.code === "resume_blocked");

  return (
    <form className="sdk-embedded-form" onSubmit={submit}>
      <label className="sdk-field">
        <span>Username</span>
        <input className="sdk-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="sdk-field">
        <span>Password</span>
        <input className="sdk-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" className="sdk-btn sdk-btn-primary" disabled={busy}>
        {busy ? "Signing in…" : "Sign in here"}
      </button>
      {failure && (
        <div className="sdk-signin-error" role="alert">
          <p>{failure.message}</p>
          {needsHosted && (
            <div className="sdk-signin-row">
              <button type="button" className="sdk-btn sdk-btn-ghost" onClick={onUsePopup}>Use the pop-out</button>
              <button type="button" className="sdk-btn sdk-btn-ghost" onClick={onUseRedirect}>Use the redirect</button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
