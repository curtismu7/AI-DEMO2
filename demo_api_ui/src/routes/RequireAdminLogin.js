import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import { notifyError } from "../utils/appToast";
import { startRoleSwitch } from "../utils/roleSwitch";

/**
 * Route wrapper for admin features that any user may reach. Admins render the
 * page; non-admins get a confirm dialog offering to re-login as admin (via
 * POST /api/auth/switch), returning to this route after the admin OAuth flow.
 * Cancel goes home. Unlike AdminRoute, this never silently redirects — the
 * user always sees why the page needs an admin session.
 */
export default function RequireAdminLogin({ user, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);

  if (user?.role === "admin") return children;

  return (
    <ConfirmModal
      isOpen
      title="Admin sign-in required"
      message="This is an admin feature. Log in as admin to continue? Your current session will end."
      confirmLabel={switching ? "Switching..." : "Log in as admin"}
      cancelLabel="Cancel"
      onConfirm={async () => {
        setSwitching(true);
        try {
          await startRoleSwitch("admin", location.pathname);
        } catch (e) {
          setSwitching(false);
          notifyError(
            "Failed to switch to admin. Please try again.",
          );
          console.error("[RequireAdminLogin] Role switch failed:", e.message);
        }
      }}
      onCancel={() => navigate("/", { replace: true })}
    />
  );
}
