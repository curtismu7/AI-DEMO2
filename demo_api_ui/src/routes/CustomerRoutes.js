import UserDashboardPing2026 from "../components/UserDashboardPing2026";

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
 * There used to be two dashboards here, chosen by ff_customer_skin_ping2026:
 * this one, and a frozen classic `UserDashboard` kept as an instant revert. The
 * classic component was 3,374 lines of which 97% appeared verbatim in this one,
 * with 52 unique lines and no capability of its own — a fork maintained in
 * parallel, not an alternative. It is gone, and with it the flag, the
 * flag-resolution spinner, and the double-mount race the spinner existed to
 * prevent (both dashboards registering agent-surface hosts on one load, the
 * loser's unmount wiping the winner's registration — "you see it then it gets
 * hidden").
 */
export function DashboardContent({ user, logout }) {
  return <UserDashboardPing2026 user={user} onLogout={logout} />;
}
