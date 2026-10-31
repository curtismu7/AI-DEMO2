// GatewayStatsPage.jsx — HAProxy's live stats for the MCP gateway load balancer on its own page.
// The same panel the topology page carries at the bottom, given a direct URL (/gateway-stats) and
// a Mission Control link. Served through /api/admin/lb/runtime/stats-view, so the demo's PingOne
// sign-in is the gate and the stats password never reaches the browser.
//
// The page asks the proxy first, so it can say what is wrong instead of showing a blank frame:
// 401 = not signed in, 503 = the server has no stats connection configured.
import { useCallback, useEffect, useState } from "react";
import "./GatewayStatsPage.css";

const STATS_URL = "/api/admin/lb/runtime/stats-view";

export default function GatewayStatsPage() {
  const [state, setState] = useState("checking"); // checking | ok | signin | unconfigured | error
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState("checking");
    fetch(STATS_URL, { credentials: "same-origin" })
      .then((res) => {
        if (!live) return;
        if (res.ok) setState("ok");
        else if (res.status === 401) setState("signin");
        else if (res.status === 503) setState("unconfigured");
        else setState("error");
      })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <main className="gws-page">
      <h1>Gateway stats</h1>
      <p className="gws-page__hint">
        HAProxy&apos;s built-in stats for <code>mcpgw-lb</code>: node health, sessions and traffic per
        gateway, refreshed every 5s. Shown to any signed-in demo user; there is no separate stats password.
      </p>
      {state === "ok" && (
        <iframe title="HAProxy LB stats" src={STATS_URL} className="gws-page__frame" />
      )}
      {state === "checking" && <p className="gws-page__note" role="status">Checking your sign-in…</p>}
      {state === "signin" && (
        <div className="gws-page__note" role="status">
          <strong>Sign in to see the stats.</strong>
          <p>
            This page shows live gateway data only to a signed-in demo user. Use <b>Sign In</b> at the top
            right of the page, then come back here and press <b>Check again</b>.
          </p>
          <button type="button" className="primary" onClick={recheck}>Check again</button>
        </div>
      )}
      {state === "unconfigured" && (
        <div className="gws-page__note" role="status">
          <strong>The server has no stats connection set up.</strong>
          <p>
            Set <code>MCPGW_LB_STATS_URL</code> and <code>MCPGW_LB_STATS_AUTH</code> in the API server&apos;s
            environment, restart it, and press <b>Check again</b>.
          </p>
          <button type="button" onClick={recheck}>Check again</button>
        </div>
      )}
      {state === "error" && (
        <div className="gws-page__note" role="status">
          <strong>The stats could not be loaded.</strong>
          <p>The API server did not answer as expected. Try again in a moment.</p>
          <button type="button" onClick={recheck}>Check again</button>
        </div>
      )}
    </main>
  );
}
