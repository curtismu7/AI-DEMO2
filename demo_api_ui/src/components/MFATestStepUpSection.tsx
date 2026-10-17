import { FC, useCallback, useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import { authenticateWebAuthn } from "../utils/passkeyCeremony";

type Phase = "idle" | "working" | "select" | "otp" | "push" | "passed" | "failed";

interface Device {
  id: string;
  type: string;
  nickname?: string;
  name?: string;
  email?: string;
  phone?: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  working: "Working…",
  select: "Pick a device",
  otp: "Enter the code",
  push: "Waiting for push approval",
  passed: "Step-up complete",
  failed: "Step-up failed",
};

// Same status vocabulary as MFATestCard so the pill looks like every other test on the page.
const CARD_STATUS: Record<Phase, "pending" | "running" | "passed" | "failed"> = {
  idle: "pending",
  working: "running",
  select: "running",
  otp: "running",
  push: "running",
  passed: "passed",
  failed: "failed",
};
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

const FAILED_STATUSES = ["FAILED", "EXPIRED", "CANCELED", "CANCELLED", "TIMED_OUT"];

const errMessage = (err: any, fallback: string) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

/**
 * Step-up MFA test card: the same /api/auth/mfa/challenge routes the app's
 * step-up modal uses (PingOne deviceAuthentications behind the BFF).
 */
const MFATestStepUpSection: FC = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [daId, setDaId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [otp, setOtp] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runId = useRef(0);

  const stop = useCallback(() => {
    runId.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const fail = (msg: string) => {
    setPhase("failed");
    setDetail(msg);
  };

  const poll = useCallback((id: string, myRun: number) => {
    timer.current = setTimeout(async () => {
      if (myRun !== runId.current) return;
      try {
        const { data } = await apiClient.get(`/api/auth/mfa/challenge/${encodeURIComponent(id)}/status`);
        if (myRun !== runId.current) return;
        if (data?.status === "COMPLETED") {
          setPhase("passed");
          setDetail("Push approved; the BFF marked this session step-up verified.");
        } else if (FAILED_STATUSES.includes(data?.status)) {
          setPhase("failed");
          setDetail(`PingOne returned ${data.status}.`);
        } else {
          poll(id, myRun);
        }
      } catch (err: any) {
        if (myRun !== runId.current) return;
        setPhase("failed");
        setDetail(errMessage(err, "Status poll failed"));
      }
    }, 2000);
  }, []);

  // Handle a PUT/POST result status; returns nothing, moves the phase.
  const handleStatus = async (id: string, status: string, myRun: number) => {
    if (status === "COMPLETED") {
      setPhase("passed");
      setDetail("PingOne completed the device authentication; the BFF marked this session step-up verified.");
    } else if (status === "OTP_REQUIRED") {
      setPhase("otp");
    } else if (status === "PUSH_CONFIRMATION_REQUIRED") {
      setPhase("push");
      poll(id, myRun);
    } else if (status === "ASSERTION_REQUIRED") {
      // The PUT response carries no WebAuthn options; the status route returns them.
      const { data } = await apiClient.get(`/api/auth/mfa/challenge/${encodeURIComponent(id)}/status`);
      const { assertionValue } = await authenticateWebAuthn(data?.publicKeyCredentialRequestOptions);
      const { data: res } = await apiClient.put(`/api/auth/mfa/challenge/${encodeURIComponent(id)}`, {
        assertion: assertionValue,
        origin: window.location.origin,
      });
      if (myRun === runId.current) await handleStatus(id, res?.status, myRun);
    } else {
      fail(`PingOne returned ${status || "no status"}.`);
    }
  };

  const run = async (fn: (myRun: number) => Promise<void>, fallback: string) => {
    const myRun = runId.current;
    setPhase("working");
    setDetail("");
    try {
      await fn(myRun);
    } catch (err: any) {
      if (myRun === runId.current) fail(errMessage(err, fallback));
    }
  };

  const start = () => {
    stop();
    setDaId("");
    setDevices([]);
    setOtp("");
    return run(async () => {
      const { data } = await apiClient.post("/api/auth/mfa/challenge");
      setDaId(data.daId);
      setDevices(data.devices || []);
      setPhase("select");
    }, "Could not start step-up");
  };

  const pick = (id: string) => {
    setDeviceId(id);
    return run(async (myRun) => {
      const { data } = await apiClient.put(`/api/auth/mfa/challenge/${encodeURIComponent(daId)}`, { deviceId: id });
      await handleStatus(daId, data?.status, myRun);
    }, "Device selection failed");
  };

  const submitOtp = () =>
    run(async (myRun) => {
      const { data } = await apiClient.put(`/api/auth/mfa/challenge/${encodeURIComponent(daId)}`, {
        deviceId,
        otp: otp.trim(),
      });
      await handleStatus(daId, data?.status, myRun);
    }, "Code check failed");

  const busy = CARD_STATUS[phase] === "running";
  const status = CARD_STATUS[phase];
  const hasMobile = devices.some((d) => d.type === "MOBILE");

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-stepup">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/auth/mfa/challenge</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/mfa/users/device-authentications.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne MFA — device authentications"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        The production step-up: the BFF starts a PingOne device authentication, you pick a device with{" "}
        <code>PUT /api/auth/mfa/challenge/:daId</code>, then answer it with a code, a passkey, or a push
        approval (polled via <code>GET /api/auth/mfa/challenge/:daId/status</code>).
      </p>

      {phase !== "idle" && devices.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="config-label">Devices</div>
          {devices.map((d) => (
            <button
              key={d.id}
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              style={{ marginRight: "0.5rem", marginBottom: "0.5rem" }}
              onClick={() => pick(d.id)}
              disabled={phase !== "select"}
              data-testid={`mfa-stepup-device-${d.id}`}
            >
              {d.type}
              {d.nickname || d.name || d.phone || d.email ? ` · ${d.nickname || d.name || d.phone || d.email}` : ""}
            </button>
          ))}
          {!hasMobile && (
            <p className="info-text" data-testid="mfa-stepup-push-note">
              Push needs a phone app built with the PingOne MFA SDK; none is registered in this environment.
            </p>
          )}
        </div>
      )}

      {phase === "otp" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="config-label">One-time code</div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="otp-input"
            style={{ width: "100%", fontSize: "1rem" }}
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            data-testid="mfa-stepup-otp"
          />
          <button
            type="button"
            className="mfa-test-button mfa-test-button--primary"
            style={{ marginTop: "0.5rem" }}
            onClick={submitOtp}
            disabled={!otp.trim()}
            data-testid="mfa-stepup-otp-submit"
          >
            Verify code
          </button>
        </div>
      )}

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={start}
          disabled={busy && phase !== "select" && phase !== "otp"}
          data-testid="mfa-stepup-start"
        >
          {phase === "idle" ? "Start step-up" : "Restart step-up"}
        </button>
        {phase === "push" && (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--secondary"
            onClick={() => {
              stop();
              setPhase("idle");
            }}
            data-testid="mfa-stepup-cancel"
          >
            Cancel
          </button>
        )}
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-stepup-status">
          {CARD_STATUS_LABEL[status]}: {PHASE_LABEL[phase]}
        </span>
      </div>

      {(detail || daId) && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {status === "failed" && detail && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {detail}
            </div>
          )}
          {status === "passed" && detail && <div className="mfa-test-card__success-message">{detail}</div>}
          {daId && (
            <div className="test-card-raw-json" style={{ fontSize: "0.85rem" }}>
              daId: {daId.slice(0, 8)}…{deviceId ? ` · device: ${deviceId.slice(0, 8)}…` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MFATestStepUpSection;
