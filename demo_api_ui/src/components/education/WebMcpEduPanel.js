// banking_api_ui/src/components/education/WebMcpEduPanel.js
import EducationDrawer from "../shared/EducationDrawer";
import { EDU } from "./educationIds";
import { useEducationUI } from "../../context/EducationUIContext";

function OverviewContent() {
  return (
    <div>
      <p>
        <strong>WebMCP</strong> is the pattern of exposing MCP (Model Context
        Protocol) tools to a browser-based UI through a{" "}
        <strong>Backend-for-Frontend (BFF) proxy</strong>. The browser never
        touches the MCP server directly — all tool calls are forwarded through
        the BFF, which holds OAuth tokens securely server-side.
      </p>

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        Why it matters
      </h4>
      <ul style={{ paddingLeft: "1.2rem", lineHeight: 1.7, color: "#374151" }}>
        <li>
          <strong>Tokens stay server-side.</strong> The browser never receives
          the OAuth access token or the RFC 8693 exchanged MCP token — only tool
          results are returned.
        </li>
        <li>
          <strong>Uniform security boundary.</strong> Every tool call passes
          through the same BFF middleware that enforces session validation,
          scope checking, and HITL consent.
        </li>
        <li>
          <strong>Live introspection without a CLI.</strong> Developers and demo
          audiences can browse available tools, inspect schemas, call tools, and
          see streaming results directly in the browser without installing any
          local tooling.
        </li>
      </ul>

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        What this page shows
      </h4>
      <p style={{ color: "#374151", lineHeight: 1.7 }}>
        The Tool Inspector connects to the live MCP server via the BFF and lists
        all registered tools. Select a tool to see its input schema, fill in
        parameters, and call it — the same execution path used by the AI Banking
        Agent.
      </p>

      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 6,
          padding: "0.75rem 1rem",
          marginTop: "1rem",
          fontSize: "0.84rem",
          color: "#1e3a5f",
        }}
      >
        <strong>MCP requires the server to be running.</strong> If the tool list
        is empty, the MCP WebSocket server at <code>banking_mcp_server/</code>{" "}
        is not reachable. The Banking Agent still works via the static fallback
        path.
      </div>
    </div>
  );
}

function ArchitectureContent() {
  const row = (label, detail, accent) => (
    <div
      key={label}
      style={{
        borderLeft: `4px solid ${accent}`,
        borderRadius: "0 6px 6px 0",
        background: "#f8fafc",
        padding: "0.65rem 0.9rem",
        marginBottom: "0.6rem",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: "0.88rem",
          color: "#1e293b",
          marginBottom: "0.2rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.5 }}>
        {detail}
      </div>
    </div>
  );

  return (
    <div>
      <h4 style={{ marginTop: 0, marginBottom: "0.8rem", color: "#1e293b" }}>
        Request flow
      </h4>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.3rem",
          fontSize: "0.8rem",
          color: "#374151",
          marginBottom: "1.2rem",
        }}
      >
        {[
          [
            "1. Browser",
            "POST /api/mcp/call  { tool, params, flowTraceId }",
            "#3b82f6",
          ],
          [
            "2. BFF session check",
            "Express middleware validates session cookie",
            "#8b5cf6",
          ],
          [
            "3. RFC 8693 exchange",
            "BFF exchanges user token for narrowed MCP-audience token",
            "#f59e0b",
          ],
          [
            "4. MCP tools/call",
            "BFF forwards { name, arguments } to MCP WebSocket server",
            "#10b981",
          ],
          [
            "5. MCP response",
            "Tool result returned as JSON; streamed events via SSE",
            "#10b981",
          ],
          [
            "6. Browser receives",
            "Only the tool result — no token, no MCP connection",
            "#3b82f6",
          ],
        ].map(([step, desc, color]) => (
          <div
            key={step}
            style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}
          >
            <span
              style={{
                background: color,
                color: "#fff",
                borderRadius: 4,
                padding: "1px 7px",
                fontSize: "0.73rem",
                whiteSpace: "nowrap",
                marginTop: "0.1rem",
              }}
            >
              {step}
            </span>
            <span style={{ lineHeight: 1.5 }}>{desc}</span>
          </div>
        ))}
      </div>

      <h4 style={{ marginBottom: "0.8rem", color: "#1e293b" }}>
        BFF endpoints
      </h4>
      {row(
        "GET /api/mcp/tools",
        "Lists all tools registered on the MCP server (tools/list). Returns name, description, inputSchema.",
        "#3b82f6",
      )}
      {row(
        "POST /api/mcp/call",
        "Calls a single tool (tools/call). Body: { tool, params, flowTraceId }. Returns tool result JSON.",
        "#10b981",
      )}
      {row(
        "GET /api/mcp/stream/:flowTraceId",
        "Server-Sent Events stream for a specific tool call. Emits token exchange events, tool progress, and completion.",
        "#f59e0b",
      )}

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        Token security
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6 }}>
        The BFF performs RFC 8693 token exchange before every{" "}
        <code>tools/call</code>. The resulting MCP token has a narrowed audience
        (<code>aud = MCP_RESOURCE_URI</code>) and reduced scopes. It never
        leaves the server process. The browser only sees the JSON result.
      </p>
    </div>
  );
}

function InRepoContent() {
  const { open } = useEducationUI();
  return (
    <div>
      <h4 style={{ marginTop: 0, color: "#1e293b" }}>Key files</h4>
      <ul
        style={{
          paddingLeft: "1.2rem",
          lineHeight: 1.8,
          fontSize: "0.84rem",
          color: "#374151",
        }}
      >
        <li>
          <code>banking_api_ui/src/services/webMcpClient.js</code> —
          browser-side HTTP client for the three BFF endpoints
        </li>
        <li>
          <code>banking_api_server/routes/mcp.js</code> (or{" "}
          <code>bankingAgentNl.js</code>) — BFF route handlers that proxy to the
          MCP server
        </li>
        <li>
          <code>banking_mcp_server/</code> — the MCP WebSocket server with the
          registered banking tools
        </li>
        <li>
          <code>banking_api_ui/src/components/WebMcpPanel.js</code> — this page
          (Tool Inspector UI)
        </li>
      </ul>

      <h4 style={{ marginTop: "1.2rem", color: "#1e293b" }}>Related panels</h4>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginTop: "0.4rem",
        }}
      >
        {[
          ["MCP Protocol", () => open(EDU.MCP_PROTOCOL, "what")],
          ["Token Exchange (RFC 8693)", () => open(EDU.TOKEN_EXCHANGE, "why")],
          ["Agent Gateway", () => open(EDU.AGENT_GATEWAY, "overview")],
          ["Token Flow", () => open(EDU.TOKEN_FLOW, 'diagram')],
        ].map(([label, handler]) => (
          <button
            key={label}
            type="button"
            onClick={handler}
            style={{
              background: "none",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "0.3rem 0.8rem",
              fontSize: "0.82rem",
              color: "#1e40af",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function WebMcpEduPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "overview", label: "Overview", content: <OverviewContent /> },
    {
      id: "architecture",
      label: "Architecture",
      content: <ArchitectureContent />,
    },
    { id: "inrepo", label: "In this repo", content: <InRepoContent /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="WebMCP — Browser-Native MCP Access"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
