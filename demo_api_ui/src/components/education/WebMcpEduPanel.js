// banking_api_ui/src/components/education/WebMcpEduPanel.js
import EducationDrawer from "../shared/EducationDrawer";
import { EDU } from "./educationIds";
import { useEducationUI } from "../../context/EducationUIContext";

function OverviewContent() {
  return (
    <div>
      <p>
        <strong>WebMCP (Web Model Context Protocol)</strong> is a proposed web
        standard by Google Chrome that allows websites to expose structured
        tools directly to AI agents. Instead of agents scraping HTML or using
        vision models to understand UI, WebMCP tells them clearly what actions
        exist, what inputs they need, and what outputs they return.
      </p>

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        The Problem WebMCP Solves
      </h4>
      <p style={{ color: "#374151", lineHeight: 1.7, fontSize: "0.84rem" }}>
        Traditional web automation relies on AI agents reading HTML, guessing button
        functions, parsing dynamic selectors. This is fragile — a small DOM change
        breaks everything. WebMCP shifts from <strong>implicit (guessing)</strong> to{" "}
        <strong>explicit (structured contracts)</strong>.
      </p>

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        Two APIs: Imperative & Declarative
      </h4>
      <div
        style={{
          fontSize: "0.84rem",
          color: "#374151",
          lineHeight: 1.6,
          marginTop: "0.6rem",
        }}
      >
        <strong style={{ display: "block", marginBottom: "0.3rem" }}>
          Imperative API (JavaScript-driven)
        </strong>
        Explicitly register tools in code. Useful for complex execution logic.
        Example: <code>navigator.webMCP.registerTool({"{"}name, description, inputSchema, execute{"}"})</code>
        <br />
        <br />
        <strong style={{ display: "block", marginBottom: "0.3rem" }}>
          Declarative API (HTML-first)
        </strong>
        Annotate HTML forms with <code>webmcp-tool</code> attributes. WebMCP
        auto-converts forms into structured tools. Perfect for existing apps —
        minimal changes required.
      </div>

      <h4
        style={{
          marginTop: "1.2rem",
          marginBottom: "0.5rem",
          color: "#1e293b",
        }}
      >
        Key Benefits
      </h4>
      <ul style={{ paddingLeft: "1.2rem", lineHeight: 1.7, color: "#374151", fontSize: "0.84rem" }}>
        <li>
          <strong>Speed & Reliability.</strong> No DOM guessing. Structured
          execution reduces errors by orders of magnitude.
        </li>
        <li>
          <strong>Precision for AI.</strong> Agents understand intent better when
          schemas and names are explicit.
        </li>
        <li>
          <strong>Backward compatible.</strong> Sites can expose WebMCP tools
          alongside traditional HTML — existing users unaffected.
        </li>
      </ul>
    </div>
  );
}

function ArchitectureContent() {
  return (
    <div>
      <p style={{ color: "#374151", lineHeight: 1.7, fontSize: "0.84rem", marginBottom: "1rem" }}>
        This demo implements a <strong>BFF (Backend-for-Frontend) pattern</strong> for exposing
        MCP tools to the browser. It shows how web apps can make tools available to AI agents
        while keeping tokens secure server-side.
      </p>

      <ArchitectureFlowContent />
    </div>
  );
}

function ArchitectureFlowContent() {
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

function UseCasesContent() {
  return (
    <div>
      <p style={{ color: "#374151", lineHeight: 1.7, fontSize: "0.84rem" }}>
        Real-world scenarios where WebMCP dramatically improves AI agent capabilities.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        E-commerce
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6, margin: "0 0 1rem" }}>
        User says: "Find me running shoes under $120 and checkout." Agent uses
        WebMCP tools: <code>searchProducts()</code>, <code>filterProducts()</code>,{" "}
        <code>addToCart()</code>, <code>applyCoupon()</code>, <code>checkout()</code>.
        Conversion rates spike — no UI friction.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        Travel Booking
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6, margin: "0 0 1rem" }}>
        Agents handle multi-step workflows: search flights, compare hotels, book
        cabs, add insurance — all via structured tools, not browser automation.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        SaaS Dashboards
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6, margin: "0 0 1rem" }}>
        Analytics dashboard exposing: <code>generateReport()</code>, <code>downloadCSV()</code>,{" "}
        <code>inviteMember()</code>, <code>changeBillingPlan()</code>. AI copilots
        become insanely powerful.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        CRM Systems
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6, margin: "0 0 1rem" }}>
        Instead of clicking 10 screens: <code>createLead()</code>, <code>assignSalesRep()</code>,{" "}
        <code>scheduleFollowUp()</code>. Faster workflows, less human friction.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        Customer Support
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6 }}>
        AI agent can cancel subscriptions, raise refunds, track shipments — without
        parsing random pages.
      </p>
    </div>
  );
}

