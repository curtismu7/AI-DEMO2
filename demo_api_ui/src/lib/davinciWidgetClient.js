import { davinci } from "@forgerock/davinci-client";

// Widget-invoked DaVinci login demo (/davinci-login). Config comes from the
// BFF's public GET /api/davinci-demo/config, same pattern as oidcSdkClient.js's
// GET /api/sdk-demo/config — nothing hardcoded in the bundle.

let clientPromise = null;

async function build() {
  const res = await fetch("/api/davinci-demo/config", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Could not load DaVinci demo config (HTTP ${res.status})`);
  }
  const cfg = await res.json();
  if (!cfg.clientId || !cfg.wellknown) {
    throw new Error(
      "DaVinci demo is not configured. Set the PINGONE_DAVINCI_LOGIN_* env vars " +
        "(see docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md) and restart the server."
    );
  }

  const client = davinci({
    config: {
      clientId: cfg.clientId,
      redirectUri: cfg.redirectUri,
      serverConfig: { wellknown: cfg.wellknown },
    },
  });
  return client;
}

export function getDavinciClient() {
  if (!clientPromise) {
    clientPromise = build().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export function isSdkError(result) {
  return !result || (typeof result === "object" && Boolean(result.error));
}
