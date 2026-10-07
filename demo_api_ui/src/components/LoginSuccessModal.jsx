import React, { useState } from "react";
import DraggableModal from "./DraggableModal";
import "./LoginSuccessModal.css";

// Which server issued this sign-in, and what that means for the PingFederate features. The user otherwise has no
// way to tell, and the PingFederate features only accept a PingFederate sign-in.
const PROVIDERS = {
  pingone: {
    name: "PingOne",
    note: "PingOne issued your tokens. The PingFederate features ask for a separate PingFederate sign-in.",
  },
  pingfederate: {
    name: "PingFederate",
    note: "PingFederate issued your tokens, so the PingFederate features use this sign-in.",
  },
};

const hostOf = (issuer) => {
  try { return new URL(issuer).host; } catch { return null; }
};

/**
 * LoginSuccessModal — shown once after a fresh login (PingOne or PingFederate)
 * to confirm who signed in and through which server. Split-hero layout: accent
 * panel on the left, identity fields (name / email / phone) and the sign-in
 * server on the right. Wraps DraggableModal so it drags,
 * pops out (🪟) and closes (✕) like every other modal.
 *
 * Props:
 *   user             the authenticated user ({ firstName, lastName, email, phone, username })
 *   signIn           { provider, issuer } of the live session (from the status endpoint); falls back to the
 *                    user's own oauthProvider / oauthIssuer
 *   isOpen           boolean
 *   onClose          () => void
 *   onDontShowAgain  () => void  — called when "Don't show again" was checked
 */
export default function LoginSuccessModal({ user, signIn = null, isOpen, onClose, onDontShowAgain }) {
  const [dontShow, setDontShow] = useState(false);
  if (!user) return null;

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    "Signed in";
  const email = user.email || null;
  const phone = user.phone || null;
  // The live session's answer (signIn) wins over the stored user record's copy.
  const provider = PROVIDERS[String(signIn?.provider || user.oauthProvider || "").toLowerCase()] || null;
  const issuerHost = hostOf(signIn?.issuer || user.oauthIssuer);

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
      <button type="button" className="btn btn-primary" onClick={handleContinue}>
        Let's get started
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Welcome back!"
      defaultWidth={460}
      defaultHeight={provider ? 420 : 344}
      minWidth={380}
      minHeight={300}
      footer={footer}
    >
      <div className="lsm-split">
        <div className="lsm-left">
          <div className="lsm-mark" aria-hidden="true">🔐</div>
          <h3 className="lsm-hello">All set! You're in.</h3>
          <p className="lsm-via">{provider ? `Signed in through ${provider.name}` : "Verified and secure"}</p>
          <div className="lsm-secure" aria-hidden="true">✓ Secure session</div>
        </div>
        <div className="lsm-right">
          {provider && (
            <div className="lsm-field lsm-provider" data-testid="lsm-provider">
              <span className="lsm-label">Signed in through</span>
              <span className="lsm-value">
                {provider.name}
                {issuerHost && <span className="lsm-issuer"> · {issuerHost}</span>}
              </span>
              <span className="lsm-note">{provider.note}</span>
            </div>
          )}
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
