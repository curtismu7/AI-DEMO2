// DaVinci Widget login (embedded in /davinci-login-guide's "Try It Live" section).
//
// The widget script is hosted by Ping and pulled in on demand rather than
// bundled, so it is only fetched on the one page that uses it. Every secret
// stays on the BFF: POST /api/davinci-login/sdk-token mints the SDK token from
// the DaVinci API key and arms the OIDC nonce, then returns only what
// davinci.skRenderScreen needs. When the flow succeeds, the tokens it returns go
// to POST /api/davinci-login/widget-session. Nothing here is hardcoded in the
// bundle.

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

// The flow's final node returns OIDC tokens to the page. The BFF verifies them
// (signatures, audience, nonce, same user) before it signs anyone in.
export async function postWidgetSession({ idToken, accessToken }) {
  const res = await fetch("/api/davinci-login/widget-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ idToken, accessToken }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Sign-in failed (HTTP ${res.status}).`);
  return body;
}

// 2026-09-13 tech debt: the widget's tokens carry no refresh token, so a
// widget session dies at the access token's expiry instead of refreshing.
// Cheap boolean check (no tokens returned) so the guide page can decide
// whether a silent re-run is worth attempting.
export async function fetchWidgetSessionStatus() {
  try {
    const res = await fetch("/api/davinci-login/session-status", { headers: { Accept: "application/json" } });
    if (!res.ok) return { davinciWidgetLogin: false, needsRefresh: false };
    return await res.json();
  } catch (_err) {
    return { davinciWidgetLogin: false, needsRefresh: false };
  }
}

// Silently re-runs the SAME widget flow execution the initial sign-in used —
// mint a fresh SDK token, run davinci.skRenderScreen, post the result to
// /widget-session — in a detached container the user never sees. If PingOne
// still recognizes the session the first run created, the flow's Sign On
// screen completes without asking for anything; if it can't, this just fails
// non-fatally and the session expires as it does today (same convention as
// middleware/tokenRefresh.js's refreshIfExpiring on the BFF side).
export async function refreshWidgetSessionIfNeeded() {
  const status = await fetchWidgetSessionStatus();
  if (!status?.needsRefresh) return false;

  try {
    const cfg = await fetchWidgetConfig();
    const davinci = await loadWidget();

    const container = document.createElement("div");
    container.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;left:-9999px;";
    document.body.appendChild(container);
    const cleanup = () => container.remove();

    return await new Promise((resolve) => {
      davinci.skRenderScreen(container, {
        config: {
          method: "runFlow",
          apiRoot: cfg.apiRoot,
          accessToken: cfg.accessToken,
          companyId: cfg.companyId,
          policyId: cfg.policyId,
          includeHttpCredentials: true,
        },
        useModal: false,
        successCallback: async (response) => {
          try {
            await postWidgetSession({ idToken: response?.id_token, accessToken: response?.access_token });
            resolve(true);
          } catch (_err) {
            resolve(false);
          } finally {
            cleanup();
          }
        },
        errorCallback: () => {
          cleanup();
          resolve(false);
        },
      });
    });
  } catch (_err) {
    return false;
  }
}
