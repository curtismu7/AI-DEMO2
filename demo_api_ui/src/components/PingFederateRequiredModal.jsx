import { useEffect, useState } from "react";
import bffAxios from "../services/bffAxios";
import { navigateToCustomerOAuthForceLogin } from "../utils/authUi";
import DraggableModal from "./DraggableModal";
import "./PingOneProviderGuard.css";

/**
 * Mounted once in App. Opens when a PingFederate-only run (live ID-JAG, raised in
 * useAuth) finds PingOne selected instead. The detail carries the page to return to.
 */
export default function PingFederateRequiredModal() {
  const [returnTo, setReturnTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onRequired = (event) => {
      setError(null);
      setReturnTo(event.detail?.returnTo || "/pingfederate-id-jag/demo");
    };
    window.addEventListener("id-jag-provider-required", onRequired);
    return () => window.removeEventListener("id-jag-provider-required", onRequired);
  }, []);

  if (!returnTo) return null;

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await bffAxios.post("/api/admin/config", { oauth_provider: "pingfederate" });
      navigateToCustomerOAuthForceLogin(returnTo);
    } catch (err) {
      setError(
        err?.response?.data?.error === "not_authorized"
          ? "An administrator session is required to switch the login provider to PingFederate."
          : err?.response?.data?.message || "Could not switch the login provider to PingFederate.",
      );
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!busy) setReturnTo(null);
  };

  return (
    <DraggableModal
      isOpen
      onClose={cancel}
      title="PingFederate sign-in required"
      className="pingone-provider-warning"
      defaultWidth={500}
      defaultHeight={270}
      minWidth={400}
      minHeight={240}
      backdropClose
      storageKey={null}
      footer={
        <>
          <button type="button" className="btn btn-secondary pingone-provider-warning__cancel" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={signIn} disabled={busy}>
            {busy ? "Switching…" : "Sign in with PingFederate"}
          </button>
        </>
      }
    >
      <div className="dm-scroll confirm-modal-message">
        <p>This use case needs PingFederate, but you are signed in with PingOne.</p>
        <p>Continuing switches the shared login provider to PingFederate and signs you in with it.</p>
        {error && <p role="alert">{error}</p>}
      </div>
    </DraggableModal>
  );
}
