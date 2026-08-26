/**
 * GatewayMcpMetrics — PingGateway's own MCP counters.
 *
 * These numbers come from the gateway's admin connector, not from demo code:
 * PingGateway counts every MCP method it validated and every JSON-RPC error it
 * returned. Rendered on the tracing page because it is the same question at a
 * different resolution — traces show one request, these show all of them.
 *
 * Renders nothing when the gateway is absent: a demo stack without PingGateway
 * is a normal configuration, not a fault worth an empty panel.
 */

import { useCallback, useEffect, useState } from "react";

const REFRESH_MS = 15000;

/** Seconds → a short human duration; null stays a dash. */
function fmtDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(2)} s`;
}

export default function GatewayMcpMetrics() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health/gateway-metrics", { credentials: "include" });
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* leave the last good reading on screen rather than blanking the panel */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!data?.available) return null;

  const { methods = [], errors = [] } = data;
  if (methods.length === 0 && errors.length === 0) return null;

  return (
    <details className="gw-metrics">
      <summary>
        PingGateway MCP counters
        <span className="gw-metrics-hint">
          {methods.reduce((n, m) => n + m.count, 0)} calls · {errors.reduce((n, e) => n + e.count, 0)} errors
        </span>
      </summary>

      <p className="gw-metrics-note">
        Measured by the gateway itself on its admin connector — not by this application.
      </p>

      {methods.length > 0 && (
        <table className="gw-metrics-table">
          <caption>Methods validated</caption>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Tool</th>
              <th scope="col">Calls</th>
              <th scope="col">Mean</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={`${m.route}|${m.method}|${m.tool || ""}`}>
                <td>{m.method}</td>
                <td>{m.tool || "—"}</td>
                <td>{m.count}</td>
                <td>{fmtDuration(m.meanSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {errors.length > 0 && (
        <table className="gw-metrics-table">
          <caption>Requests the gateway rejected</caption>
          <thead>
            <tr>
              <th scope="col">JSON-RPC code</th>
              <th scope="col">Method</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((e) => (
              <tr key={`${e.route}|${e.code}|${e.method || ""}`}>
                <td>{e.code}</td>
                <td>{e.method || "—"}</td>
                <td>{e.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="gw-metrics-note">
        A floor, not a total: envelopes that fail JSON-RPC schema validation are rejected without
        being counted.
      </p>
    </details>
  );
}
