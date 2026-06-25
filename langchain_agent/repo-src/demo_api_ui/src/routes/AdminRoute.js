import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { notifyWarning } from "../utils/appToast";

/**
 * Admin-only route wrapper. Renders children for admins; otherwise redirects
 * to `/` with a one-shot warning toast.
 *
 * The "toasted once" guard is a per-instance useRef (not a module-level flag).
 * That way each AdminRoute mount fires the toast on first render — clicking
 * /admin then /users then /audit produces 3 toasts (one per admin URL the
 * non-admin tried), which is the desired UX. A module-level flag would only
 * fire once per page load and silently redirect on subsequent clicks.
 */
export default function AdminRoute({ user, children }) {
  const toastedRef = useRef(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin && !toastedRef.current) {
      toastedRef.current = true;
      notifyWarning("This page is restricted to admin users.");
    }
  }, [isAdmin]);

  if (isAdmin) return children;
  return <Navigate to="/" replace />;
}
