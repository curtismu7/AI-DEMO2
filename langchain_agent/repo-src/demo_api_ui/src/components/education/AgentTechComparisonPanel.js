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

const COLS = ["", "LangChain", "Mastra", "OpenAI Agents", "Pydantic AI"];
const ROWS = [
  ["Language",         "Python 3.10",     "Node 20 / TS",   "Python 3.11",     "Python 3.11"],
  ["Framework ver.",   "0.0.353 + LangGraph", "1.37",        "0.17 (official)", "0.0.54 pre-release"],
  ["Agent loop",       "ReAct",           "Tool-calling",   "Tool-calling",    "Tool-calling"],
  ["LLM providers",    "Helix, LM Studio, Anthropic", "OpenAI-compat, Anthropic", "OpenAI / compat", "OpenAI-compat, Anthropic"],
  ["MCP support",      "Full MCP host",   "None",           "None",            "None"],
  ["OAuth / tokens",   "Manages own",     "BFF delegates",  "BFF delegates",   "BFF delegates"],
  ["Conv. memory",     "Per-session + trim", "Stateless",   "Stateless",       "Stateless"],
  ["Tracing",          "Built-in + viz",  "AG-UI events",   "AG-UI + usage",   "AG-UI events"],
  ["Horiz. scaling",   "Harder",          "Easy",           "Easy",            "Easy"],
  ["Complexity",       "High (prod-grade)", "Low",          "Medium",          "Medium"],
];

