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

type Channel = "email" | "sms";

interface Props {
  /** Delivery channel under test: each has its own PingOne CIBA app + DaVinci flow. */
  channel: Channel;
  /** Pre-filled from the user selected on the page. */
  loginHint?: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  starting: "Starting…",
  pending: "Waiting for approval",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  error: "Error",
};

// Same status vocabulary as MFATestCard so the pill looks like every other test on the page.
const CARD_STATUS: Record<Phase, "pending" | "running" | "passed" | "failed"> = {
  idle: "pending",
  starting: "running",
  pending: "running",
  approved: "passed",
  denied: "failed",
  expired: "failed",
  error: "failed",
};
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

const HOW_IT_ARRIVES: Record<Channel, string> = {
  email: "PingOne runs the email-only DaVinci flow and emails an approval link.",
  sms: "PingOne runs the SMS-only DaVinci flow and texts an approval link to the user's Mobile phone.",
};

/**
 * One CIBA test card: initiate against the real BFF route, then poll until the
 * user approves. Same endpoints the step-up picker uses.
 */
const MFATestCibaSection: FC<Props> = ({ channel, loginHint = "" }) => {
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
        channel,
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
  const status = CARD_STATUS[phase];

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid={`mfa-ciba-${channel}`}>
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/auth/ciba/initiate</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/auth/openid-connect-oauth-2/client-initiated-backchannel-auth.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne CIBA — initiate"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        {HOW_IT_ARRIVES[channel]} The BFF then polls <code>GET /api/auth/ciba/poll/:id</code> until it
        is approved. Nothing redirects back to this page.
      </p>

      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Login hint (email or username)</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="user@example.com"
          data-testid="mfa-ciba-hint"
        />
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Binding message (shown with the link, max 8 characters)</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={message}
          maxLength={8}
          onChange={(e) => setMessage(e.target.value)}
          data-testid="mfa-ciba-message"
        />
      </div>

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={start}
          disabled={busy}
          data-testid="mfa-ciba-start"
        >
          {busy ? "Waiting…" : channel === "sms" ? "Send text approval" : "Send email approval"}
        </button>
        {busy && (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--secondary"
            onClick={() => {
              stop();
              setPhase("idle");
            }}
          >
            Cancel
          </button>
        )}
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-ciba-status">
          {CARD_STATUS_LABEL[status]}: {PHASE_LABEL[phase]}
          {phase === "pending" && secondsLeft > 0 ? ` (${secondsLeft}s left)` : ""}
        </span>
      </div>

      {(detail || authReqId) && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {status === "failed" && detail && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {detail}
            </div>
          )}
          {status === "passed" && detail && <div className="mfa-test-card__success-message">{detail}</div>}
          {authReqId && (
            <div className="test-card-raw-json" style={{ fontSize: "0.85rem" }}>
              auth_req_id: {authReqId.slice(0, 8)}…
              {sentMessage ? ` · message sent: ${sentMessage}` : ""}
              {engine ? ` · engine: ${engine}` : ""}
              {` · channel: ${channel}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MFATestCibaSection;
