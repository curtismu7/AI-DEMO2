// demo_api_ui/src/pages/TransactionTraceEmbedPage.jsx
//
// Compact, chrome-free movie reel for ONE external-door tool call — the view a
// client's `reel_url` opens (docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md §4).
// Reuses the trace page's hop cards + CSS; adds the MCP side of the call the
// façade recorded: tools + descriptions, resources, request, response.
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import apiClient from "../services/apiClient";
import { HopCard } from "./TransactionTracePage";
import "./TransactionTracePage.css";

const POLL_MS = 2000;
const MAX_POLLS = 90; // hops for one call land within seconds; stop after 3 min

function findHop(hops, phase) {
  return (hops || []).find((h) => h.phase === phase) || null;
}

function Json({ value }) {
  if (value === null || value === undefined) return <p>—</p>;
  return (
    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function TransactionTraceEmbedPage() {
  const { correlationId } = useParams();
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("waiting"); // waiting | ok | disabled | error

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer = null;
    const load = async () => {
      let done = false;
      try {
        const res = await apiClient.get(`/api/transaction-trace/embed/${encodeURIComponent(correlationId)}`, {
          _silent: true,
          validateStatus: (s) => s < 500,
        });
        if (res.status === 403) {
          if (!cancelled) setStatus("disabled");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setStatus("waiting");
        } else if (res.status !== 200) {
          throw new Error(`HTTP ${res.status}`);
        } else {
          const body = res.data || {};
          if (!cancelled) {
            setDetail(body);
            setStatus("ok");
          }
          done = (body.hops || []).some((h) => h.phase === "response");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
      if (!cancelled && !done && ++polls < MAX_POLLS) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [correlationId]);

  const hops = detail?.hops || [];
  const request = findHop(hops, "ui.request");
  const tool = findHop(hops, "mcp.tool");
  const meta = request?.details || {};
  const tools = Array.isArray(meta.tools) ? meta.tools : null;
  const resources = Array.isArray(meta.resources) ? meta.resources : null;
  const advertisesResources = Boolean(meta.capabilities && meta.capabilities.resources);

  return (
    <div className="ttrace-page" data-testid="ttrace-embed">
      <header className="ttrace-header">
        <h1>Live trace</h1>
        <p className="ttrace-sub">
          {meta.doorLabel ? `${meta.doorLabel} · ` : ""}
          {request?.op || "external MCP call"}
          {meta.client?.name ? ` · client: ${meta.client.name}` : ""}
          {meta.server?.name ? ` · server: ${meta.server.name}` : ""}
        </p>
      </header>

      {status === "disabled" ? (
        <div className="ttrace-notice">
          ⚠️ Transaction Chain of Custody is off. Enable <code>ff_transaction_ledger</code> to record.
        </div>
      ) : null}
      {status === "error" ? <div className="ttrace-notice">⚠️ Trace could not be loaded.</div> : null}
      {status === "waiting" ? (
        <div className="ttrace-notice" data-testid="embed-waiting">
          Waiting for the first hop of <code>{correlationId}</code>…
        </div>
      ) : null}

      {hops.length ? (
        <ul className="ttrace-hops">
          {hops.map((hop) => (
            <HopCard key={hop.seq} hop={hop} violations={[]} severed={false} />
          ))}
        </ul>
      ) : null}

      {request ? (
        <section className="ttrace-detail" data-testid="embed-mcp">
          <details open>
            <summary>
              <strong>Tools</strong> {tools ? `(${tools.length})` : "— not listed in this session"}
            </summary>
            {tools ? (
              <ul>
                {tools.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    {t.description ? ` — ${t.description}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
          <details>
            <summary>
              <strong>Resources</strong>{" "}
              {resources ? `(${resources.length})` : advertisesResources ? "— not listed in this session" : "— not advertised by this server"}
            </summary>
            {resources ? (
              <ul>
                {resources.map((r) => (
                  <li key={r.uri}>
                    <code>{r.uri}</code>
                    {r.name ? ` ${r.name}` : ""}
                    {r.description ? ` — ${r.description}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
          <details open>
            <summary><strong>Request</strong> {request.op}</summary>
            <Json value={meta.arguments} />
          </details>
          <details open>
            <summary>
              <strong>Response</strong>{" "}
              {tool ? `${tool.status === "ok" ? "✓" : "❌"} HTTP ${tool.details?.httpStatus ?? "—"} · ${tool.durationMs ?? "—"}ms` : "— pending"}
            </summary>
            <Json value={tool ? (tool.details?.error || tool.details?.result) : null} />
          </details>
        </section>
      ) : null}
    </div>
  );
}
