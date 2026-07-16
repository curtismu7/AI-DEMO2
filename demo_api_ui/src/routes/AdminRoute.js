import { useRef } from "react";
import { Navigate } from "react-router-dom";
import { notifyWarning } from "../utils/appToast";

/**
 * Admin-only route wrapper. Renders children for admins; otherwise redirects
 * to `/` with a one-shot warning toast.
 *
 * The toast fires synchronously during render (via a ref guard) so it is
 * dispatched BEFORE React Router processes the <Navigate>, ensuring the user
 * sees the warning on the destination page. The previous useEffect approach
 * fired the toast after paint — by which time the component was already
 * unmounted by the redirect, so the toast was lost.
 */
export default function AdminRoute({ user, children }) {
  const toastedRef = useRef(false);
  const isAdmin = user?.role === "admin";

  if (isAdmin) return children;

  // Fire toast synchronously before the redirect unmounts this component.
  // The ref guard ensures it only fires once per mount.
  if (!toastedRef.current) {
    toastedRef.current = true;
    notifyWarning("This page is restricted to admin users.");
  }

  return <Navigate to="/" replace />;
}
