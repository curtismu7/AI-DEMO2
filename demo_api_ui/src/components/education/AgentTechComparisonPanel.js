// education/AgentTechComparisonPanel.js — technical comparison of the four agent frameworks
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

// ── Shared primitives ─────────────────────────────────────────────────────────

function Pill({ children, color = "#1e3a5f" }) {
  return (
    <span style={{
      display: "inline-block",
      fontSize: "0.68rem", fontWeight: 600,
      color, background: color + "18",
      border: `1px solid ${color}50`,
      borderRadius: 99, padding: "1px 8px",
      marginRight: 4, marginBottom: 2,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: "0.82rem" }}>
      <span style={{ fontWeight: 700, color: "#1e3a5f", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#374151", lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

function Card({ children, accent = "#1e3a5f" }) {
  return (
    <div style={{
      borderLeft: `4px solid ${accent}`,
      background: "#f8fafc",
      borderRadius: "0 8px 8px 0",
      padding: "12px 16px",
      marginBottom: 14,
    }}>{children}</div>
  );
}

function SectionHead({ children }) {
  return (
    <h4 style={{ margin: "18px 0 8px", fontSize: "0.82rem", fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
      {children}
    </h4>
  );
}

function Warn({ children }) {
  return (
    <div style={{
      background: "#fffbeb", border: "1px solid #fde68a",
      borderRadius: 6, padding: "6px 10px", fontSize: "0.79rem",
      color: "#92400e", marginTop: 8,
    }}>{children}</div>
  );
}

// ── At a Glance table ─────────────────────────────────────────────────────────

const COLS = ["", "LangChain"];
const ROWS = [
  ["Language",         "Python 3.10"],
  ["Framework ver.",   "demo pins 0.0.353 + LangGraph · current stable 1.x (GA Oct 2025)"],
  ["Agent loop",       "ReAct"],
  ["LLM providers",    "Helix, LM Studio, Anthropic"],
  ["MCP support",      "Full MCP host"],
  ["OAuth / tokens",   "Manages own"],
  ["Conv. memory",     "Per-session + trim"],
  ["Tracing",          "Built-in + viz"],
  ["Horiz. scaling",   "Harder"],
  ["Complexity",       "High (prod-grade)"],
];

function GlanceTab() {
  const colW = "70%";
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Quick-scan of the demo's agent framework. Use the per-framework tab for depth.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              {COLS.map((c, i) => (
                <th key={i} style={{
                  textAlign: i === 0 ? "left" : "center",
                  padding: "6px 8px",
                  background: "#1e3a5f", color: "#fff",
                  borderRight: "1px solid #2d4f7f",
                  width: i === 0 ? "15%" : colW,
                  fontWeight: 700, fontSize: "0.75rem",
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: "6px 8px",
                    borderRight: "1px solid #e2e8f0",
                    borderBottom: "1px solid #e2e8f0",
                    fontWeight: ci === 0 ? 700 : 400,
                    color: ci === 0 ? "#1e3a5f" : "#374151",
                    textAlign: ci === 0 ? "left" : "center",
                  }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionHead>The key architectural split</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        <strong>LangChain</strong> is a self-contained agent — it manages its own session memory,
        OAuth tokens, and MCP connections.
      </p>
      <p style={{ fontSize: "0.83rem", color: "#374151" }}>
        The BFF constructs every request for it the same way — no framework-specific
        branching remains on the banking chat path.
      </p>
    </>
  );
}

// ── LangChain tab ─────────────────────────────────────────────────────────────

function LangChainTab() {
  return (
    <>
      <Card accent="#2563eb">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Pill color="#2563eb">Python 3.10</Pill>
          <Pill color="#2563eb">LangGraph ReAct</Pill>
          <Pill color="#2563eb">Full MCP Host</Pill>
          <Pill color="#2563eb">Own OAuth</Pill>
          <Pill color="#2563eb">Stateful</Pill>
        </div>
        <Row label="Framework">LangChain — demo pins 0.0.353 + LangGraph · current stable 1.x (GA Oct 2025) — <code>create_react_agent</code></Row>
        <Row label="Ports">HTTP 8888 · Health 8890</Row>
      </Card>

      <SectionHead>Agent Loop</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Uses LangGraph's ReAct pattern — the LLM alternates between Reason and Act until it
        produces a final answer. Each step is checkpointed by <code>MemorySaver</code> keyed
        on <code>session_id</code>, so the full chain is recoverable and restartable.
      </p>

      <SectionHead>LLM Providers</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Set via <code>LANGCHAIN_PROVIDER</code>:{" "}
        <Pill color="#2563eb">helix</Pill>
        <Pill color="#2563eb">lmstudio</Pill>
        <Pill color="#2563eb">anthropic</Pill>
        <Pill color="#2563eb">anthropic-lmstudio</Pill>
        — the only agent with Helix support.
      </p>

      <SectionHead>MCP & Tools</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        The only agent that is a real MCP host. Maintains an <code>MCPClientManager</code> +
        connection pool, discovers tools dynamically on connect, and supports both WebSocket
        and Streamable HTTP transports. Tools surface as LangChain <code>BaseTool</code> objects
        — no restart needed when a new tool is registered.
      </p>

      <SectionHead>OAuth & Tokens</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Dual-token model: client credentials for the agent's own identity, authorization code
        for the end user. Tokens stored encrypted (AES-128-GCM). Auto-refresh 5 minutes before
        expiry. Tied to PingOne/ForgeRock.
      </p>

      <SectionHead>Memory</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Per-session history with two-stage trimming: token count cap (default 4 096) then
        message count cap (default 100). Background task evicts inactive sessions after 60
        minutes. No cross-session memory.
      </p>

      <SectionHead>Observability</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        <code>DetailedTracingCallbackHandler</code> intercepts every LangChain step.
        <code>ExecutionTracer</code> reconstructs the full reasoning chain. Optional trace
        visualizer at port 8090. Security-aware structured logging (redacts sensitive fields).
        <code>/inspector/mcp-host</code> shows live MCP registry state.
      </p>

      <SectionHead>When to use</SectionHead>
      <ul style={{ paddingLeft: 18, fontSize: "0.83rem", color: "#374151", lineHeight: 1.7 }}>
        <li>Need MCP tool discovery (not just HTTP endpoints)</li>
        <li>Need the agent to manage its own OAuth flows end-to-end</li>
        <li>Need persistent per-session conversation history</li>
        <li>Need detailed execution tracing and replay</li>
        <li>Want Helix or LM Studio as the LLM backend</li>
      </ul>

      <Warn>Hardest to scale horizontally — session state is in-memory. PingOne/ForgeRock required for OAuth.</Warn>
    </>
  );
}

// ── Decision Guide tab ────────────────────────────────────────────────────────

function DecisionTab() {
  const items = [
    { q: "Need MCP tool discovery?", a: "LangChain — it's a full MCP host with dynamic tool discovery." },
    { q: "Agent must manage its own OAuth?", a: "LangChain — it manages its own token lifecycle end-to-end." },
    { q: "Local LLM via Helix or LM Studio?", a: "LangChain — the only agent with Helix support, plus LM Studio." },
    { q: "Need full execution tracing?", a: "LangChain — built-in trace server with step-by-step reasoning reconstruction." },
  ];

  return (
    <>
      <p style={{ marginTop: 0 }}>
        Why the demo uses LangChain for the banking chat path.
      </p>
      {items.map(({ q, a }) => (
        <div key={q} style={{
          borderBottom: "1px solid #e5e7eb", paddingBottom: 10, marginBottom: 10,
        }}>
          <p style={{ margin: "0 0 3px", fontWeight: 700, fontSize: "0.84rem", color: "#1e3a5f" }}>
            {q}
          </p>
          <p style={{ margin: 0, fontSize: "0.83rem", color: "#374151" }}>{a}</p>
        </div>
      ))}

      <div style={{
        background: "#eff6ff", border: "1px solid #bfdbfe",
        borderRadius: 8, padding: "10px 14px", marginTop: 12, fontSize: "0.82rem", color: "#1e40af",
      }}>
        <strong>Key rule:</strong> Ping controls (token exchange, Authorize, HITL)
        are framework-agnostic — they live in the BFF and MCP gateway, not the agent.
      </div>
    </>
  );
}

// ── Panel export ──────────────────────────────────────────────────────────────

export default function AgentTechComparisonPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "glance", label: "At a Glance", content: <GlanceTab /> },
    { id: "langchain", label: "LangChain", content: <LangChainTab /> },
    { id: "decision", label: "Decision Guide", content: <DecisionTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Framework Technical Comparison"
      tabs={tabs}
      initialTabId={initialTabId || "glance"}
    />
  );
}
