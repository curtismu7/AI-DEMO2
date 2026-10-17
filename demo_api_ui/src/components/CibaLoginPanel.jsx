import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

// Same wording as the step-up waiting text (cibaWaitingText in AIAgent.js).
const waitingText = (code, channel) =>
  `We sent an approval link by ${channel === "sms" ? "text message" : "email"}. There is nothing to type: open the link, check the page shows match code ${code}, then tap Approve.`;

/**
 * Passwordless sign-in by approval link (CIBA over email or SMS).
 * identifier -> channel (both always offered: the server answers identically
 * for every account) -> waiting (match code to COMPARE, polls the BFF).
 * authReqId and matchCode live in component state only.
 */
export default function CibaLoginPanel({ role, onSignedIn, onUsePassword, onBack }) {
  const [phase, setPhase] = useState("identifier"); // identifier | channel | waiting | error
  const [identifier, setIdentifier] = useState("");
  const [channel, setChannel] = useState("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0); // bumping this invalidates every in-flight poll/timer
  const timersRef = useRef([]);
  const headingRef = useRef(null);

  const stop = useCallback(() => {
    runRef.current += 1;
    timersRef.current.forEach((t) => { clearTimeout(t); clearInterval(t); });
    timersRef.current = [];
  }, []);
  useEffect(() => stop, [stop]);

  // Move focus to the step heading on each step change (the identifier input autofocuses itself).
  useEffect(() => {
    if (phase !== "identifier") headingRef.current?.focus();
  }, [phase]);

  const fail = (message) => {
    stop();
    setError(message);
    setPhase("error");
  };

  const poll = (run, authReqId, intervalMs, deadline) => {
    const t = setTimeout(async () => {
      if (run !== runRef.current) return;
      try {
        const res = await fetch(`${apiBase()}/api/auth/ciba/login/poll/${authReqId}`, { credentials: "include" });
        if (run !== runRef.current) return;
        if (res.status !== 200) {
          fail(res.status === 403 ? "That sign-in was denied." : res.status === 410 ? "The approval link expired." : "Sign-in could not be completed.");
          return;
        }
        const body = await res.json().catch(() => ({}));
        if (run !== runRef.current) return;
        if (body.status === "approved" && body.redirectTo) {
          stop();
          onSignedIn(body.redirectTo);
          return;
        }
      } catch {
        /* network blip: retry until the deadline */
        if (run !== runRef.current) return;
      }
      if (Date.now() < deadline) poll(run, authReqId, intervalMs, deadline);
    }, intervalMs);
    timersRef.current.push(t);
  };

  const start = async (ch) => {
    if (busy) return;
    stop();
    const run = runRef.current;
    setChannel(ch);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBase()}/api/auth/ciba/login/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), channel: ch, role }),
      });
      if (run !== runRef.current) return;
      if (res.status === 429) return fail("Too many attempts. Wait a few minutes and try again.");
      if (res.status === 503) return fail("Approval-link sign-in is not available for this identity provider. Use a password instead.");
      if (!res.ok) return fail("Could not send the approval link. Please try again.");
      const body = await res.json();
      if (run !== runRef.current) return;
      const ttl = Number(body.expiresIn) || 120;
      const intervalMs = (Number(body.interval) || 2) * 1000;
      const deadline = Date.now() + ttl * 1000;
      setCode(body.matchCode);
      setSecondsLeft(ttl);
      setPhase("waiting");
      timersRef.current.push(setInterval(() => {
        setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      }, 1000));
      timersRef.current.push(setTimeout(() => {
        if (run === runRef.current) fail("The approval link expired.");
      }, ttl * 1000));
      poll(run, body.authReqId, intervalMs, deadline);
    } catch {
      if (run === runRef.current) fail("Could not send the approval link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const restart = () => { stop(); setError(""); setCode(""); setPhase("identifier"); };
  const cancel = () => { stop(); onBack(); };

  if (phase === "waiting") {
    return (
      <div className="pi-flow-signin__form ciba-login">
        <h3 className="ciba-login__heading" tabIndex={-1} ref={headingRef}>Check your {channel === "sms" ? "phone" : "email"}</h3>
        <p className="signin-modal__text" role="status" aria-live="polite">{waitingText(code, channel)}</p>
        <div className="ciba-login__code" aria-label={`Match code ${code}`}>{code}</div>
        <p className="signin-modal__text ciba-login__timer">
          Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </p>
        <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={cancel}>Cancel</button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="pi-flow-signin__form ciba-login">
        <p className="signin-modal__text" role="alert">❌ {error}</p>
        <button type="button" className="signin-prompt__btn" data-default-button onClick={restart}>Try again</button>
        <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={onUsePassword}>Use a password instead</button>
        <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={onBack}>Back</button>
      </div>
    );
  }

  if (phase === "channel") {
    return (
      <div className="pi-flow-signin__form ciba-login">
        <h3 className="ciba-login__heading" tabIndex={-1} ref={headingRef}>Where should we send the approval link?</h3>
        <button type="button" className="signin-prompt__btn" data-default-button disabled={busy} onClick={() => start("email")}>Email</button>
        <button type="button" className="signin-prompt__btn" disabled={busy} onClick={() => start("sms")}>Text message</button>
        <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={() => setPhase("identifier")}>Back</button>
      </div>
    );
  }

  return (
    <form
      className="pi-flow-signin__form ciba-login"
      onSubmit={(e) => { e.preventDefault(); if (identifier.trim()) setPhase("channel"); }}
    >
      <label className="pi-flow-signin__label" htmlFor="ciba-login-identifier">Username or email</label>
      <input
        id="ciba-login-identifier"
        className="pi-flow-signin__input"
        type="text"
        autoComplete="username"
        autoFocus
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
      />
      <button type="submit" className="signin-prompt__btn" data-default-button disabled={!identifier.trim()}>Continue</button>
      <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={onBack}>Back</button>
      <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={onUsePassword}>Use a password instead</button>
    </form>
  );
}
