import { useState } from "react";
import DraggableModal from "./DraggableModal";
import { PF_UNREACHABLE_ERROR } from "../utils/endUserOAuthErrorToast";

/**
 * Opens when the BFF sends the browser back with idp_error=pingfederate_unreachable
 * (login provider is PingFederate but PingFederate is not running). Mounted once in
 * App; reads the param in its initial state, which runs before useOAuthUrlCleanup
 * strips it from the URL.
 */
export default function PingFederateDownModal() {
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("idp_error") === PF_UNREACHABLE_ERROR,
  );
  const close = () => setOpen(false);

  return (
    <DraggableModal
      isOpen={open}
      onClose={close}
      title="PingFederate is not running"
      footer={
        <button type="button" className="btn btn-primary" onClick={close}>
          Close
        </button>
      }
      defaultWidth={460}
      defaultHeight={260}
      minWidth={380}
      backdropClose
      storageKey={null}
    >
      <div className="dm-scroll confirm-modal-message">
        <p>
          Sign-in could not start. The login provider is set to PingFederate, but PingFederate is not responding.
        </p>
        <p>Start PingFederate and sign in again, or switch the login provider back to PingOne.</p>
      </div>
    </DraggableModal>
  );
}