function GlanceTab() {
  const colW = `${Math.floor(85 / 4)}%`;
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Quick-scan comparison across all four frameworks. Use the per-framework tabs for depth,
        or jump to <strong>Decision Guide</strong> if you need to choose one now.
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
        OAuth tokens, and MCP connections. The other three are <strong>stateless compute engines</strong>:
        the BFF sends them everything they need per request and receives the result. State,
        history, and tokens all live in the BFF.
      </p>
      <p style={{ fontSize: "0.83rem", color: "#374151" }}>
        That makes Mastra, OpenAI Agents, and Pydantic AI interchangeable from the BFF's
        perspective — swapping one for another requires no change to how the BFF constructs
        requests.
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
        <Row label="Framework">LangChain 0.0.353 + LangGraph <code>create_react_agent</code></Row>
        <Row label="Ports">WebSocket 8889 · HTTP 8888 · Health 8890</Row>
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

// ── Mastra tab ────────────────────────────────────────────────────────────────

function MastraTab() {
  return (
    <>
      <Card accent="#7c3aed">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Pill color="#7c3aed">Node 20 / TypeScript</Pill>
          <Pill color="#7c3aed">Tool-calling</Pill>
          <Pill color="#7c3aed">No MCP</Pill>
          <Pill color="#7c3aed">Stateless</Pill>
          <Pill color="#7c3aed">BFF-backed</Pill>
        </div>
        <Row label="Framework">Mastra Core 1.37 + AI SDK (Anthropic / OpenAI)</Row>
        <Row label="Port">8892 (POST /run → SSE)</Row>
      </Card>

      <SectionHead>Agent Loop</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Mastra's native tool-calling loop — not ReAct. The BFF sends messages, tool schemas,
        context, and session ID per request. A fresh <code>Agent</code> is constructed for that
        request, <code>agent.stream()</code> runs, tools POST to the BFF, and the result
        streams back as AG-UI SSE events. No state survives between calls.
      </p>

      <SectionHead>LLM Providers</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Default: any OpenAI-compatible endpoint (LM Studio, Groq, Together) via
        <code>AGENT_LLM_BASE_URL</code>. Pass <code>context.provider = "anthropic"</code> in
        the request payload to switch to Anthropic without restarting.
      </p>

      <SectionHead>Tools</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        No MCP. Tools are built at request time from BFF-provided JSON schemas
        (<code>buildBffTools()</code>). Each tool is a thin wrapper that POSTs to the BFF.
        Tool list changes every request.
      </p>

      <SectionHead>Only TypeScript agent</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        The only Node.js / TypeScript option in the project. If your team prefers TS, this is
        the natural pick.
      </p>

      <SectionHead>When to use</SectionHead>
      <ul style={{ paddingLeft: 18, fontSize: "0.83rem", color: "#374151", lineHeight: 1.7 }}>
        <li>TypeScript/Node.js preferred over Python</li>
        <li>Need simple, horizontally scalable stateless compute</li>
        <li>Per-request model/provider switching needed</li>
        <li>BFF owns all state, history, and tokens</li>
        <li>Want local LLM support via LM Studio</li>
      </ul>

      <Warn>No MCP, no OAuth. Conversation history must fit in the request payload — no server-side trimming.</Warn>
    </>
  );
}

// ── OpenAI Agents tab ─────────────────────────────────────────────────────────

function OpenAITab() {
  return (
    <>
      <Card accent="#059669">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Pill color="#059669">Python 3.11</Pill>
          <Pill color="#059669">Official OpenAI SDK</Pill>
          <Pill color="#059669">Tool-calling</Pill>
          <Pill color="#059669">No MCP</Pill>
          <Pill color="#059669">Stateless</Pill>
        </div>
        <Row label="Framework">openai-agents 0.17 (official OpenAI package)</Row>
        <Row label="Port">8891 (POST /run → SSE)</Row>
      </Card>

      <SectionHead>Agent Loop</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        OpenAI's <code>Runner.run_streamed()</code> manages the tool-calling loop. The BFF
        sends messages, tool schemas, context, and session ID. Each request builds a fresh
        <code>Agent</code> with <code>FunctionTool</code> objects, runs, streams typed SDK
        events (<code>RawResponsesStreamEvent</code>, <code>RunItemStreamEvent</code>), which
        are mapped to AG-UI format.
      </p>

      <SectionHead>LLM Providers</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Primarily OpenAI. Base URL override (<code>AGENT_LLM_BASE_URL</code>) allows pointing
        at an OpenAI-compatible endpoint, but the SDK is built around OpenAI's API — no native
        Anthropic support.
      </p>

      <SectionHead>Observability advantage</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Slightly better tool lifecycle visibility than Mastra and Pydantic AI — the SDK emits
        explicit tool-call and tool-result stream events, plus token usage tracking if available.
      </p>

      <SectionHead>When to use</SectionHead>
      <ul style={{ paddingLeft: 18, fontSize: "0.83rem", color: "#374151", lineHeight: 1.7 }}>
        <li>Official OpenAI SDK preferred (well-documented, official support)</li>
        <li>Python-native team</li>
        <li>Deploying to OpenAI models (GPT-4o, GPT-4o-mini) in production</li>
        <li>Want cleaner structured stream events for tool lifecycle</li>
      </ul>

      <Warn>OpenAI-only in practice — no native Anthropic, no Helix, no LM Studio. Stateless like all BFF-backed agents.</Warn>
    </>
  );
}

// ── Pydantic AI tab ───────────────────────────────────────────────────────────

function PydanticTab() {
  return (
    <>
      <Card accent="#dc2626">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Pill color="#dc2626">Python 3.11</Pill>
          <Pill color="#dc2626">Pydantic-native</Pill>
          <Pill color="#dc2626">Tool-calling</Pill>
          <Pill color="#dc2626">No MCP</Pill>
          <Pill color="#dc2626">Pre-release</Pill>
        </div>
        <Row label="Framework">pydantic-ai 0.0.54 (pre-release)</Row>
        <Row label="Port">8893 (POST /run → SSE)</Row>
      </Card>

      <SectionHead>Agent Loop</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        Pydantic AI's <code>Agent.run_stream()</code>. Tools receive a
        <code>RunContext[BffDeps]</code> parameter giving them clean access to the BFF URL,
        internal secret, and session ID without global state. Text deltas are streamed via
        <code>result.stream_text(delta=True)</code>. Tool calls happen internally — they don't
        surface as separate stream events in the current version.
      </p>

      <SectionHead>LLM Providers</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        <Pill color="#dc2626">OpenAI-compatible</Pill> (LM Studio, Groq) via
        <code>OpenAIModel</code> + <code>OpenAIProvider</code>. Pass
        <code>context.provider = "anthropic"</code> to switch to <code>AnthropicModel</code>{" "}
        using <code>ANTHROPIC_API_KEY</code>.
      </p>

      <SectionHead>Type-safety strength</SectionHead>
      <p style={{ fontSize: "0.83rem", color: "#374151", marginTop: 0 }}>
        The cleanest Pydantic-native design. <code>BffDeps</code> dataclass scopes all
        request context. Tool definitions are fully type-safe. Easy to extend with typed
        response models.
      </p>

      <SectionHead>When to use</SectionHead>
      <ul style={{ paddingLeft: 18, fontSize: "0.83rem", color: "#374151", lineHeight: 1.7 }}>
        <li>Codebase heavy on Pydantic models and type safety</li>
        <li>Anthropic + OpenAI-compat needed without LangChain complexity</li>
        <li>Experimenting with a lightweight, modern Python agent framework</li>
        <li>Clean per-request dependency injection pattern preferred</li>
      </ul>

      <Warn>Pre-release (0.0.54) — API may change. Tool call lifecycle is least visible of all four agents. Stateless like all BFF-backed agents.</Warn>
    </>
  );
}

// ── Decision Guide tab ────────────────────────────────────────────────────────

function DecisionTab() {
  const items = [
    { q: "Need MCP tool discovery?", a: "LangChain — it's the only MCP host. The others only call HTTP endpoints." },
    { q: "Agent must manage its own OAuth?", a: "LangChain — the others delegate token management to the BFF entirely." },
    { q: "Local LLM via Helix or LM Studio?", a: "LangChain (Helix + LM Studio) or Mastra / Pydantic AI (LM Studio via OpenAI-compat)." },
    { q: "TypeScript / Node.js preferred?", a: "Mastra — the only Node.js agent in the project." },
    { q: "Simplest stateless compute node?", a: "Mastra (TS) or OpenAI Agents / Pydantic AI (Python) — all three are pure request-response." },
    { q: "OpenAI models in production?", a: "OpenAI Agents — official SDK, cleanest stream events, best for GPT-4o deployments." },
    { q: "Anthropic without LangChain overhead?", a: "Pydantic AI or Mastra — both support Anthropic natively and are simpler to operate." },
    { q: "Need horizontal scaling?", a: "Mastra, OpenAI Agents, or Pydantic AI — all stateless. LangChain's session memory complicates this." },
    { q: "Need full execution tracing?", a: "LangChain — built-in trace server with step-by-step reasoning reconstruction." },
    { q: "Comfortable with pre-release?", a: "Pydantic AI (0.0.54) — clean design but API may change." },
  ];

  return (
    <>
      <p style={{ marginTop: 0 }}>
        Use this as a quick filter before committing to a framework.
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
        <strong>Key rule:</strong> Mastra, OpenAI Agents, and Pydantic AI are interchangeable
        from the BFF's perspective. Swapping one for another changes only which endpoint the BFF
        calls — not how it builds requests.
      </div>
    </>
  );
}

// ── Panel export ──────────────────────────────────────────────────────────────

export default function AgentTechComparisonPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "glance", label: "At a Glance", content: <GlanceTab /> },
    { id: "langchain", label: "LangChain", content: <LangChainTab /> },
    { id: "mastra", label: "Mastra", content: <MastraTab /> },
    { id: "openai", label: "OpenAI Agents", content: <OpenAITab /> },
    { id: "pydantic", label: "Pydantic AI", content: <PydanticTab /> },
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
