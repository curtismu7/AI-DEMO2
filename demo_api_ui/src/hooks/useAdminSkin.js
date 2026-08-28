import { useEffect } from "react";

const SKIN_CLASS = "admin-skin-p1";

/**
 * Puts the `admin-skin-p1` class on <body>. All admin-skin CSS is scoped under
 * body.admin-skin-p1, so the class is what makes the Ping console skin apply.
 *
 * This used to be a switch. ff_admin_skin_ping2026 chose between this skin and
 * the original dark sidebar, defaulting to this one — but the two differed only
 * in CSS (nav items, routes and behaviour were identical by design), so the
 * alternative bought a second visual QA surface on every admin page and nothing
 * else. The flag and the dark skin are gone; the class is now unconditional.
 *
 * Call once from the app root — leaf components read the skin from CSS scope.
 */
export default function useAdminSkin() {
  useEffect(() => {
    document.body.classList.add(SKIN_CLASS);
    return () => document.body.classList.remove(SKIN_CLASS);
  }, []);
}
