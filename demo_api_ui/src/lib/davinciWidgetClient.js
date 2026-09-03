// DaVinci Widget login (/davinci-login).
//
// The widget script is hosted by Ping and pulled in on demand rather than
// bundled, so it is only fetched on the one page that uses it. Every secret
// stays on the BFF: POST /api/davinci-login/sdk-token mints the SDK token from
// the DaVinci API key, arms the OIDC nonce, and keeps the PKCE verifier, then
// returns only what davinci.skRenderScreen needs plus the authorize URL the
// page visits once the flow succeeds. Nothing here is hardcoded in the bundle.

const WIDGET_SRC = "https://assets.pingone.com/davinci/latest/davinci.js";

let scriptPromise = null;

export function loadWidget() {
  if (window.davinci) return Promise.resolve(window.davinci);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = WIDGET_SRC;
      el.async = true;
      el.onload = () =>
        window.davinci
          ? resolve(window.davinci)
          : reject(new Error("The DaVinci widget script loaded but exposed no global."));
      el.onerror = () => {
        // Clear the cache so a retry re-attempts the network fetch instead of
        // resolving the same rejected promise forever.
        scriptPromise = null;
        reject(new Error("Could not load the DaVinci widget script."));
      };
      document.head.appendChild(el);
    });
  }
  return scriptPromise;
}

// username is optional in the flow's Input Schema — the flow's own Sign On
// screen collects it, so this page does not.
export async function fetchWidgetConfig() {
  const res = await fetch("/api/davinci-login/sdk-token", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Could not start a DaVinci login flow (HTTP ${res.status}).`);
  }
  return res.json();
}
