// roleSwitch.js — initiate an OAuth re-login as a different role via the BFF.
// POST /api/auth/switch clears the current session auth and returns the login
// URL for the target role; we navigate there, optionally asking the BFF to
// land on `returnTo` (a same-origin SPA path) after login completes.
export async function startRoleSwitch(targetRole, returnTo) {
  const r = await fetch("/api/auth/switch", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetRole }),
  });
  if (!r.ok) throw new Error(`Switch failed: ${r.status}`);
  const contentType = r.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Switch returned ${contentType}, expected application/json`);
  }
  const { redirectUrl } = await r.json();
  const sep = redirectUrl.includes("?") ? "&" : "?";
  window.location.href = returnTo
    ? `${redirectUrl}${sep}return_to=${encodeURIComponent(returnTo)}`
    : redirectUrl;
}
