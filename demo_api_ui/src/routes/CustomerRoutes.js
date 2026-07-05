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
  // null = flag not resolved yet. Do NOT mount either dashboard until we know
  // which one to render: rendering the classic UserDashboard first and then
  // swapping to UserDashboardPing2026 when the flag resolves mounts BOTH during
  // one load. Their agent-surface registrations (setSurfaceHostEl /
  // setClinicalSplit on the shared AgentUiModeContext) then race, and the losing
  // instance's unmount cleanup wipes the winner's registration — leaving the
  // agent unportaled and hidden ("you see it then it gets hidden"). Deferring
  // until the flag is known guarantees a single mount and also removes the
  // visible old->new flash.
  const [ping2026, setPing2026] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/feature-flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const flag = data && (data.flags || []).find((f) => f.id === FLAG_ID);
        setPing2026(flag != null ? Boolean(flag.value) : false);
      })
      .catch(() => {
        if (!cancelled) setPing2026(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Flag unresolved — render nothing yet so only ONE dashboard ever mounts.
  if (ping2026 === null) {
    return null;
  }
  if (ping2026) {
    return <UserDashboardPing2026 user={user} onLogout={logout} />;
  }
  return <UserDashboard user={user} onLogout={logout} />;
}
