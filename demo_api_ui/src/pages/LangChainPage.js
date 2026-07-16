// banking_api_ui/src/pages/LangChainPage.js
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const LCEL_CODE = `# LangChain 0.3.x LCEL agent — Helix (default)
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

# 1. LLM (resolved by llm_factory based on langchain_config provider)
llm = ChatAnthropic(model="claude-sonnet-4-6")

# 2. Build a prompt with tool scratchpad
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful banking assistant."),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])

# 3. Bind tools
chain = prompt | llm.bind_tools(tools)

# 4. Simple tool-calling loop
async def run(user_msg: str, chat_history: list) -> str:
    messages   = {"input": user_msg, "chat_history": chat_history, "agent_scratchpad": []}
    result     = await chain.ainvoke(messages)
    while result.tool_calls:
        tool_results = [await tools_by_name[tc["name"]].arun(tc["args"])
                        for tc in result.tool_calls]
        messages["agent_scratchpad"].extend(tool_results)
        result = await chain.ainvoke(messages)
    return result.content`;

const PROVIDERS = [
  {
    id: "helix",
    label: "Helix",
    package: "langchain-openai",
    defaultModel: "gpt-4o-mini",
    notes: "Default provider — Helix API key required",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    package: "langchain-anthropic",
    defaultModel: "claude-sonnet-4-6",
    notes: "ANTHROPIC_API_KEY required",
  },
  {
    id: "anthropic-lmstudio",
    label: "LM Studio",
    package: "langchain-anthropic",
    defaultModel: "auto",
    notes: "Local inference — no API key needed",
  },
];

export default function LangChainPage() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch("/api/langchain/config/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => null);
  }, []);

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "0 auto",
        padding: "32px 16px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Link
          to="/"
          style={{ fontSize: 13, color: "#1565c0", textDecoration: "none" }}
        >
          ← Back
        </Link>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
          LangChain in Super Banking
        </h1>
      </div>

      {/* Cross-stack variant banner */}
      <div
        style={{
          background: "#fff8e1",
          border: "1px solid #ffe082",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 20,
          lineHeight: 1.6,
          color: "#5d4037",
        }}
      >
        Python LangChain variant — the same delegated-OAuth security model as
        the main agent, running in a different runtime (Python + LangChain).
      </div>

      {/* Live model indicator */}
      <div
        style={{
          background: "#e3f2fd",
          border: "1px solid #90caf9",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 20 }}>⚡</span>
        <div>
          <strong>Active provider:</strong>{" "}
          {status ? (
            <span>
              <code>{status.provider}</code> &mdash; model{" "}
              <code>{status.model}</code>
              {status.key_set?.[status.provider] ? (
                <span style={{ color: "#2e7d32", marginLeft: 8 }}>
                  &#x1F512; key set
                </span>
              ) : status.provider === "anthropic-lmstudio" ? (
                <span style={{ color: "#555", marginLeft: 8, fontSize: 12 }}>
                  (local)
                </span>
              ) : (
                <span style={{ color: "#c62828", marginLeft: 8, fontSize: 12 }}>
                  ⚠ no key — set one in Config or the chat widget badge
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: "#374151" }}>Loading…</span>
          )}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12 }}>
          <Link to="/config" style={{ color: "#1565c0" }}>
            Change in Config →
          </Link>
        </div>
      </div>

      {/* Architecture */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Architecture</h2>
        <p style={{ lineHeight: 1.6, color: "#333" }}>
          The <code>langchain_agent</code> service is a standalone Python
          FastAPI app that connects to the MCP server via WebSocket. It uses
          LangChain 0.3.x LCEL to orchestrate tool calling across any of the
          five supported providers. The BFF exposes{" "}
          <code>/api/langchain/config</code> to store provider selection and API
          keys (session-only — keys are never returned to the browser).
        </p>
        <pre
          style={{
            background: "#f5f5f5",
            borderRadius: 6,
            padding: "12px 16px",
            fontSize: 13,
            overflowX: "auto",
            lineHeight: 1.5,
          }}
        >
          {`Browser  ──►  BFF (/api/langchain)  ──►  session (API keys, provider)
             │
             └─►  langchain_agent (FastAPI WS)
                    │  LangChain 0.3.x LCEL
                    │  llm_factory.get_llm(provider, model, api_key)
                    └─►  MCP Server (tools)  ──►  Banking API`}
        </pre>
      </section>

      {/* LCEL code */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>LCEL Agent Pattern</h2>
        <pre
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            borderRadius: 8,
            padding: "16px 20px",
            fontSize: 13,
            overflowX: "auto",
            lineHeight: 1.6,
          }}
        >
          {LCEL_CODE}
        </pre>
        <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
          Source: <code>langchain_agent/src/agent/langchain_mcp_agent.py</code>{" "}
          + <code>langchain_agent/src/agent/llm_factory.py</code>
        </p>
      </section>

      {/* Provider comparison table */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Provider Comparison</h2>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {["Provider", "Package", "Default model", "Notes"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    borderBottom: "2px solid #e0e0e0",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((p, i) => (
              <tr
                key={p.id}
                style={{
                  background: i % 2 === 0 ? "#fff" : "#fafafa",
                  fontWeight: status?.provider === p.id ? 600 : 400,
                }}
              >
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  {p.label}
                  {status?.provider === p.id && (
                    <span style={{ marginLeft: 6, color: "#1565c0" }}>
                      ← active
                    </span>
                  )}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <code>{p.package}</code>
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <code>{p.defaultModel}</code>
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    color: "#555",
                  }}
                >
                  {p.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Security pattern */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>
          Security: Keys Stay Server-Side
        </h2>
        <p style={{ lineHeight: 1.6, color: "#333" }}>
          API keys are stored exclusively in{" "}
          <code>req.session.langchain_config</code> on the BFF. The{" "}
          <code>GET /api/langchain/config/status</code> endpoint returns only
          boolean flags (<code>key_set: &#123; helix: true &#125;</code>) —
          never any key values. This follows the same security pattern as the
          PingOne OAuth client secrets.
        </p>
      </section>
    </div>
  );
}
