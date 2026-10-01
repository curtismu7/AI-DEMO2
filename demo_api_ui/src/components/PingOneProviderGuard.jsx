import { useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import { clearIdJagRunStateForProviderSwitch } from "../utils/idJagRunMode";
import DraggableModal from "./DraggableModal";
import "./PingOneProviderGuard.css";

export default function PingOneProviderGuard({ children, returnTo, description }) {
  const [oauthSession, setOAuthSession] = useState(null);
  const [showWarning, setShowWarning] = useState(false);
  const [providerCheckState, setProviderCheckState] = useState("checking");
  const [providerCheckAttempt, setProviderCheckAttempt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(null);

  useEffect(() => {
    let active = true;
    setProviderCheckState("checking");
    apiClient
      .get("/api/auth/oauth/user/status")
      .then(({ data }) => {
        if (!active) return;
        setOAuthSession(data);
        setShowWarning(data?.loginProvider === "pingfederate");
        setProviderCheckState("ready");
      })
      .catch(() => {
        if (active) setProviderCheckState("error");
      });
    return () => {
      active = false;
    };
  }, [providerCheckAttempt]);

  const hasActivePfSession =
    oauthSession?.authenticated === true &&
    oauthSession?.oauthProvider === "pingfederate";

  const continueToPingOne = async () => {
    if (switching) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const idJagRestore = await clearIdJagRunStateForProviderSwitch();
      if (idJagRestore?.provider !== "pingone") {
        await apiClient.post("/api/admin/config", { oauth_provider: "pingone" });
      }
      if (hasActivePfSession && !idJagRestore?.sessionCleared) {
        await apiClient.post("/api/auth/clear-session");
      }
      window.location.href = `/api/auth/oauth/user/login?return_to=${returnTo}`;
    } catch (err) {
      const message = err?.response?.data?.message;
      setSwitchError(
        err?.response?.data?.error === "not_authorized"
          ? "An administrator session is required to switch the login provider."
          : message || "Could not switch the login provider to PingOne. Please try again.",
      );
    } finally {
      setSwitching(false);
    }
  };

  const cancelWarning = () => {
    if (switching) return;
    setSwitchError(null);
    setShowWarning(false);
  };

  const retryProviderCheck = () => {
    setProviderCheckState("checking");
    setProviderCheckAttempt((attempt) => attempt + 1);
  };

  return (
    <>
      {providerCheckState === "ready" && !showWarning && children}
      {providerCheckState === "checking" && (
        <div className="pingone-provider-check-status" role="status">
          Checking the selected login provider…
        </div>
      )}
      {providerCheckState === "error" && (
        <div className="pingone-provider-check-error" role="alert">
          <p>
            We couldn’t determine which login provider is selected. Retry the
            check before using this page.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={retryProviderCheck}
          >
            Retry provider check
          </button>
        </div>
      )}
      {showWarning && (
        <DraggableModal
          isOpen
          onClose={cancelWarning}
          title="PingOne sign-in required"
          className="pingone-provider-warning"
          defaultWidth={500}
          defaultHeight={270}
          minWidth={400}
          minHeight={240}
          backdropClose
          storageKey={null}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary pingone-provider-warning__cancel"
                onClick={cancelWarning}
                disabled={switching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={continueToPingOne}
                disabled={switching}
              >
                {switching ? "Switching…" : "Continue to PingOne"}
              </button>
            </>
          }
        >
          <div className="dm-scroll confirm-modal-message">
            <p>{description}</p>
            <p>
              PingFederate is currently selected for login. Continuing switches
              the shared login provider to PingOne.
            </p>
            <p>
              {hasActivePfSession
                ? "Your active PingFederate app session will be cleared before sign-in."
                : "You will be redirected to the PingOne sign-in form."}
            </p>
            {switchError && <p role="alert">{switchError}</p>}
          </div>
        </DraggableModal>
      )}
    </>
  );
}
