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
import FormJsonToggle, { PayloadFormView } from "../components/shared/FormJsonToggle";
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
    hopSeq: hop.seq,
    lane: laneForPhase[hop.phase] || "GATEWAY",
    title: hop.phase === "gateway.authorize" && hop.decision
      ? `PingOne Authorize — ${hop.decision.outcome === "deny" ? "DENY" : "PERMIT"}`
      : hop.op || hop.phase,
    status: hop.status === "error" ? "error" : "done",
  }));
}

function TraceSection({ title, explanation, children, className = "" }) {
  return (
    <section className={`ttrace-facade-section ${className}`.trim()}>
      <header className="ttrace-facade-section__header">
        <h2>{title}</h2>
        <p>{explanation}</p>
      </header>
      {children}
    </section>
  );
}

function HopFilmstrip({ hops, selectedSeq, onSelect }) {
  return (
    <section className="ttrace-filmstrip" aria-label="Recorded façade hops">
      <header className="ttrace-filmstrip__header">
        <div>
          <h2>Movie reel</h2>
          <p>Each frame is a recorded façade hop. Select a frame to inspect its recorded identity, decision, and payload.</p>
        </div>
        <span className="ttrace-filmstrip__count">{hops.length} frames</span>
      </header>
      <div className="ttrace-filmstrip__track">
        {hops.map((hop) => (
          <button
            type="button"
            key={hop.seq}
            className={`ttrace-film-frame${hop.seq === selectedSeq ? " is-selected" : ""}`}
            onClick={() => onSelect(hop.seq)}
            aria-pressed={hop.seq === selectedSeq}
          >
            <span className="ttrace-film-frame__number">Frame {hop.seq}</span>
            <strong>{hop.service || "Façade"}</strong>
            <span className="ttrace-film-frame__phase">{hop.phase || "recorded hop"}</span>
            <span className="ttrace-film-frame__operation">{hop.op || "No operation recorded"}</span>
            <span className="ttrace-film-frame__meta">
              {Number.isFinite(hop.durationMs) ? `${hop.durationMs}ms` : "Recorded"}
              {hop.decision?.outcome ? ` · ${hop.decision.outcome.toUpperCase()}` : ""}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SelectedHopDetail({ hop }) {
  if (!hop) return null;
  const recorded = hop.details && typeof hop.details === "object"
    ? hop.details
    : { recorded: hop.details ?? "No additional payload was recorded for this hop." };
  const overview = {
    service: hop.service || null,
    phase: hop.phase || null,
    operation: hop.op || null,
    status: hop.status || null,
    durationMs: Number.isFinite(hop.durationMs) ? hop.durationMs : null,
    identity: hop.identity || null,
    decision: hop.decision || null,
    filterChain: hop.filterChain || null,
  };

  return (
    <TraceSection
      title={`Step ${hop.seq}: ${hop.op || hop.phase || "Recorded hop"}`}
      explanation="This is the exact evidence captured for the selected step. The form view is optimized for scanning; JSON preserves the full recorded object."
      className="ttrace-step-detail"
    >
      <div className="ttrace-step-detail__overview">
        <PayloadFormView value={overview} />
      </div>
      <div className="ttrace-step-detail__payload">
        <h3>Recorded payload</h3>
        <FormJsonToggle value={recorded} ariaLabel={`Step ${hop.seq} payload view`} defaultView="form" />
      </div>
    </TraceSection>
  );
}

export default function TransactionTraceEmbedPage() {
  const { correlationId } = useParams();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("waiting"); // waiting | ok | disabled | error
  const [fontSize, setFontSize] = useState(readFontSize);
  const [selectedHopSeq, setSelectedHopSeq] = useState(null);
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
  const selectedHop = hops.find((hop) => hop.seq === selectedHopSeq) || null;
  const resourcePayload = resources || {
    availability: advertisesResources ? "Supported, but not listed during this recorded session." : "Not advertised by this MCP server.",
    explanation: advertisesResources
      ? "The server supports resources, but the client did not call resources/list during this session."
      : "The server did not advertise the MCP resources capability for this session.",
  };
  const responsePayload = tool ? (tool.details?.error || tool.details?.result || tool.details || {}) : {
    status: "Pending — the tool response has not been recorded yet.",
  };

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
        <HopFilmstrip hops={hops} selectedSeq={selectedHopSeq} onSelect={setSelectedHopSeq} />
      ) : null}

      {hops.length && view === "sequence" ? (
        <section className="ttrace-sequence" data-testid="facade-sequence">
          <SequenceReelDiagram
            externalSteps={sequenceSteps}
            externalRunId={correlationId}
            externalTraceFinished={status === "ok"}
            slowMode
            selectedStepId={selectedHop ? `facade-hop-${selectedHop.seq}` : undefined}
            onSelectStep={(step) => setSelectedHopSeq(step.hopSeq ?? null)}
            zoomStorageKey="ttrace_embed_sequence_zoom"
            initialZoom={100}
            ariaLabel="Sequence diagram of this facade trace"
          />
        </section>
      ) : null}

      <SelectedHopDetail hop={selectedHop} />

      {request ? (
        <section className="ttrace-detail" data-testid="embed-mcp">
          <TraceSection
            title={`Tools${tools ? ` (${tools.length})` : ""}`}
            explanation="Functions the MCP server exposed when the façade observed this request. These are the operations available to the selected agent."
          >
            {tools ? (
              <ul className="ttrace-tools-list">
                {tools.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    {t.description ? ` — ${t.description}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ttrace-empty-copy">Tool discovery was not recorded in this session.</p>
            )}
          </TraceSection>
          <TraceSection
            title={`Resources${resources ? ` (${resources.length})` : ""}`}
            explanation="MCP resources are server-provided reference records. Form is the readable inventory; JSON keeps the server’s exact resource list."
          >
            <FormJsonToggle value={resourcePayload} ariaLabel="Resources view" defaultView="form" />
          </TraceSection>
          <TraceSection
            title="Request"
            explanation="What the client asked the façade to send: the selected tool, its arguments, and the route chosen for this call."
          >
            <FormJsonToggle value={requestDetails} ariaLabel="Request view" defaultView="form" />
          </TraceSection>
          <TraceSection
            title={tool ? `Response · HTTP ${tool.details?.httpStatus ?? "—"} · ${tool.durationMs ?? "—"}ms` : "Response · pending"}
            explanation="What returned from the tool path. Form makes the result easy to scan; JSON preserves the complete unedited response."
          >
            <FormJsonToggle value={responsePayload} ariaLabel="Response view" defaultView="form" />
          </TraceSection>
        </section>
      ) : null}
    </div>
  );
}
