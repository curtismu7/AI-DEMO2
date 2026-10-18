// roleSwitch.js — sign in again as a different role.
// POST /api/auth/switch clears the current session auth (and any stale
// post-login return path); the sign-in then goes through the shared entry point
// — the device-first pi.flow modal, or its redirect fallback — landing on
// `returnTo` (a same-origin SPA path), else the role's home page.
import { openSignIn } from "./signInService";

export async function startRoleSwitch(targetRole, returnTo) {
  const r = await fetch("/api/auth/switch", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetRole }),
  });
  if (!r.ok) throw new Error(`Switch failed: ${r.status}`);
  const admin = targetRole === "admin";
  openSignIn({ role: admin ? "admin" : "customer", returnTo: returnTo || (admin ? "/admin" : "/dashboard"), force: true });
}
