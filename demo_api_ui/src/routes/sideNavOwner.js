/**
 * Single source of truth for WHO renders <AdminSideNav>.
 *
 * Two places can render it: App.js (global chrome) and AppShell (per-route
 * chrome). Before this module they both did, unconditionally, so every
 * AppShell-wrapped route (/use-cases, /oauth-academy, /api-traffic, …) painted
 * two identical sidebars on top of each other.
 *
 * The rule: App.js owns the side nav whenever it renders one; AppShell renders
 * one only when App.js does not. Routes where App.js opts out (the no-chrome
 * pages, and any route viewed logged-out) still get their sidebar from AppShell.
 */

/** Routes that deliberately render without the app's global chrome. */
export function isNoChromeRoute(pathNorm) {
  return (
    pathNorm === "/api-traffic" ||
    pathNorm === "/logs" ||
    pathNorm === "/agent" ||
    // SDK centralized-login sandbox: standalone page, no app chrome/panels/footer.
    pathNorm === "/sdk-login" ||
    pathNorm === "/sdk-login/callback" ||
    // UC22 CIBA approve popup: bare modal page — no sidebar / agent FAB.
    pathNorm === "/ciba-approve"
  );
}

/** Normalize a pathname the way App.js does (strip one trailing slash). */
export function normalizePath(pathname) {
  return String(pathname || "").replace(/\/$/, "") || "/";
}

/**
 * True when App.js renders the global <AdminSideNav> for this location.
 * Home hosts full-bleed layouts and wants no side nav.
 *
 * Guests get the side nav too (2026-08-18): it used to be signed-in only,
 * which left signed-out visitors with a nav on AppShell routes but none on
 * bare routes (/pingone-authorize, /telemetry, guard pages) — an
 * inconsistency that read as "the nav is missing". AdminSideNav is
 * null-user safe and role-filters its items.
 */
export function appRendersSideNav({ pathname }) {
  const pathNorm = normalizePath(pathname);
  return !isNoChromeRoute(pathNorm) && pathNorm !== "/";
}

/**
 * True when AppShell must supply the side nav itself (App.js did not).
 * Bare popup pages (CIBA approve) never take a shell nav either.
 */
export function shellRendersSideNav({ pathname, user }) {
  const pathNorm = normalizePath(pathname);
  if (pathNorm === "/ciba-approve") return false;
  return !appRendersSideNav({ pathname, user });
}
