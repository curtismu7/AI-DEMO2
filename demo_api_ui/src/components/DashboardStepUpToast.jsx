import React from "react";
import "./DashboardStepUpToast.css";

/**
 * Body of the persistent "Additional verification required" toast (step-up MFA, HTTP 428). Moved out of
 * UserDashboardPing2026.js unchanged, except that the RFC 9470 challenge line is styled by a class instead of an
 * inline style. The toast renders in the app's toast container, outside the page, so its rule lives beside it.
 */
export default function DashboardStepUpToast({
  stepUpChallengeRaw,
  stepUpMethod,
  cibaStatus,
  agentTriggeredStepUp,
  agentCountdown,
  cancelAutoInitiate,
  handleCibaStepUp,
  onRetryCiba,
  onVerifyEmail,
  dismissStepUp,
}) {
  return (
    <div
      className="dashboard-toast-error"
      style={{ flexDirection: "column", alignItems: "stretch" }}
    >
      <p className="dashboard-toast-error__text" style={{ marginBottom: 8 }}>
        <strong>Additional verification required.</strong> Transfers and
        withdrawals of $250 or more require MFA. Verify your identity to
        continue.
      </p>
      {stepUpChallengeRaw && (
        <p className="dashboard-toast-error__challenge">
          <strong>RFC 9470 challenge:</strong> WWW-Authenticate:{" "}
          {stepUpChallengeRaw}
        </p>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {stepUpMethod === "ciba" ? (
          <>
            {cibaStatus === "idle" &&
              agentTriggeredStepUp &&
              agentCountdown > 0 && (
                <>
                  <span style={{ fontStyle: "italic" }}>
                    Starting in {agentCountdown}s…
                  </span>
                  <button
                    type="button"
                    className="dashboard-toast-error__btn"
                    onClick={cancelAutoInitiate}
                  >
                    Cancel
                  </button>
                </>
              )}
            {cibaStatus === "idle" &&
              (!agentTriggeredStepUp || agentCountdown === 0) && (
                <button
                  type="button"
                  className="dashboard-toast-error__btn"
                  onClick={handleCibaStepUp}
                >
                  Verify via CIBA
                </button>
              )}
            {cibaStatus === "pending" && (
              <span style={{ fontStyle: "italic" }}>
                Waiting for approval on your device…
              </span>
            )}
            {cibaStatus === "error" && (
              <button
                type="button"
                className="dashboard-toast-error__btn"
                onClick={onRetryCiba}
              >
                Retry
              </button>
            )}
          </>
        ) : (
          <>
            {agentTriggeredStepUp && agentCountdown > 0 && (
              <>
                <span style={{ fontStyle: "italic" }}>
                  Redirecting in {agentCountdown}s…
                </span>
                <button
                  type="button"
                  className="dashboard-toast-error__btn"
                  onClick={cancelAutoInitiate}
                >
                  Cancel
                </button>
              </>
            )}
            {(!agentTriggeredStepUp || agentCountdown === 0) && (
              <button
                type="button"
                className="dashboard-toast-error__btn"
                onClick={onVerifyEmail}
              >
                Verify via Email
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="dashboard-toast-error__btn"
          onClick={dismissStepUp}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
