import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useExchangeMode } from "../context/ExchangeModeContext";
import TokenExchangeFlowDiagram from "./TokenExchangeFlowDiagram";
import InteractiveArchDiagram from "./education/InteractiveArchDiagram";
import NarrativePanel from "./NarrativePanel";
import CibaStepUpFlowPanel from "./CibaStepUpFlowPanel";
import DiagramExportBar from "./DiagramExportBar";
import bffAxios from "../services/bffAxios";
import FlowchartFlowDiagram from "./FlowchartFlowDiagram";
import EmbeddedFlowDiagram from "./EmbeddedFlowDiagram";
import { CIBA_LINK_DIAGRAM } from "../config/cibaApprovalLinkDiagram";
import { buildFocusDiagram, FOCUS_GROUPS } from "../utils/architectureFocus";
import "./ArchitectureTabsPanel.css";
import InlineSpinner from './shared/InlineSpinner';

/**
 * ArchitectureTabsPanel — Multi-tab architecture display component
 *
 * Provides two tabs:
 * 1. System Architecture — High-level system diagram (placeholder initially)
 * 2. Token Exchange Flow — Live RFC 8693 flow diagram with real-time mode syncing
 *
 * Real-time updates: When exchange mode toggles (1-exchange ↔ 2-exchange),
 * the TokenExchangeFlowDiagram rerenders automatically via ExchangeModeContext.
 *
 * @returns {React.ReactElement}
 */
/**
 * DiagramRegeneratePanel — admin-only toolbar above the tabs.
 *
 * Lists every diagram with its mtime/size + a stale-vs-fresh badge, lets
 * the admin trigger a regen for a specific diagram or all of them at once,
 * and streams the build script's live output via Server-Sent Events.
 *
 * Backend: routes/diagrams.js  (POST /regenerate, GET /list, GET /status)
 *
 * Hidden gracefully for non-admin users — /list 403s for them and we just
 * render nothing rather than show a button they can't use.
 */
