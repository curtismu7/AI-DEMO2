import { FC, useEffect, useState } from "react";
import apiClient from "../services/apiClient";

type Step = "idle" | "devices" | "otp" | "verified" | "done";
type Status = "pending" | "running" | "passed" | "failed";
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };
const STEP_LABEL: Record<Step, string> = {
  idle: "Not started",
  devices: "Pick a device",
  otp: "Enter the code",
  verified: "Identity verified",
  done: "Password changed",
};

interface Device {
  id: string;
  type?: string;
  email?: string;
  phone?: string;
  name?: string;
}

const BASE = "/api/auth/mfa";

/**
 * Forgot-password test: start → device → code proves the MFA leg (Passed) without
 * touching the password. Setting a new password is a separate, opt-in step because
 * it changes the account's real PingOne password.
 */
const MFATestForgotPasswordSection: FC = () => {
  const [username, setUsername] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [daId, setDaId] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .get("/api/auth/oauth/user/status")
      .then(({ data }) => {
        const name = data?.user?.username;
        if (name) setUsername((cur) => cur || name);
      })
      .catch(() => {});
  }, []);

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || err?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    call(async () => {
      setStep("idle");
      setAck(false);
      const { data } = await apiClient.post(`${BASE}/forgot-password/start`, { username: username.trim() });
      setDaId(data.daId);
      setDevices(data.devices || []);
      setStep("devices");
    });

  const afterChallenge = (data: any) => setStep(data?.completed || data?.status === "COMPLETED" ? "verified" : "otp");

  const pickDevice = (id: string) =>
    call(async () => {
      setDeviceId(id);
      const { data } = await apiClient.put(`${BASE}/challenge/${encodeURIComponent(daId)}`, { deviceId: id });
      afterChallenge(data);
    });

  const verify = () =>
    call(async () => {
      const { data } = await apiClient.put(`${BASE}/challenge/${encodeURIComponent(daId)}`, { deviceId, otp: otp.trim() });
      afterChallenge(data);
    });

  const complete = () =>
    call(async () => {
      await apiClient.post(`${BASE}/forgot-password/complete`, { newPassword });
      setNewPassword("");
      setStep("done");
    });

  const status: Status = error
    ? "failed"
    : step === "verified" || step === "done"
      ? "passed"
      : busy || step !== "idle"
        ? "running"
        : "pending";

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-forgot-card">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">{BASE}/forgot-password/start</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/mfa/"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne MFA"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        The BFF starts a PingOne MFA device authentication for the user, then <code>PUT {BASE}/challenge/:daId</code>{" "}
        selects the device and checks the code. Verifying passes the test; the password is not changed.
      </p>

      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Username</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="mfa-forgot-username"
        />
      </div>

      {step === "devices" && (
        <div className="mfa-test-card__actions" style={{ marginBottom: "0.75rem" }}>
          {devices.length === 0 && <span className="info-text">No MFA devices on this account.</span>}
          {devices.map((d) => (
            <button
              key={d.id}
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              onClick={() => pickDevice(d.id)}
              disabled={busy}
              data-testid={`mfa-forgot-device-${d.id}`}
            >
              {d.type || "Device"} {d.email || d.phone || d.name || ""}
            </button>
          ))}
        </div>
      )}

      {step === "otp" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="config-label">Code</div>
          <input
            type="text"
            className="otp-input"
            style={{ width: "100%", fontSize: "1rem" }}
            value={otp}
            autoComplete="one-time-code"
            onChange={(e) => setOtp(e.target.value)}
            data-testid="mfa-forgot-otp"
          />
        </div>
      )}

      {step === "verified" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="config-label">New password (optional)</div>
          <input
            type="password"
            className="otp-input"
            style={{ width: "100%", fontSize: "1rem" }}
            value={newPassword}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
            data-testid="mfa-forgot-new-password"
          />
          <label style={{ display: "block", marginTop: "0.5rem" }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="mfa-forgot-ack" />{" "}
            I understand this changes the real PingOne password for this account
          </label>
        </div>
      )}

      <div className="mfa-test-card__actions">
        {step === "otp" ? (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--primary"
            onClick={verify}
            disabled={busy || !otp.trim()}
            data-testid="mfa-forgot-verify"
          >
            Verify code
          </button>
        ) : step === "verified" ? (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--primary"
            onClick={complete}
            disabled={busy || !ack || !newPassword}
            data-testid="mfa-forgot-complete"
          >
            Set new password
          </button>
        ) : (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--primary"
            onClick={start}
            disabled={busy || !username.trim()}
            data-testid="mfa-forgot-start"
          >
            {step === "idle" ? "Start forgot password" : "Restart"}
          </button>
        )}
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-forgot-status">
          {CARD_STATUS_LABEL[status]}: {error ? "Error" : STEP_LABEL[step]}
        </span>
      </div>

      {(error || status === "passed") && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {error && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {error}
            </div>
          )}
          {status === "passed" && (
            <div className="mfa-test-card__success-message">
              {step === "done" ? "Password changed in PingOne." : "MFA passed for the reset session. Password unchanged."}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MFATestForgotPasswordSection;
