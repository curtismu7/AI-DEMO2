import { useEffect, useState } from "react";
import UserDashboard from "../components/UserDashboard";
import UserDashboardPing2026 from "../components/UserDashboardPing2026";

const FLAG_ID = "ff_customer_skin_ping2026";

/**
 * DashboardContent — extracted from App.js so the /dashboard route composition
 * lives in one place.
 *
 * AuthorizeRulesPanel was moved to its own side-nav route.
 * WebMcpPanel was moved to its own side-nav route at /webmcp.
 *
 * The other customer routes (/accounts, /transactions, /profile, etc.) are
 * declared directly in App.js because React Router v6 requires <Route> elements
 * to be DIRECT children of <Routes>, not nested in a component.
 *
 * ff_customer_skin_ping2026: when ON, renders UserDashboardPing2026 (new Ping2026
 * skin). When OFF (default), renders the frozen classic UserDashboard.
 */
export function DashboardContent({ user, logout }) {
  const [ping2026, setPing2026] = useState(false);
  // Wait for the flag before mounting EITHER dashboard. Rendering the classic
  // one first and swapping once the fetch lands mounted-then-unmounted a whole
  // dashboard on every load — the visible old→new flash, and a second round of
  // agent-host registration churn. Resolve first, mount once.
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const flag = ((data && data.flags) || []).find((f) => f.id === FLAG_ID);
        if (flag != null) setPing2026(Boolean(flag.value));
      })
      .catch(() => {
        /* flag unreadable — fall through to the default (classic) dashboard */
      })
      .finally(() => {
        if (!cancelled) setResolved(true); // never leave the route blank
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!resolved) return null;
  if (ping2026) {
    return <UserDashboardPing2026 user={user} onLogout={logout} />;
  }
  return <UserDashboard user={user} onLogout={logout} />;
}
