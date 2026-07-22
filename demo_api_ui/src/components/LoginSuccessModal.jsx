import React, { useState } from "react";
import DraggableModal from "./DraggableModal";
import "./LoginSuccessModal.css";

/**
 * LoginSuccessModal — shown once after a fresh PingOne login to confirm who
 * signed in. Split-hero layout: accent panel on the left, identity fields
 * (name / email / phone) on the right. Wraps DraggableModal so it drags,
 * pops out (🪟) and closes (✕) like every other modal.
 *
 * Props:
 *   user             the authenticated user ({ firstName, lastName, email, phone, username })
 *   isOpen           boolean
 *   onClose          () => void
 *   onDontShowAgain  () => void  — called when "Don't show again" was checked
 */
export default function LoginSuccessModal({ user, isOpen, onClose, onDontShowAgain }) {
  const [dontShow, setDontShow] = useState(false);
  if (!user) return null;

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    "Signed in";
  const email = user.email || null;
  const phone = user.phone || null;

  const handleContinue = () => {
    if (dontShow && onDontShowAgain) onDontShowAgain();
    if (onClose) onClose();
  };

  const footer = (
    <>
      <label className="lsm-dontshow">
        <input
          type="checkbox"
          checked={dontShow}
          onChange={(e) => setDontShow(e.target.checked)}
        />
        Don't show again
      </label>
      <button type="button" className="lsm-continue" onClick={handleContinue}>
        Continue to dashboard
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Welcome back"
      defaultWidth={460}
      defaultHeight={344}
      minWidth={380}
      minHeight={300}
      footer={footer}
    >
      <div className="lsm-split">
        <div className="lsm-left">
          <div className="lsm-mark" aria-hidden="true">🔐</div>
          <h3 className="lsm-hello">You're signed in</h3>
          <p className="lsm-via">Verified through PingOne</p>
          <div className="lsm-secure" aria-hidden="true">✓ Secure session</div>
        </div>
        <div className="lsm-right">
          <div className="lsm-field">
            <span className="lsm-label">Name</span>
            <span className="lsm-value">{fullName}</span>
          </div>
          {email && (
            <div className="lsm-field">
              <span className="lsm-label">Email</span>
              <span className="lsm-value">
                {email} <span className="lsm-tick" aria-hidden="true">✓</span>
              </span>
            </div>
          )}
          {phone && (
            <div className="lsm-field">
              <span className="lsm-label">Phone</span>
              <span className="lsm-value lsm-mono">
                {phone} <span className="lsm-tick" aria-hidden="true">✓</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