function DiagramRegeneratePanel({ user }) {
  const [items, setItems] = useState([]);
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [collapsed, setCollapsed] = useState(true);
  const [lastResult, setLastResult] = useState(null);
  const abortRef = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const res = await bffAxios.get("/api/admin/diagrams/list");
      setItems(res.data?.diagrams || []);
    } catch (err) {
      // 401/403 → user isn't admin; hide the panel entirely instead of
      // shouting at them. Any other failure: keep the panel visible so
      // the admin sees the error and can debug.
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setHidden(true);
      }
    }
  }, []);

  useEffect(() => {
    // Only admins can use the regen tooling, and the /diagrams/list route is
    // admin-gated. Pre-emptively hide the panel for anon visitors and non-admin
    // users so we never issue a request that would 401/403. This keeps the
    // Architecture menu group genuinely public — no DevTools-Console noise
    // when an unauthenticated visitor opens /architecture/system.
    if (user?.role !== "admin") {
      setHidden(true);
      return;
    }
    loadList();
  }, [loadList, user]);

  // SSE consumer for the regen stream. fetch + ReadableStream gives us
  // POST-with-body support (the standard EventSource API is GET-only).
  // Lines come in as `data: {...}\n\n` per the routes/diagrams.js sender.
  const regenerate = useCallback(
    async (name) => {
      if (running) return;
      setRunning(true);
      setCollapsed(false);
      setLogLines([
        {
          stream: "meta",
          text: `Starting ${name === "all" ? "full regeneration" : `regeneration of '${name}'`}…`,
        },
      ]);
      setLastResult(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/admin/diagrams/regenerate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(name === "all" ? {} : { name }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => "");
          setLogLines((prev) => [
            ...prev,
            {
              stream: "stderr",
              text: `HTTP ${res.status}: ${txt || res.statusText}`,
            },
          ]);
          setRunning(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Stream the SSE response chunk-by-chunk. We re-buffer because chunks
        // may split a single `data: {...}\n\n` event across reads.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              try {
                const evt = JSON.parse(payload);
                handleStreamEvent(evt);
              } catch (_e) {
                /* ignore malformed */
              }
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setLogLines((prev) => [
            ...prev,
            { stream: "stderr", text: `Stream error: ${err.message}` },
          ]);
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
        // Refresh list so mtimes/stale badges reflect what was just rendered.
        loadList();
      }

      function handleStreamEvent(evt) {
        if (evt.phase === "start") {
          setLogLines((prev) => [
            ...prev,
            {
              stream: "meta",
              text: `Spawned ${evt.script} (target: ${evt.name})`,
            },
          ]);
        } else if (evt.phase === "line") {
          setLogLines((prev) => [
            ...prev,
            { stream: evt.stream || "stdout", text: evt.text || "" },
          ]);
        } else if (evt.phase === "end") {
          const sec = ((evt.durationMs || 0) / 1000).toFixed(1);
          const ok = evt.exitCode === 0;
          setLogLines((prev) => [
            ...prev,
            {
              stream: ok ? "meta-ok" : "stderr",
              text: ok
                ? `Finished in ${sec}s (exit 0)`
                : `Failed in ${sec}s (exit ${evt.exitCode}${evt.signal ? `, signal ${evt.signal}` : ""})`,
            },
          ]);
          setLastResult({ ok, durationSec: sec });
        }
      }
    },
    [running, loadList],
  );

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  if (hidden) return null;

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        background: "#f8fafc",
        padding: "0.75rem 1rem",
        marginBottom: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "0.95rem" }}>
          Architecture diagrams
        </div>
        <button
          type="button"
          onClick={() => regenerate("all")}
          disabled={running}
          style={primaryBtnStyle(running)}
        >
          {running ? "Regenerating…" : "Regenerate all"}
        </button>
        {running && (
          <button type="button" onClick={cancel} style={secondaryBtnStyle()}>
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          style={{ ...secondaryBtnStyle(), marginLeft: "auto" }}
        >
          {collapsed ? "Show details" : "Hide details"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            style={{
              marginTop: "0.75rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {items.map((item) => (
              <div
                key={item.name}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 4,
                  padding: "0.5rem 0.6rem",
                  background: "#ffffff",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    marginBottom: "0.25rem",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: "#0f172a",
                      fontSize: "0.85rem",
                    }}
                  >
                    {item.name}
                  </span>
                  {item.stale && (
                    <span style={badgeStyle("#fef9c3", "#854d0e")}>stale</span>
                  )}
                  {!item.pngExists && (
                    <span style={badgeStyle("#fee2e2", "#991b1b")}>
                      missing
                    </span>
                  )}
                  {item.pngExists && !item.stale && (
                    <span style={badgeStyle("#dcfce7", "#166534")}>fresh</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#64748b",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    marginBottom: "0.25rem",
                  }}
                >
                  {item.source} → {item.png}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#64748b",
                    marginBottom: "0.4rem",
                  }}
                >
                  {item.pngExists
                    ? `${(item.pngSizeBytes / 1024).toFixed(0)} KB · rendered ${new Date(item.pngMtime).toLocaleString()}`
                    : "PNG not yet rendered"}
                </div>
                <button
                  type="button"
                  onClick={() => regenerate(item.name)}
                  disabled={running || !item.sourceExists}
                  style={secondaryBtnStyle(running || !item.sourceExists)}
                >
                  Regenerate this one
                </button>
              </div>
            ))}
          </div>

          {logLines.length > 0 && (
            <div
              style={{
                marginTop: "0.75rem",
                background: "#0f172a",
                color: "#e2e8f0",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: "0.72rem",
                padding: "0.6rem 0.75rem",
                borderRadius: 4,
                maxHeight: 240,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {logLines.map((l, i) => (
                <div
                  key={i}
                  style={{
                    color:
                      l.stream === "stderr"
                        ? "#fca5a5"
                        : l.stream === "meta"
                          ? "#94a3b8"
                          : l.stream === "meta-ok"
                            ? "#86efac"
                            : "#e2e8f0",
                  }}
                >
                  {l.text}
                </div>
              ))}
            </div>
          )}

          {lastResult && !running && (
            <div
              style={{
                marginTop: "0.5rem",
                fontSize: "0.8rem",
                color: lastResult.ok ? "#166534" : "#991b1b",
              }}
            >
              {lastResult.ok
                ? `Done in ${lastResult.durationSec}s. Refresh the page (or Cmd-Shift-R) to see the updated images.`
                : `Regeneration failed after ${lastResult.durationSec}s. See log above.`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function primaryBtnStyle(disabled) {
  return {
    background: disabled ? "#94a3b8" : "#1d4ed8",
    color: "#ffffff",
    border: "none",
    borderRadius: 4,
    padding: "0.4rem 0.85rem",
    fontWeight: 600,
    fontSize: "0.85rem",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function secondaryBtnStyle(disabled) {
  return {
    background: disabled ? "#f1f5f9" : "#ffffff",
    color: disabled ? "#94a3b8" : "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: 4,
    padding: "0.35rem 0.7rem",
    fontWeight: 600,
    fontSize: "0.8rem",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
function badgeStyle(bg, fg) {
  return {
    background: bg,
    color: fg,
    fontSize: "0.65rem",
    fontWeight: 700,
    padding: "0.1rem 0.4rem",
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };
}

/**
 * SystemArchitectureView — the authoritative System Architecture tab body.
 *
 * Defaults to the full architecture.mmd (every run-bank.sh SVC_LIST service
 * plus langchain) drawn with React Flow; the PNG/SVG renders stay as downloads.
 * The legacy InteractiveArchDiagram is intentionally PARTIAL
 * (5 of 14 nodes) and was retained only for its live TokenChainContext
 * highlighting (Phase 270 decision) — it's still reachable behind the toggle
 * but is no longer the default, so the page is accurate out of the box.
 */
const FOCUS_OPTIONS = [
  { key: "full", label: "Full topology" },
  ...Object.entries(FOCUS_GROUPS).map(([key, group]) => ({
    key,
    label: group.label,
  })),
];

/**
 * FocusedArchitectureDiagram — renders one subsystem slice of
 * architecture.mmd, derived client-side (see utils/architectureFocus.js) so
 * there is no second copy of the topology to drift stale. Drawn with React
 * Flow, so it pans, zooms and steps through its arrows.
 */
function FocusedArchitectureDiagram({ mmdSource, mmdError, focusKey }) {
  const filteredSource = useMemo(
    () => (!mmdSource ? "" : focusKey === "full" ? mmdSource : buildFocusDiagram(mmdSource, focusKey)),
    [mmdSource, focusKey],
  );
  if (mmdError) {
    return (
      <p style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
        Couldn't load architecture.mmd to build this focus.
      </p>
    );
  }
  if (!mmdSource) {
    return (
      <p style={{ fontSize: "0.85rem", color: "#334155" }}>
        <InlineSpinner label="Loading architecture.mmd…" />
      </p>
    );
  }
  return <FlowchartFlowDiagram source={filteredSource} height={720} testId="arch-focus-diagram" label="System architecture focus" />;
}

function SystemArchitectureView() {
  const [view, setView] = useState("full");
  const [focus, setFocus] = useState("full");
  const [mmdSource, setMmdSource] = useState(null);
  const [mmdError, setMmdError] = useState(false);

  useEffect(() => {
    if (mmdSource !== null || mmdError) return;
    let cancelled = false;
    fetch("/architecture/architecture.mmd")
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setMmdSource(text);
      })
      .catch(() => {
        if (!cancelled) setMmdError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mmdSource, mmdError]);

  return (
    <div className="iad-root">
      <div
        role="tablist"
        aria-label="Architecture view"
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "full"}
          onClick={() => setView("full")}
          style={secondaryBtnStyle(false)}
        >
          Full diagram
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "live"}
          onClick={() => setView("live")}
          style={secondaryBtnStyle(false)}
        >
          Live token highlights (simplified)
        </button>
      </div>

      {view === "full" ? (
        <>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#334155",
              margin: "0 0 0.5rem 0",
              lineHeight: 1.5,
            }}
          >
            Full system: browser → BFF → MCP gateway → backend MCP servers, with
            PingOne OAuth + RFC 8693 token exchange. Rendered from{" "}
            <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              architecture.mmd
            </code>
            . This diagram is dense — drag, pan and zoom it (or open the{" "}
            <a
              href="/architecture/overview"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--th-text)", textDecoration: "underline" }}
            >
              standalone zoomable view
            </a>
            ).
          </p>
          <div
            role="tablist"
            aria-label="Architecture focus"
            style={{
              display: "flex",
              gap: "0.4rem",
              marginBottom: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            {FOCUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={focus === opt.key}
                onClick={() => setFocus(opt.key)}
                style={secondaryBtnStyle(false)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {focus !== "full" ? (
            <p
              style={{
                fontSize: "0.8rem",
                color: "#334155",
                margin: "0 0 0.5rem 0",
              }}
            >
              Showing only the {FOCUS_GROUPS[focus].label} slice of{" "}
              <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                architecture.mmd
              </code>{" "}
              — switch to Full topology for everything.
            </p>
          ) : (
            <DiagramExportBar
              items={[
                {
                  label: "Mermaid (.mmd)",
                  href: "/architecture/architecture.mmd",
                },
                { label: "PNG", href: "/architecture/overview2.png" },
                { label: "SVG", href: "/architecture/overview2.svg" },
                {
                  label: "draw.io / Lucid (.drawio)",
                  href: "/architecture/architecture.drawio",
                },
              ]}
            />
          )}
          <FocusedArchitectureDiagram
            mmdSource={mmdSource}
            mmdError={mmdError}
            focusKey={focus}
          />
        </>
      ) : (
        <InteractiveArchDiagram />
      )}
    </div>
  );
}

const ArchitectureTabsPanel = ({ user } = {}) => {
  const [activeTab, setActiveTab] = useState("architecture");
  const { mode } = useExchangeMode();

  return (
    <div className="architecture-tabs-panel">
      {/* Regenerate-diagrams toolbar — admin only; sits above the tabs so
          it's visible from every sub-view and the user doesn't have to
          remember a hidden URL or shell command. */}
      <DiagramRegeneratePanel user={user} />

      {/* Tab header row */}
      <div role="tablist" className="architecture-tabs-header">
        <button
          role="tab"
          aria-selected={activeTab === "architecture"}
          aria-controls="arch-content"
          onClick={() => setActiveTab("architecture")}
          className="architecture-tab-button"
        >
          System Architecture
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "token-flow"}
          aria-controls="flow-content"
          onClick={() => setActiveTab("token-flow")}
          className="architecture-tab-button"
        >
          Token Exchange Flow
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "narrative"}
          aria-controls="narrative-content"
          onClick={() => setActiveTab("narrative")}
          className="architecture-tab-button"
        >
          What's Happening
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "ciba-stepup"}
          aria-controls="ciba-stepup-content"
          onClick={() => setActiveTab("ciba-stepup")}
          className="architecture-tab-button"
        >
          CIBA Step-Up
        </button>
      </div>

      {/* Tab content panels */}
      <div
        role="tabpanel"
        id="arch-content"
        className="architecture-tab-content"
      >
        {activeTab === "architecture" && <SystemArchitectureView />}
      </div>

      <div
        role="tabpanel"
        id="flow-content"
        className="architecture-tab-content"
      >
        {activeTab === "token-flow" && (
          <div className="token-flow-display">
            <p className="token-flow-mode-indicator">
              <strong>Exchange Mode:</strong>{" "}
              {mode === "double"
                ? "2-Exchange (Agent Delegation)"
                : "1-Exchange (Subject Only)"}
            </p>
            <TokenExchangeFlowDiagram mode={mode} interactive />
          </div>
        )}
      </div>

      <div
        role="tabpanel"
        id="narrative-content"
        className="architecture-tab-content"
      >
        {activeTab === "narrative" && <NarrativePanel />}
      </div>

      <div
        role="tabpanel"
        id="ciba-stepup-content"
        className="architecture-tab-content"
      >
        {activeTab === "ciba-stepup" && (
          <>
            <CibaStepUpFlowPanel />
            <EmbeddedFlowDiagram
              config={CIBA_LINK_DIAGRAM}
              title="CIBA approval link"
              lede="The app asks PingOne (or PingFederate) to reach the signed-in user out of band, then polls until they approve. Orange edges are the PingFederate path. Click a step to follow it."
              testId="arch-ciba-link"
            />
          </>
        )}
      </div>
    </div>
  );
};

export default ArchitectureTabsPanel;
