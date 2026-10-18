import { FC, useState } from "react";
import apiClient from "../services/apiClient";

type Phase = "idle" | "enrolling" | "scan" | "verifying" | "active" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  enrolling: "Creating device…",
  scan: "Waiting for code",
  verifying: "Verifying…",
  active: "Device active",
  error: "Error",
};

// Same status vocabulary as MFATestCard so the pill looks like every other test on the page.
const CARD_STATUS: Record<Phase, "pending" | "running" | "passed" | "failed"> = {
  idle: "pending",
  enrolling: "running",
  scan: "running",
  verifying: "running",
  active: "passed",
  error: "failed",
};
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

const errorText = (err: any, fallback: string) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

/**
 * Enroll a TOTP authenticator app: PingOne creates the device and returns its
 * otpauth:// key URI, the user adds it to their app, and the first code activates it.
 */
const MFATestTotpSection: FC = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [keyUri, setKeyUri] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");

  const start = async () => {
    setPhase("enrolling");
    setDetail("");
    setCode("");
    try {
      const { data } = await apiClient.post("/api/mfa/test/integration/enroll-totp-init", {});
      setDeviceId(data.deviceId);
      setKeyUri(data.keyUri || "");
      setSecret(data.secret || "");
      setPhase("scan");
    } catch (err: any) {
      setPhase("error");
      setDetail(errorText(err, "Could not create the TOTP device"));
    }
  };

  const verify = async () => {
    setPhase("verifying");
    setDetail("");
    try {
      const { data } = await apiClient.post("/api/mfa/test/integration/enroll-totp-complete", {
        deviceId,
        otp: code,
      });
      setPhase("active");
      setDetail(`PingOne activated the authenticator device (status ${data.status || "ACTIVE"}).`);
    } catch (err: any) {
      // Keep the key on screen so the user can retry with the next code.
      setPhase("error");
      setDetail(errorText(err, "Could not activate the TOTP device"));
    }
  };

  const status = CARD_STATUS[phase];
  const showKey = Boolean(deviceId) && phase !== "active" && phase !== "enrolling";

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-totp">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/mfa/test/integration/enroll-totp-init</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/create-mfa-user-device-totp.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne MFA — create TOTP device"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        PingOne creates an authenticator-app (TOTP) device and returns its key. Add it to your
        authenticator app, then enter the 6-digit code it shows to activate the device.
      </p>

      {showKey && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div className="config-label">Add to your authenticator app (open the link on your phone, or type the secret)</div>
          <a href={keyUri} data-testid="mfa-totp-keyuri" style={{ wordBreak: "break-all" }}>
            {keyUri}
          </a>
          <pre
            className="test-card-raw-json"
            data-testid="mfa-totp-secret"
            style={{ fontFamily: "monospace", userSelect: "all", margin: "0.5rem 0 0 0" }}
          >
            {secret}
          </pre>
          <div className="config-label" style={{ marginTop: "0.75rem" }}>6-digit code</div>
          <input
            type="text"
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            data-testid="mfa-totp-code"
          />
        </div>
      )}

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={start}
          disabled={phase === "enrolling" || phase === "verifying"}
          data-testid="mfa-totp-start"
        >
          {deviceId ? "Enroll a new authenticator app" : "Enroll authenticator app"}
        </button>
        {showKey && (
          <button
            type="button"
            className="mfa-test-button mfa-test-button--secondary"
            onClick={verify}
            disabled={code.length !== 6 || phase === "verifying"}
            data-testid="mfa-totp-verify"
          >
            Verify code
          </button>
        )}
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-totp-status">
          {CARD_STATUS_LABEL[status]}: {PHASE_LABEL[phase]}
        </span>
      </div>

      {detail && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {status === "failed" && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {detail}
            </div>
          )}
          {status === "passed" && <div className="mfa-test-card__success-message">{detail}</div>}
        </div>
      )}
    </div>
  );
};

export default MFATestTotpSection;
