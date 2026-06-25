import { useEffect, useState } from "react";

const FLAG_ID = "ff_admin_skin_ping2026";
const SKIN_CLASS = "admin-skin-p1";

/**
 * Reads ff_admin_skin_ping2026 and toggles the `admin-skin-p1` class on
 * <body>. All ping2026-skin CSS is scoped under body.admin-skin-p1, so this
 * class is the single switch between the classic and new admin skins.
 * Defaults to the new skin (the flag's registered default) while loading and
 * on fetch error. Call once from the app root — leaf components read the
 * skin from CSS scope, not from this hook.
 */
export default function useAdminSkin() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const flag = (data.flags || []).find((f) => f.id === FLAG_ID);
        if (flag) setEnabled(Boolean(flag.value));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle(SKIN_CLASS, enabled);
    return () => document.body.classList.remove(SKIN_CLASS);
  }, [enabled]);
}
