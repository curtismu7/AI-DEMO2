import React, { useState, useEffect, useRef, useCallback } from "react";
import { useExchangeMode } from "../context/ExchangeModeContext";
import TokenExchangeFlowDiagram from "./TokenExchangeFlowDiagram";
import InteractiveArchDiagram from "./education/InteractiveArchDiagram";
import NarrativePanel from "./NarrativePanel";
import CibaStepUpFlowPanel from "./CibaStepUpFlowPanel";
import bffAxios from "../services/bffAxios";
import "./ArchitectureTabsPanel.css";

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
 * Defaults to the full rendered diagram (overview2.png — the detailed render
 * of architecture.mmd, which covers every run-bank.sh SVC_LIST service plus
 * langchain). The legacy InteractiveArchDiagram is intentionally PARTIAL
 * (5 of 14 nodes) and was retained only for its live TokenChainContext
 * highlighting (Phase 270 decision) — it's still reachable behind the toggle
 * but is no longer the default, so the page is accurate out of the box.
 */
const ARCH_ZOOM_STEPS = [75, 100, 150, 200, 300];

function SystemArchitectureView() {
  const [view, setView] = useState("full");
  // overview2.png is dense — unreadable at fit-to-width on a laptop. Default
  // to 150% (legible on a typical laptop) inside a scroll/pan container so
  // it still works on a large monitor without forcing large-monitor-only.
  const [zoom, setZoom] = useState(150);

  const zoomOut = () =>
    setZoom((z) => {
      const idx = ARCH_ZOOM_STEPS.findIndex((s) => s >= z);
      return idx > 0 ? ARCH_ZOOM_STEPS[idx - 1] : z;
    });
  const zoomIn = () =>
    setZoom((z) => {
      const idx = ARCH_ZOOM_STEPS.findIndex((s) => s > z);
      return idx >= 0 ? ARCH_ZOOM_STEPS[idx] : z;
    });

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
            . This diagram is dense — use the zoom controls (or open the{" "}
            <a
              href="/architecture/overview"
              style={{ color: "#1d4ed8", textDecoration: "underline" }}
            >
              standalone zoomable view
            </a>
            ).
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0.6rem",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              marginBottom: "0.5rem",
            }}
          >
            <span
              style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569" }}
            >
              Zoom:
            </span>
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= ARCH_ZOOM_STEPS[0]}
              style={secondaryBtnStyle(zoom <= ARCH_ZOOM_STEPS[0])}
              aria-label="Zoom out"
            >
              −
            </button>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#0f172a",
                minWidth: "3rem",
                textAlign: "center",
              }}
            >
              {zoom}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= ARCH_ZOOM_STEPS[ARCH_ZOOM_STEPS.length - 1]}
              style={secondaryBtnStyle(
                zoom >= ARCH_ZOOM_STEPS[ARCH_ZOOM_STEPS.length - 1],
              )}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoom(150)}
              style={secondaryBtnStyle(false)}
            >
              Reset
            </button>
            <a
              href="/architecture/overview2.png"
              target="_blank"
              rel="noreferrer"
              style={{
                marginLeft: "auto",
                fontSize: "0.8rem",
                color: "#1d4ed8",
                textDecoration: "underline",
              }}
            >
              Open image in new tab
            </a>
          </div>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              overflow: "auto",
              maxHeight: "calc(100vh - 260px)",
            }}
          >
            <img
              src="/architecture/overview2.svg"
              alt="Full banking demo architecture: browser, BFF, MCP gateway, backend MCP servers (OLB/invest/mortgage), HITL service, agent service, langchain agent, and PingOne OAuth + RFC 8693 token exchange"
              onError={(e) => {
                e.target.src = "/architecture/overview2.png";
              }}
              style={{
                display: "block",
                width: `${zoom}%`,
                height: "auto",
                minWidth: "600px",
              }}
            />
          </div>
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
            <TokenExchangeFlowDiagram mode={mode} />
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
        {activeTab === "ciba-stepup" && <CibaStepUpFlowPanel />}
      </div>
    </div>
  );
};

export default ArchitectureTabsPanel;
