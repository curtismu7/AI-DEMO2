// demo_api_ui/src/pages/TransactionTraceEmbedPage.jsx
//
// Compact, chrome-free movie reel for ONE external-door tool call — the view a
// client's `reel_url` opens (docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md §4).
// Reuses the trace page's hop cards + CSS; adds the MCP side of the call the
// façade recorded: tools + descriptions, resources, request, response.
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import apiClient from "../services/apiClient";
import { useThemeOptional } from "../context/ThemeContext";
import SequenceReelDiagram from "../components/SequenceReelDiagram";
import { HopCard } from "./TransactionTracePage";
import "./TransactionTracePage.css";

const POLL_MS = 2000;
const MAX_POLLS = 90; // hops for one call land within seconds; stop after 3 min
const FONT_STORAGE_KEY = "ttrace_embed_font_size";
const VIEW_STORAGE_KEY = "ttrace_embed_view";
const FONT_SIZES = ["standard", "large", "xlarge"];

function readFontSize() {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    return FONT_SIZES.includes(stored) ? stored : "large";
  } catch {
    return "large";
  }
}

function findLastHop(hops, phase) {
  const list = (hops || []).filter((h) => h.phase === phase);
  return list.length ? list[list.length - 1] : null;
}

export function facadeHopsToSequenceSteps(hops) {
  const laneForPhase = {
    "ui.request": "CHAT",
    "mcp.step": "MCP",
    "token.exchange": "BFF",
    "gateway.authorize": "AUTHZ",
    "mcp.tool": "MCP",
    response: "CHAT",
  };
  return (hops || []).map((hop) => ({
    id: `facade-hop-${hop.seq}`,
    lane: laneForPhase[hop.phase] || "GATEWAY",
    title: hop.phase === "gateway.authorize" && hop.decision
      ? `PingOne Authorize — ${hop.decision.outcome === "deny" ? "DENY" : "PERMIT"}`
      : hop.op || hop.phase,
    status: hop.status === "error" ? "error" : "done",
  }));
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
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("waiting"); // waiting | ok | disabled | error
  const [fontSize, setFontSize] = useState(readFontSize);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === "sequence" ? "sequence" : "reel";
    } catch {
      return "reel";
    }
  });

  const chooseFontSize = (nextSize) => {
    setFontSize(nextSize);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, nextSize);
    } catch {
      // Storage can be unavailable; the in-memory choice still applies.
    }
  };

  const chooseView = (nextView) => {
    setView(nextView);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    } catch {
      // Storage can be unavailable; the in-memory choice still applies.
    }
  };

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer = null;
    const load = async () => {
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
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
      if (!cancelled && ++polls < MAX_POLLS) timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [correlationId]);

  const hops = detail?.hops || [];
  const request = findLastHop(hops, "ui.request");
  const tool = findLastHop(hops, "mcp.tool");
  const meta = request?.details || {};
  const tools = Array.isArray(meta.tools) ? meta.tools : null;
  const resources = Array.isArray(meta.resources) ? meta.resources : null;
  const advertisesResources = Boolean(meta.capabilities && meta.capabilities.resources);
  const requestDetails = {
    tool: request?.op?.replace(/^tools\/call\s+/, "") || null,
    arguments: meta.arguments ?? {},
    route: {
      door: meta.doorLabel || meta.door || null,
      upstream: meta.upstream || null,
    },
    client: meta.client || null,
  };
  const sequenceSteps = facadeHopsToSequenceSteps(hops);

  return (
    <div className={`ttrace-page ttrace-embed ttrace-page--font-${fontSize}`} data-testid="ttrace-embed">
      <header className="ttrace-header">
        <div className="ttrace-header-top">
          <h1>Live trace</h1>
          <div className="ttrace-view-controls" aria-label="Trace display controls">
            <div className="ttrace-view-mode" role="group" aria-label="Trace view">
              <button type="button" aria-pressed={view === "reel"} onClick={() => chooseView("reel")}>Movie reel</button>
              <button type="button" aria-pressed={view === "sequence"} onClick={() => chooseView("sequence")}>Sequence</button>
            </div>
            <div className="ttrace-font-controls" role="group" aria-label="Font size">
              <button type="button" aria-label="Standard font size" aria-pressed={fontSize === "standard"} onClick={() => chooseFontSize("standard")}>A−</button>
              <button type="button" aria-label="Large font size" aria-pressed={fontSize === "large"} onClick={() => chooseFontSize("large")}>A</button>
              <button type="button" aria-label="Extra large font size" aria-pressed={fontSize === "xlarge"} onClick={() => chooseFontSize("xlarge")}>A+</button>
            </div>
            <button
              type="button"
              className="ttrace-theme-toggle"
              onClick={toggleDarkMode}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
            </button>
          </div>
        </div>
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

      {hops.length && view === "reel" ? (
        <ul className="ttrace-hops">
          {hops.map((hop) => (
            <HopCard key={hop.seq} hop={hop} violations={[]} severed={false} />
          ))}
        </ul>
      ) : null}

      {hops.length && view === "sequence" ? (
        <section className="ttrace-sequence" data-testid="facade-sequence">
          <SequenceReelDiagram
            externalSteps={sequenceSteps}
            externalRunId={correlationId}
            externalTraceFinished={status === "ok"}
            zoomStorageKey="ttrace_embed_sequence_zoom"
            initialZoom={100}
            ariaLabel="Sequence diagram of this facade trace"
          />
        </section>
      ) : null}

      {request ? (
        <section className="ttrace-detail" data-testid="embed-mcp">
          <details>
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
            ) : (
              <p>
                {advertisesResources
                  ? "The server supports resources, but this client did not call resources/list during the recorded session."
                  : "This MCP server did not advertise the resources capability. Its tools are shown above."}
              </p>
            )}
          </details>
          <details open>
            <summary><strong>Request</strong> {request.op}</summary>
            <Json value={requestDetails} />
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
