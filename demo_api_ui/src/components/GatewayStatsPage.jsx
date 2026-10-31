// GatewayStatsPage.jsx — HAProxy's live stats for the MCP gateway load balancer on its own page.
// The same panel the topology page carries at the bottom, given a direct URL (/gateway-stats) and
// a Mission Control link. Served through /api/admin/lb/runtime/stats-view, so the demo's PingOne
// sign-in is the gate and the stats password never reaches the browser.
import "./GatewayStatsPage.css";

export default function GatewayStatsPage() {
  return (
    <main className="gws-page">
      <h1>Gateway stats</h1>
      <p className="gws-page__hint">
        HAProxy&apos;s built-in stats for <code>mcpgw-lb</code>: node health, sessions and traffic per
        gateway, refreshed every 5s. Sign in to the demo (PingOne) and the stats appear below; there is
        no separate stats password. If the frame stays blank, you are not signed in.
      </p>
      <iframe
        title="HAProxy LB stats"
        src="/api/admin/lb/runtime/stats-view"
        className="gws-page__frame"
      />
    </main>
  );
}
