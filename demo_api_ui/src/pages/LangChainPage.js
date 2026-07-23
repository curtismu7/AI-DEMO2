// demo_api_ui/src/pages/LangChainPage.js
// /langchain — LangChain agent runtime + current brain/framework inventory
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const LCEL_CODE = `# LangChain / LangGraph agent — tools via BFF (AG-UI)
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage

# llm_factory resolves provider from BFF session (google / llamacpp / helix / …)
llm = get_llm(provider=cfg.provider, model=cfg.model)

agent = create_react_agent(
    llm=llm,
    tools=mcp_tools,           # banking tools through BFF /internal/agent-tool
    checkpointer=MemorySaver(),
)

async def run(user_msg: str, thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    async for event in agent.astream(
        {"messages": [HumanMessage(content=user_msg)]},
        config=config,
    ):
        yield event  # mapped to AG-UI SSE by the FastAPI /run handler
`;

/** Demo-primary brains (agent mode picker). provider matches status.provider when set. */
const DEMO_BRAINS = [
  {
    id: "heuristics",
    label: "Heuristics",
    provider: null,
    package: "— (BFF NL parser)",
    defaultModel: "n/a",
    notes: "Deterministic NL → tool path; no API key",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    provider: "google",
    package: "langchain-google-genai",
    defaultModel: "gemini-2.0-flash",
    notes: "Fast cloud LLM for SE demos — GOOGLE / Gemini key",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    provider: "llamacpp",
    package: "langchain-openai (OpenAI-compat)",
    defaultModel: "via demo_llm_proxy :8090",
    notes: "Local GGUF through LLM proxy — no cloud key",
  },
];

const ALL_FRAMEWORKS = [
  ["langchain_agent", "LangChain / LangGraph", "8888", "Default — llm_framework=langchain"],
  ["openai_agent", "OpenAI Agents SDK", "8891", "llm_framework=openai_agents"],
  ["mastra_agent", "Mastra", "8892", "llm_framework=mastra"],
  ["pydantic_agent", "Pydantic AI", "8893", "llm_framework=pydantic_ai"],
  ["llamaindex_agent", "LlamaIndex", "8894", "RAG profile — not llm_framework"],
  ["compliance_agent", "Compliance (Pydantic AI)", "3007", "AML specialist microservice"],
];

export default function LangChainPage() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch("/api/langchain/config/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => null);
  }, []);

  const activeProvider = status?.provider ?? null;
  const isHeuristic =
    !activeProvider || activeProvider === "heuristics" || activeProvider === "heuristic";

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
        Default banking AG-UI runtime (<code>langchain_agent</code> on :8888).
        Same Ping delegated-OAuth / MCP / Authorize / HITL model as the other
        frameworks — switch package with <code>llm_framework</code>, switch
        brain with the agent mode picker (Heuristics · Gemini · llama.cpp).
      </div>

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
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong>Active brain / provider:</strong>{" "}
          {status ? (
            <span>
              <code>{isHeuristic ? "heuristics" : activeProvider}</code>
              {!isHeuristic && (
                <>
                  {" "}
                  — model <code>{status.model}</code>
                </>
              )}
              {isHeuristic ? (
                <span style={{ color: "#555", marginLeft: 8, fontSize: 12 }}>
                  (no LLM key required)
                </span>
              ) : status.key_set?.[activeProvider] ? (
                <span style={{ color: "#2e7d32", marginLeft: 8 }}>
                  key set
                </span>
              ) : activeProvider === "llamacpp" ||
                activeProvider === "anthropic-lmstudio" ? (
                <span style={{ color: "#555", marginLeft: 8, fontSize: 12 }}>
                  (local)
                </span>
              ) : (
                <span style={{ color: "#c62828", marginLeft: 8, fontSize: 12 }}>
                  ⚠️ no key — set one in Config or the agent mode picker
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

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Architecture</h2>
        <p style={{ lineHeight: 1.6, color: "#333" }}>
          <code>langchain_agent</code> is a Python FastAPI service (AG-UI{" "}
          <code>/run</code> on port 8888). The BFF selects it when{" "}
          <code>llm_framework=langchain</code> (default) and forwards the
          session brain (provider + model) from{" "}
          <code>/api/langchain/config</code>. Tools execute through the BFF with
          the delegated Ping token — never with long-lived secrets in the
          browser.
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
          {`Browser  ──►  AIAgent  ──►  BFF
                           │  llm_framework + agent_mode (brain)
                           ├─►  langchain_agent :8888  (AG-UI SSE)
                           │      LangGraph / LCEL + llm_factory
                           └─►  /internal/agent-tool  ──►  MCP gateway
                                                          Ping Authorize`}
        </pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>LangGraph / LCEL pattern</h2>
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
          Source: <code>langchain_agent/</code> (AG-UI run handler + LLM factory).
          Framework comparison: Learn → Agent frameworks, or{" "}
          <code>AGENTS_ECOSYSTEM.md</code>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>
          Demo brains (Heuristics · Gemini · llama.cpp)
        </h2>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>
          These are the usual live-demo choices in the agent mode picker. Other
          modes (Helix, Anthropic, MLX, Groq) appear when configured — see{" "}
          <code>agentModes.js</code>.
        </p>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {["Brain", "Provider id", "Package / path", "Default model", "Notes"].map(
                (h) => (
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
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {DEMO_BRAINS.map((p, i) => {
              const active =
                (p.provider == null && isHeuristic) ||
                (p.provider != null && activeProvider === p.provider);
              return (
                <tr
                  key={p.id}
                  style={{
                    background: i % 2 === 0 ? "#fff" : "#fafafa",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                    {p.label}
                    {active && (
                      <span style={{ marginLeft: 6, color: "#1565c0" }}>
                        ← active
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                    <code>{p.provider ?? "null"}</code>
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                    <code>{p.package}</code>
                  </td>
                  <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
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
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>
          Security: Keys Stay Server-Side
        </h2>
        <p style={{ lineHeight: 1.6, color: "#333" }}>
          API keys live in <code>req.session.langchain_config</code> on the BFF
          only. <code>GET /api/langchain/config/status</code> returns boolean{" "}
          <code>key_set</code> flags — never key material. Same pattern as PingOne
          client secrets.
        </p>
      </section>

      <section style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>All agents we have</h2>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>
          Framework packages in this repo. Banking chat swaps among the first
          four via <code>llm_framework</code>; LlamaIndex and Compliance are
          separate services. Brains above are independent of which package runs.
        </p>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
        >
          <thead>
            <tr style={{ background: "#e8f5e9" }}>
              {["Directory", "Framework", "Port", "Role"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    borderBottom: "2px solid #c8e6c9",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_FRAMEWORKS.map((row, i) => (
              <tr
                key={row[0]}
                style={{
                  background: i % 2 === 0 ? "#fff" : "#fafafa",
                  fontWeight: row[0] === "langchain_agent" ? 600 : 400,
                }}
              >
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                  <code>{row[0]}</code>
                  {row[0] === "langchain_agent" && (
                    <span style={{ marginLeft: 6, color: "#2e7d32", fontSize: 12 }}>
                      this page
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                  {row[1]}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                  {row[2]}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid #eee",
                    color: "#555",
                  }}
                >
                  {row[3]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: "#666", marginTop: 12 }}>
          Full write-up: <code>AGENTS_ECOSYSTEM.md</code> · In-app: Learn → Agent
          frameworks (inventory).
        </p>
      </section>
    </div>
  );
}
