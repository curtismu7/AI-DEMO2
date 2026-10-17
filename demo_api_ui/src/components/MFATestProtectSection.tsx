import { FC, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { collectPingOneSignals } from "../lib/pingOneSignalsSdk";
import { evaluateProtectBrowserRisk } from "../services/protectAuthenticationService";

type Status = "pending" | "running" | "passed" | "failed";
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

interface Risk {
  level: string;
  recommendedAction?: string | null;
  botDetection?: { level?: string | null } | null;
}

// evaluateProtectBrowserRisk only surfaces the HTTP status ("... failed (503)"), so map status → route error code.
const STATUS_MESSAGE: Record<string, string> = {
  "400": "Invalid user or signals (invalid_user_id / invalid_signals_data)",
  "413": "Signals payload too large (signals_data_too_large)",
  "502": "Protect evaluation failed (protect_evaluation_failed)",
  "503": "Protect is not configured (protect_evaluation_not_configured)",
};

/** PingOne Protect browser risk evaluation: Signals SDK → BFF → PingOne Protect. */
const MFATestProtectSection: FC = () => {
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<Status>("pending");
  const [stage, setStage] = useState("Not started");
  const [risk, setRisk] = useState<Risk | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .get("/api/auth/oauth/user/status")
      .then(({ data }) => {
        const name = data?.user?.username;
        if (name) setUserId((cur) => cur || name);
      })
      .catch(() => {});
  }, []);

  const run = async () => {
    setStatus("running");
    setRisk(null);
    setError("");
    try {
      setStage("Collecting Signals…");
      const signalsData = await collectPingOneSignals();
      setStage("Evaluating…");
      const result = await evaluateProtectBrowserRisk({ userId: userId.trim(), signalsData });
      setRisk(result);
      setStatus("passed");
      setStage(`Risk ${result.level}`);
    } catch (err: any) {
      const code = /\((\d{3})\)/.exec(err?.message || "")?.[1];
      setError((code && STATUS_MESSAGE[code]) || err?.message || "Risk evaluation failed");
      setStatus("failed");
      setStage("Error");
    }
  };

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-protect-card">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/protect-auth/evaluations</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/protect/risk-evaluations.html"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne Protect — risk evaluations"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">
        The PingOne Signals SDK collects browser signals, then the BFF sends them to PingOne Protect for a risk
        evaluation of this user.
      </p>

      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">User (username or email)</div>
        <input
          type="text"
          className="otp-input"
          style={{ width: "100%", fontSize: "1rem" }}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          data-testid="mfa-protect-user"
        />
      </div>

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={run}
          disabled={status === "running" || !userId.trim()}
          data-testid="mfa-protect-run"
        >
          {status === "running" ? "Evaluating…" : "Run risk evaluation"}
        </button>
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-protect-status">
          {CARD_STATUS_LABEL[status]}: {stage}
        </span>
      </div>

      {(risk || error) && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`} data-testid="mfa-protect-result">
          {risk && <div className="mfa-test-card__success-badge">Success</div>}
          {error && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {error}
            </div>
          )}
          {risk && (
            <div className="mfa-test-card__success-message">
              Level: {risk.level}
              {risk.recommendedAction ? ` · Recommended action: ${risk.recommendedAction}` : ""}
              {risk.botDetection?.level ? ` · Bot detection: ${risk.botDetection.level}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MFATestProtectSection;