function BestPracticesContent() {
  const practice = (title, bad, good) => (
    <div
      key={title}
      style={{
        marginBottom: "1rem",
        borderLeft: "3px solid #3b82f6",
        paddingLeft: "1rem",
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.4rem", color: "#1e293b" }}>
        {title}
      </strong>
      <div style={{ fontSize: "0.82rem", color: "#374151", lineHeight: 1.5 }}>
        <span style={{ color: "#dc2626" }}>❌ Bad:</span> {bad}
        <br />
        <span style={{ color: "#16a34a" }}>✅ Good:</span> {good}
      </div>
    </div>
  );

  return (
    <div>
      {practice(
        "Keep tools single-purpose",
        "manageEverything()",
        "createInvoice(), sendInvoice(), downloadInvoice() — specificity improves AI accuracy",
      )}
      {practice(
        "Use clear names",
        "doTask()",
        "submitExpenseClaim() — agents understand intent better",
      )}
      {practice(
        "Reduce cognitive load",
        "durationInMinutes",
        "startTime, endTime — let your app compute, not the AI",
      )}
      {practice(
        "Handle failures gracefully",
        "Assume perfect execution",
        "Support retries safely, implement idempotency",
      )}

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        Semantic Clarity
      </h4>
      <p style={{ fontSize: "0.84rem", color: "#374151", lineHeight: 1.6 }}>
        Strong schemas, clear naming, and explicit tool purposes avoid ambiguity.
        When schemas and descriptions match the actual behavior, AI agents rarely
        hallucinate or misuse tools.
      </p>
    </div>
  );
}

function SecurityContent() {
  return (
    <div>
      <p style={{ color: "#374151", lineHeight: 1.7, fontSize: "0.84rem" }}>
        WebMCP unlocks powerful agent capabilities. Security requires proactive design.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        Risks
      </h4>
      <ul style={{ paddingLeft: "1.2rem", lineHeight: 1.7, color: "#374151", fontSize: "0.84rem" }}>
        <li>
          <strong>Runtime tool injection.</strong> Malicious scripts could inject
          fake tools and trick agents into executing them.
        </li>
        <li>
          <strong>Cross-origin attacks.</strong> Agents must validate tool origin
          and refuse tools from untrusted sources.
        </li>
      </ul>

      <h4 style={{ marginTop: "1.2rem", marginBottom: "0.6rem", color: "#1e293b" }}>
        Mitigations
      </h4>
      <ul style={{ paddingLeft: "1.2rem", lineHeight: 1.7, color: "#374151", fontSize: "0.84rem" }}>
        <li>
          <strong>Origin validation.</strong> Only trust tools registered from
          known, HTTPS origins.
        </li>
        <li>
          <strong>Tool registration auditing.</strong> Log all tool registrations
          for security review.
        </li>
        <li>
          <strong>Permission boundaries.</strong> Scope tool access by user role,
          session, or data classification.
        </li>
        <li>
          <strong>User confirmations.</strong> For sensitive operations (transfers,
          deletions), require explicit human approval.
        </li>
      </ul>

      <div
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 6,
          padding: "0.75rem 1rem",
          marginTop: "1rem",
          fontSize: "0.84rem",
          color: "#7f1d1d",
        }}
      >
        <strong>Never trust blindly.</strong> Even with WebMCP's structured contract,
        validate inputs, sanitize outputs, and enforce the principle of least privilege.
      </div>
    </div>
  );
}

function DemoImplementationContent() {
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
      id: "usecases",
      label: "Use Cases",
      content: <UseCasesContent />,
    },
    {
      id: "bestpractices",
      label: "Best Practices",
      content: <BestPracticesContent />,
    },
    {
      id: "security",
      label: "Security",
      content: <SecurityContent />,
    },
    {
      id: "demoarch",
      label: "Demo Implementation",
      content: <ArchitectureContent />,
    },
    { id: "inrepo", label: "In this repo", content: <DemoImplementationContent /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="WebMCP (Google Standard) & Implementation"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
