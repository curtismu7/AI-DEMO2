import { FC, useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";

type Phase =
  | "idle"
  | "starting"
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "error";

interface Props {
  /** Pre-filled from the user selected on the page. */
  loginHint?: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  starting: "Starting…",
  pending: "Waiting for approval — click the link in the email",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  error: "Error",
};

/**
 * CIBA (email-link approval) test: initiate against the real BFF route, then
 * poll until the user approves. Same endpoints the step-up picker uses.
 */
const MFATestCibaSection: FC<Props> = ({ loginHint = "" }) => {
  const [hint, setHint] = useState(loginHint);
  const [message, setMessage] = useState("Approve");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [authReqId, setAuthReqId] = useState("");
  const [sentMessage, setSentMessage] = useState("");
  const [engine, setEngine] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    if (loginHint) setHint(loginHint);
  }, [loginHint]);

  const stop = useCallback(() => {
    runId.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  // Countdown shown while pending.
  useEffect(() => {
    if (phase !== "pending" || secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  const poll = useCallback(
    (id: string, intervalMs: number, myRun: number) => {
      timer.current = setTimeout(async () => {
        if (myRun !== runId.current) return;
        try {
          const { data } = await apiClient.get(`/api/auth/ciba/poll/${encodeURIComponent(id)}`);
          if (myRun !== runId.current) return;
          if (data?.status === "approved") {
            setPhase("approved");
            setDetail("PingOne issued tokens; the BFF stored them server-side.");
            return;
          }
          const next = data?.slow_down ? Math.max(intervalMs, (data.retry_after || 10) * 1000) : intervalMs;
          poll(id, next, myRun);
        } catch (err: any) {
          if (myRun !== runId.current) return;
          const status = err?.response?.status;
          if (status === 403) {
            setPhase("denied");
            setDetail(err.response?.data?.message || "The request was denied.");
          } else if (status === 410) {
            setPhase("expired");
            setDetail("The request expired before it was approved.");
          } else {
            setPhase("error");
            setDetail(err?.response?.data?.message || err?.message || "Poll failed");
          }
        }
      }, intervalMs);
    },
    [],
  );

  const start = async () => {
    stop();
    const myRun = runId.current;
    setPhase("starting");
    setDetail("");
    setAuthReqId("");
    try {
      const { data } = await apiClient.post("/api/auth/ciba/initiate", {
        login_hint: hint.trim() || undefined,
        binding_message: message,
      });
      setAuthReqId(data.auth_req_id);
      setSentMessage(data.binding_message || "");
      setEngine(data.engine || "");
      setSecondsLeft(Number(data.expires_in) || 120);
      setPhase("pending");
      poll(data.auth_req_id, Math.max(2, Number(data.interval) || 5) * 1000, myRun);
    } catch (err: any) {
      setPhase("error");
      setDetail(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "Could not start CIBA",
      );
    }
  };

  const busy = phase === "starting" || phase === "pending";

  return (
    <section className="mfa-test-section" data-testid="mfa-ciba-section">
      <h2 className="mfa-test-section-title">CIBA (Email Link) Testing</h2>
      <p className="info-text">
        Client-initiated backchannel authentication: the BFF calls{" "}
        <code>POST /api/auth/ciba/initiate</code>, PingOne runs the DaVinci CIBA flow and emails an
        approval link, and the BFF polls <code>GET /api/auth/ciba/poll/:id</code> until it is
        approved. Nothing redirects back to this page.
      </p>
      <label className="ciba-label" style={{ display: "block", marginBottom: "0.5rem" }}>
        Login hint (email or username)
        <input
          className="ciba-input"
          style={{ display: "block", width: "100%" }}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="user@example.com"
          data-testid="mfa-ciba-hint"
        />
      </label>
      <label className="ciba-label" style={{ display: "block", marginBottom: "0.75rem" }}>
        Binding message (shown in the email, max 8 characters)
        <input
          className="ciba-input"
          style={{ display: "block", width: "100%" }}
          value={message}
          maxLength={8}
          onChange={(e) => setMessage(e.target.value)}
          data-testid="mfa-ciba-message"
        />
      </label>
      <button
        type="button"
        className="mfa-test-btn"
        onClick={start}
        disabled={busy}
        data-testid="mfa-ciba-start"
      >
        {busy ? "Waiting…" : "Send CIBA approval request"}
      </button>
      {busy && (
        <button type="button" className="mfa-test-btn" style={{ marginLeft: "0.5rem" }} onClick={() => { stop(); setPhase("idle"); }}>
          Cancel
        </button>
      )}
      <div style={{ marginTop: "0.75rem" }} data-testid="mfa-ciba-status">
        <strong>Status:</strong> {PHASE_LABEL[phase]}
        {phase === "pending" && secondsLeft > 0 && <> ({secondsLeft}s left)</>}
        {detail && <div>{detail}</div>}
        {authReqId && (
          <div style={{ fontSize: "0.85em" }}>
            auth_req_id: <code>{authReqId.slice(0, 8)}…</code>
            {sentMessage && <> · message sent: <code>{sentMessage}</code></>}
            {engine && <> · engine: <code>{engine}</code></>}
          </div>
        )}
      </div>
    </section>
  );
};

export default MFATestCibaSection;
