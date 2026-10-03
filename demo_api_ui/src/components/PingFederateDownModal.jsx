import { useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";
import DraggableModal from "./DraggableModal";
import { PF_UNREACHABLE_ERROR } from "../utils/endUserOAuthErrorToast";

const LOGIN_URL = "/api/auth/oauth/user/login";
const POLL_MS = 3000;
const POLL_TRIES = 30;

/**
 * Opens when the BFF sends the browser back with idp_error=pingfederate_unreachable
 * (login provider is PingFederate but PingFederate is not running). Mounted once in
 * App; reads the param in its initial state, which runs before useOAuthUrlCleanup
 * strips it from the URL.
 *
 * Both recovery buttons call session-less BFF routes (routes/pingfederateRecovery.js):
 * the visitor cannot sign in, so cannot be an admin.
 */
export default function PingFederateDownModal() {
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("idp_error") === PF_UNREACHABLE_ERROR,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    clearTimeout(timer.current);
    setBusy(false);
    setOpen(false);
  };
  const goToLogin = () => {
    window.location.href = LOGIN_URL;
  };
  const fail = (err, fallback) => {
    setBusy(false);
    setMessage(err?.response?.data?.message || fallback);
  };

  // Poll until PingFederate answers, then carry on to sign-in.
  const waitForPingFederate = (triesLeft) => {
    apiClient
      .get("/api/auth/pingfederate/status")
      .then(({ data }) => {
        if (data?.down === false) {
          setMessage("PingFederate is up. Signing in...");
          goToLogin();
        } else if (triesLeft <= 1) {
          setBusy(false);
          setMessage("PingFederate was started but is still not responding. Give it a minute, then try again.");
        } else {
          timer.current = setTimeout(() => waitForPingFederate(triesLeft - 1), POLL_MS);
        }
      })
      .catch((err) => fail(err, "Could not check PingFederate."));
  };

  const startPingFederate = async () => {
    setBusy(true);
    setMessage("Starting PingFederate. This takes about 20 seconds...");
    try {
      await apiClient.post("/api/auth/pingfederate/start");
      waitForPingFederate(POLL_TRIES);
    } catch (err) {
      fail(err, "Could not start PingFederate.");
    }
  };

  const usePingOne = async () => {
    setBusy(true);
    setMessage("");
    try {
      await apiClient.post("/api/auth/pingfederate/use-pingone");
      goToLogin();
    } catch (err) {
      fail(err, "Could not switch the login provider to PingOne.");
    }
  };

  return (
    <DraggableModal
      isOpen={open}
      onClose={close}
      title="PingFederate is not responding"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={close}>
            Close
          </button>
          <button type="button" className="btn btn-secondary" onClick={usePingOne} disabled={busy}>
            Sign in with PingOne
          </button>
          <button type="button" className="btn btn-primary" onClick={startPingFederate} disabled={busy}>
            Start PingFederate
          </button>
        </>
      }
      defaultWidth={540}
      defaultHeight={320}
      minWidth={420}
      backdropClose
      storageKey={null}
    >
      <div className="dm-scroll confirm-modal-message">
        <p>
          Sign-in could not start. The login provider is set to PingFederate, but PingFederate is not responding.
        </p>
        <p>
          <strong className="pf-down-action">Start PingFederate</strong> and sign in again, or switch the login
          provider back to PingOne.
        </p>
        {message && (
          <p role="status" className="pf-down-status">
            {message}
          </p>
        )}
      </div>
    </DraggableModal>
  );
}
