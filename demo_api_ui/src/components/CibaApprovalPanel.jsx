import { useCallback, useEffect, useRef, useState } from "react";

const apiBase = () =>
  process.env.REACT_APP_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

const GRACE_MS = 2000; // polling outlives expiresIn briefly so a last-second approval is not lost
const START_ERRORS = {
  429: "Too many attempts. Try again in a few minutes.",
  409: "Your sign-in timed out. Start again.",
  502: "The approval link isn't available right now. Try again.",
};

// Same wording as the step-up waiting text (cibaWaitingText in AIAgent.js).
const waitingText = (code, channel) =>
  `We sent an approval link by ${channel === "sms" ? "text message" : "email"}. There is nothing to type: open the link, check the page shows match code ${code}, then tap Approve.`;

/**
 * Second factor after the password: approval link by email or text (CIBA).
 * channel (only the channels the server said this user has) -> waiting (match
 * code to COMPARE, polls the BFF). Any terminal failure stops polling and offers
 * "Try again", which hands back to the modal (a fresh begin()).
 * authReqId and matchCode live in component state only.
 */
export default function CibaApprovalPanel({ channels, onApproved, onCancel }) {
  const [phase, setPhase] = useState("channel"); // channel | waiting | error
  const [channel, setChannel] = useState("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0); // bumping this invalidates every in-flight poll/timer
  const timersRef = useRef([]);
  const focusRef = useRef(null);
  // Synchronous double-start guard: state (`busy`) is stale between two events in
  // the same tick, and every start sends a real message + burns a rate-limit slot.
  const startingRef = useRef(false);

  const stop = useCallback(() => {
    runRef.current += 1;
    timersRef.current.forEach((t) => { clearTimeout(t); clearInterval(t); });
    timersRef.current = [];
  }, []);
  useEffect(() => stop, [stop]);

  // Focus the step heading (or the error) on each step change.
  useEffect(() => { focusRef.current?.focus(); }, [phase]);

  const fail = (message) => {
    stop();
    setError(message);
    setPhase("error");
  };

  const poll = (run, authReqId, intervalMs, deadline) => {
    const t = setTimeout(async () => {
      timersRef.current = timersRef.current.filter((x) => x !== t); // fired: don't accumulate
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
          onApproved(body.redirectTo);
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
    if (startingRef.current) return;
    startingRef.current = true;
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
        body: JSON.stringify({ channel: ch }),
      });
      if (run !== runRef.current) return;
      if (!res.ok) return fail(START_ERRORS[res.status] || "Could not send the approval link. Please try again.");
      const body = await res.json();
      if (run !== runRef.current) return;
      const ttl = Number(body.expiresIn) || 120;
      const intervalMs = (Number(body.interval) || 2) * 1000;
      const deadline = Date.now() + ttl * 1000 + GRACE_MS;
      setCode(body.matchCode);
      setSecondsLeft(ttl);
      setPhase("waiting");
      timersRef.current.push(setInterval(() => {
        setSecondsLeft(Math.max(0, Math.ceil((deadline - GRACE_MS - Date.now()) / 1000)));
      }, 1000));
      timersRef.current.push(setTimeout(() => {
        if (run === runRef.current) fail("The approval link expired.");
      }, ttl * 1000 + GRACE_MS));
      poll(run, body.authReqId, intervalMs, deadline);
    } catch {
      if (run === runRef.current) fail("Could not send the approval link. Please try again.");
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  };

  const cancel = () => { stop(); onCancel(); };

  if (phase === "waiting") {
    return (
      <div className="pi-flow-signin__form ciba-login">
        <h3 className="ciba-login__heading" tabIndex={-1} ref={focusRef}>Check your {channel === "sms" ? "phone" : "email"}</h3>
        <p className="signin-modal__text" role="status" aria-live="polite">{waitingText(code, channel)}</p>
        <div className="ciba-login__code" aria-label={`Match code ${code}`}>{code}</div>
        {/* Outside the live region: a screen reader must not announce every second. */}
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
        <p className="signin-modal__text" role="alert" tabIndex={-1} ref={focusRef}>❌ {error}</p>
        <button type="button" className="signin-prompt__btn" data-default-button onClick={cancel}>Try again</button>
      </div>
    );
  }

  return (
    <div className="pi-flow-signin__form ciba-login">
      <h3 className="ciba-login__heading" tabIndex={-1} ref={focusRef}>Where should we send the approval link?</h3>
      {channels.includes("email") && (
        <button type="button" className="signin-prompt__btn" data-default-button disabled={busy} onClick={() => start("email")}>Email</button>
      )}
      {channels.includes("sms") && (
        <button type="button" className="signin-prompt__btn" data-default-button={channels.includes("email") ? undefined : true} disabled={busy} onClick={() => start("sms")}>Text message</button>
      )}
      <button type="button" className="signin-prompt__btn signin-prompt__btn--ghost" onClick={cancel}>Cancel</button>
    </div>
  );
}
