import React from "react";
import DraggableModal from "./DraggableModal";
import "./AdminRequiredModal.css";

/**
 * AdminRequiredModal — shown when a signed-in, non-admin user opens an
 * admin-only page (currently /api/docs and /api/reference).
 *
 * Those pages open in a bare tab with no SPA loaded, so the BFF cannot render
 * a modal there. It redirects to the app with `?adminRequired=<path>` instead,
 * and this is what the app shows on arrival. `wantedPath` is that path, kept so
 * the user can go straight back once signed in as an admin rather than having
 * to remember the URL.
 *
 * Wraps DraggableModal so it drags, pops out (🪟) and closes (✕) like every
 * other modal in the app.
 *
 * Props:
 *   wantedPath  the admin-only path the user tried to open
 *   isOpen      boolean
 *   onClose     () => void
 */
export default function AdminRequiredModal({ wantedPath, isOpen, onClose }) {
  if (!wantedPath) return null;

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Admin access required"
      className="admin-required-modal"
      defaultWidth={520}
      defaultHeight={340}
      storageKey="adminRequiredModal"
    >
      {/* dm-scroll, not a bare div: .dm-body has no padding and no scroll, so
          content would sit flush against the panel edge and clip. The class is
          merged onto this single root child per the dmScrollContract test. */}
      <div className="dm-scroll arm-body">
        <div className="arm-icon" aria-hidden="true">
          🔐
        </div>

        <p className="arm-lead">
          <code className="arm-path">{wantedPath}</code> is an admin-only page.
        </p>

        <p className="arm-detail">
          You are signed in, but this account has neither the admin role nor the
          admin scope, so the page was not opened.
        </p>

        <div className="arm-actions">
          <a
            className="arm-btn arm-btn-primary"
            href={`/api/auth/oauth/login?return_to=${encodeURIComponent(wantedPath)}`}
          >
            Sign in as admin
          </a>
          <button type="button" className="arm-btn arm-btn-secondary" onClick={onClose}>
            Stay here
          </button>
        </div>
      </div>
    </DraggableModal>
  );
}
