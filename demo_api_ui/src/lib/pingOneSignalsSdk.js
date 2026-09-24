const SCRIPT_URL = "https://apps.pingone.com/signals/web-sdk/latest/signals-sdk.js";
const TIMEOUT_MS = 10000;

function timeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`PingOne Signals ${label} timed out`)), TIMEOUT_MS);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

async function loadSdk() {
  if (window._pingOneSignals) return;
  let script = document.querySelector('script[data-pingone-signals="protect-auth"]');
  if (!script) {
    script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.pingoneSignals = "protect-auth";
    const loaded = new Promise((resolve, reject) => {
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("PingOne Signals SDK failed to load")), { once: true });
    });
    document.head.appendChild(script);
    await timeout(loaded, "SDK load");
    return;
  }
  if (!window._pingOneSignals) {
    await timeout(new Promise((resolve, reject) => {
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error("PingOne Signals SDK failed to load")), { once: true });
    }), "SDK load");
  }
}

function waitForReady() {
  if (window._pingOneSignalsReady || window._pingOneSignals) return Promise.resolve();
  return timeout(new Promise((resolve) => {
    document.addEventListener("PingOneSignalsReadyEvent", resolve, { once: true });
    if (window._pingOneSignalsReady || window._pingOneSignals) resolve();
  }), "SDK readiness");
}

export async function collectPingOneSignals() {
  await loadSdk();
  await waitForReady();
  const sdk = window._pingOneSignals;
  if (!sdk?.init || !sdk?.getData) throw new Error("PingOne Signals SDK is unavailable");
  if (!window.__protectAuthSignalsInit) {
    const initPromise = timeout(sdk.init({ isIAFDetectionEnabled: true }), "initialization");
    window.__protectAuthSignalsInit = initPromise;
    initPromise.catch(() => {
      if (window.__protectAuthSignalsInit === initPromise) delete window.__protectAuthSignalsInit;
    });
  }
  await window.__protectAuthSignalsInit;
  const result = await timeout(sdk.getData(), "data collection");
  if (typeof result === "string" && result) return result;
  if (result && typeof result === "object" && !result.error) return JSON.stringify(result);
  throw new Error(result?.error || "PingOne Signals did not return data");
}
