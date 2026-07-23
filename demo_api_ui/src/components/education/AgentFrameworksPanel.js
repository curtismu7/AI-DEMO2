// demo_api_ui/src/components/education/AgentFrameworksPanel.js
// Education panel — agent frameworks + inventory (LangChain, OpenAI, Mastra, Pydantic AI, LlamaIndex, compliance)
// Brains: Heuristics / Gemini / llama.cpp (see AllAgentsInventory).
import React, { useState } from "react";
import EducationDrawer from "../shared/EducationDrawer";

const Code = ({ children }) => (
  <code
    style={{
      display: "block",
      background: "var(--code-bg, #f1f5f9)",
      borderRadius: 6,
      padding: "0.75rem 1rem",
      fontFamily: "inherit",
      fontSize: "0.78rem",
      whiteSpace: "pre",
      overflowX: "auto",
      margin: "0.5rem 0",
    }}
  >
    {children}
  </code>
);

function FrameworkCard({ name, language, port, color = "#1e3a5f", children }) {
  return (
    <div
      style={{
        borderLeft: `4px solid ${color}`,
        background: "#f8fafc",
        borderRadius: "0 8px 8px 0",
        padding: "12px 16px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <strong style={{ fontSize: "0.95rem", color }}>{name}</strong>
        <span
          style={{
            fontSize: "0.68rem",
            background: color + "20",
            color,
            border: `1px solid ${color}60`,
            borderRadius: 99,
            padding: "1px 8px",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {language}
        </span>
        <span
          style={{
            fontSize: "0.68rem",
            background: "#94a3b8",
            color: "#f1f5f9",
            border: `1px solid #64748b`,
            borderRadius: 99,
            padding: "1px 8px",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          Port {port}
        </span>
      </div>
      {children}
    </div>
  );
}

function Bullet({ children }) {
  return (
    <li style={{ marginBottom: 4, fontSize: "0.85rem", lineHeight: 1.55 }}>
      {children}
    </li>
  );
}

/** Inventory table — frameworks + demo LLM brains (kept at bottom of Overview). */
function AllAgentsInventory() {
  const frameworks = [
    ["langchain_agent", "LangChain / LangGraph", "Python", "8888", "Default banking AG-UI runtime (`llm_framework=langchain`)"],
    ["openai_agent", "OpenAI Agents SDK", "Python", "8891", "Lightweight AG-UI variant (`openai_agents`)"],
    ["mastra_agent", "Mastra", "TypeScript", "8892", "TS AG-UI variant (`mastra`)"],
    ["pydantic_agent", "Pydantic AI", "Python", "8893", "DI / type-safe AG-UI variant (`pydantic_ai`)"],
    ["llamaindex_agent", "LlamaIndex", "Python", "8894", "RAG / codebase Q&A (`rag` Compose profile)"],
    ["compliance_agent", "Compliance (Pydantic AI)", "Python", "3007", "Specialist AML / risk microservice — not the banking chat brain"],
  ];
  const brains = [
    ["Heuristics", "Deterministic NL → tool path (no LLM required)"],
    ["Google Gemini", "Fast cloud LLM for SE demos (`gemini` / provider `google`)"],
    ["llama.cpp", "Local models via `demo_llm_proxy` :8090 (`llamacpp`)"],
  ];
  const th = { textAlign: "left", padding: "6px 8px", border: "1px solid #cbd5e1", background: "#e2e8f0" };
  const td = { padding: "6px 8px", border: "1px solid #cbd5e1", fontSize: "0.75rem" };
  return (
    <>
      <h4 style={{ marginTop: "1.6rem", marginBottom: 0.5 }}>All agents in this repo</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        Framework packages under the repo root. Banking chat switches among the
        first four via the <code>llm_framework</code> flag; LlamaIndex and
        Compliance are separate services.
      </p>
      <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
          <thead>
            <tr>
              <th style={th}>Directory</th>
              <th style={th}>Framework</th>
              <th style={th}>Lang</th>
              <th style={th}>Port</th>
              <th style={th}>Role</th>
            </tr>
          </thead>
          <tbody>
            {frameworks.map((row, i) => (
              <tr key={row[0]} style={{ background: i % 2 === 0 ? "#f8fafc" : "white" }}>
                <td style={td}><code>{row[0]}</code></td>
                <td style={td}>{row[1]}</td>
                <td style={td}>{row[2]}</td>
                <td style={td}>{row[3]}</td>
                <td style={td}>{row[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Demo LLM brains (agent mode picker)</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        Orthogonal to framework: same agent package can run under different
        brains. Primary demo set:
      </p>
      <ul style={{ marginBottom: 0.5 }}>
        {brains.map(([name, blurb]) => (
          <Bullet key={name}>
            <strong>{name}</strong> — {blurb}
          </Bullet>
        ))}
      </ul>
      <p style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 0 }}>
        Other picker modes (MLX, Anthropic, Helix, Groq) exist in{" "}
        <code>agentModes.js</code> when configured; Heuristics / Gemini /
        llama.cpp are the usual live-demo trio.
      </p>
    </>
  );
}

function OverviewTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        This demo ships <strong>five agent framework packages</strong> for the
        banking assistant AG-UI path (LangChain, OpenAI Agents, Mastra, Pydantic
        AI, plus LlamaIndex for RAG) and a separate{" "}
        <strong>compliance_agent</strong> microservice. The four{" "}
        <code>llm_framework</code> enum values (
        <code>langchain</code>, <code>openai_agents</code>, <code>mastra</code>,{" "}
        <code>pydantic_ai</code>) select which AG-UI runtime the BFF calls for{" "}
        <code>POST /api/agent/run</code>. Brain selection (Heuristics / Gemini /
        llama.cpp) is independent via the agent mode picker.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Why multiple frameworks?</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>Educational:</strong> Same banking workflow in LangGraph
          loops, OpenAI Agents SDK, Mastra (TS), Pydantic AI DI, and LlamaIndex
          retrieval.
        </Bullet>
        <Bullet>
          <strong>Performance comparison:</strong> Measure token usage, latency,
          and reasoning quality across frameworks for the same user request.
        </Bullet>
        <Bullet>
          <strong>Stack flexibility:</strong> Pick the package that matches the
          customer stack (Python LangChain shop vs TypeScript Mastra).
        </Bullet>
        <Bullet>
          <strong>Behavioral verification:</strong> Ping controls (token
          exchange, Authorize, HITL) stay the same regardless of framework.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>
        Common AG-UI interface
      </h4>
      <p>
        LangChain, OpenAI Agents, Mastra, and Pydantic AI expose the same{" "}
        <code>/run</code> HTTP endpoint, accepting this BFF payload:
      </p>
      <Code>
        {`{
  threadId: string,
  runId: string,
  messages: [{role, content}, ...],
  tools: [{name, description, inputSchema}, ...],
  context: {
    bffToolUrl: string,      // Where to call /internal/agent-tool
    bffInternalSecret: string, // Auth for tool calls
    sessionId: string,       // User session
    model?: string           // Per-run LLM override
  },
  vertical_flavor?: string   // System prompt override (e.g., "Care Connect")
}`}
      </Code>

      <p style={{ marginTop: 0.8 }}>
        Each AG-UI framework streams Server-Sent Events (SSE) with the{" "}
        <strong>AG-UI event protocol</strong>: <code>on_run_start</code>,{" "}
        <code>on_llm_start</code>, <code>on_llm_token</code>,{" "}
        <code>on_tool_start</code>, <code>on_tool_end</code>,{" "}
        <code>on_run_end</code>, etc. The React UI is framework-agnostic.
      </p>

      <AllAgentsInventory />
    </>
  );
}

function LangChainTab() {
  return (
    <>
      <FrameworkCard
        name="LangChain MCP Agent"
        language="Python 3.11+"
        port="8888"
        color="#00d084"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Most feature-rich.</strong> Stateful agent with conversation
          memory, real-time execution tracing, and visualization.
        </p>
      </FrameworkCard>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Architecture</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          Uses <code>langgraph.prebuilt.create_react_agent()</code> for agentic
          loop (ReAct pattern: Thought → Action → Observation).
        </Bullet>
        <Bullet>
          <strong>LLM factory:</strong> Supports multiple providers (OpenAI,
          Anthropic, Helix, open-source via LLM Studio).
        </Bullet>
        <Bullet>
          <strong>MCP client manager:</strong> Dedicated component for
          WebSocket-based tool calls with OAuth token handling.
        </Bullet>
        <Bullet>
          <strong>Conversation memory:</strong> Built-in history + context
          windowing for multi-turn conversations.
        </Bullet>
        <Bullet>
          <strong>Execution tracing:</strong> Real-time visualization of agent
          reasoning steps, tool calls, and token usage.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Sample Code</h4>
      <Code>
        {`from langgraph.prebuilt import create_react_agent
from langchain_core.tools import tool

agent = create_react_agent(
  llm=llm,
  tools=[mcp_tool_provider.get_tools()],
  checkpointer=MemorySaver()  # Conversation memory
)

# Stream agent loop
config = RunnableConfig(configurable={"thread_id": thread_id})
for event in agent.stream(
  {"messages": [HumanMessage(content=user_input)]},
  config=config
):
  # Emit AG-UI events from each event type`}
      </Code>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>When to Use</h4>
      <ul>
        <Bullet>
          Python-first team with deep LangChain expertise.
        </Bullet>
        <Bullet>
          Need conversation memory, execution tracing, or complex agentic loops.
        </Bullet>
        <Bullet>
          Willing to manage Python environment and uvicorn deployment.
        </Bullet>
      </ul>
    </>
  );
}

function OpenAIAgentsTab() {
  return (
    <>
      <FrameworkCard
        name="OpenAI Agents SDK"
        language="Python 3.11+"
        port="8891"
        color="#14b8a6"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Lightweight and simple.</strong> Minimal state, stream-based
          execution, minimal dependencies.
        </p>
      </FrameworkCard>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Architecture</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          Uses OpenAI's <code>agents.Agent</code> + <code>agents.Runner.run_streamed()</code> for
          unified tool-call streaming.
        </Bullet>
        <Bullet>
          <strong>No conversation memory:</strong> Stateless per run. BFF
          manages message history.
        </Bullet>
        <Bullet>
          <strong>Stream events:</strong> Maps
          <code>RawResponsesStreamEvent</code> (text deltas) and{" "}
          <code>RunItemStreamEvent</code> (tool calls) to AG-UI events.
        </Bullet>
        <Bullet>
          <strong>Simplest implementation:</strong> ~140 lines in{" "}
          <code>run_handler.py</code> with minimal boilerplate.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Sample Code</h4>
      <Code>
        {`from agents import Agent, OpenAIChatCompletionsModel

agent = Agent(
  name="BankingAssistant",
  instructions=system_prompt,
  model=OpenAIChatCompletionsModel(
    model=model,
    openai_client=client
  ),
  tools=bff_tools
)

result = agents.Runner.run_streamed(agent, user_input)
async for event in result.stream_events():
  # Handle SDK events → AG-UI emitter`}
      </Code>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>When to Use</h4>
      <ul>
        <Bullet>
          Want the <strong>simplest possible implementation</strong> with
          minimal dependencies.
        </Bullet>
        <Bullet>
          Exclusively using OpenAI API (GPT-5.5, etc.).
        </Bullet>
        <Bullet>
          Stateless agent is acceptable (conversation history managed by BFF).
        </Bullet>
      </ul>
    </>
  );
}

function MastraTab() {
  return (
    <>
      <FrameworkCard
        name="Mastra Agent"
        language="TypeScript 5.x"
        port="8892"
        color="#0891b2"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Modern TypeScript.</strong> Declarative agent definition,
          Vercel <code>ai-sdk</code> integration, Express server.
        </p>
      </FrameworkCard>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Architecture</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          Uses <code>@mastra/core/agent</code> with Vercel's{" "}
          <code>ai-sdk/openai</code> provider abstraction.
        </Bullet>
        <Bullet>
          <strong>Express-based:</strong> Single endpoint{" "}
          <code>app.post('/run')</code> handles stream routing directly.
        </Bullet>
        <Bullet>
          <strong>No conversation memory:</strong> Lightweight stream adapter.
        </Bullet>
        <Bullet>
          <strong>Concise TypeScript:</strong> ~80 lines in{" "}
          <code>runHandler.ts</code>.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Sample Code</h4>
      <Code>
        {`import { Agent } from '@mastra/core/agent';

const agent = new Agent({
  tools: toolMap,
  name: 'BankingAssistant',
  instructions: systemPrompt,
  model: createOpenAI({
    apiKey: cfg.llmApiKey,
    baseURL: cfg.llmBaseUrl
  })
});

const stream = await agent.stream(userMessage);
for await (const chunk of stream.textStream) {
  emitter.onLlmToken(chunk);
}`}
      </Code>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>When to Use</h4>
      <ul>
        <Bullet>
          TypeScript-first team comfortable with Node.js + Express.
        </Bullet>
        <Bullet>
          Want modern, clean syntax with minimal boilerplate.
        </Bullet>
        <Bullet>
          Open to exploring Mastra's ecosystem (workflows, integrations).
        </Bullet>
      </ul>
    </>
  );
}

function PydanticAITab() {
  return (
    <>
      <FrameworkCard
        name="Pydantic AI"
        language="Python 3.11+"
        port="8893"
        color="#8b5cf6"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Dependency-injection model.</strong> Functional async-first
          design with Pydantic's type safety.
        </p>
      </FrameworkCard>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Architecture</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          Uses <code>Agent.run_stream()</code> context manager with{" "}
          <code>deps</code> injection for tool execution context.
        </Bullet>
        <Bullet>
          <strong>Dependency injection pattern:</strong> Tool functions receive{" "}
          <code>deps: BffDeps</code> containing bffToolUrl, sessionId, etc.
        </Bullet>
        <Bullet>
          <strong>SSE emitter queuing:</strong> Automatic buffering of events
          before yielding to client.
        </Bullet>
        <Bullet>
          <strong>Middle ground:</strong> More structured than OpenAI Agents,
          simpler than LangChain.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Sample Code</h4>
      <Code>
        {`from pydantic_ai import Agent

agent = Agent(
  model=model_name,
  system_prompt=system_prompt,
  tools=[tool_func1, tool_func2, ...]
)

async with agent.run_stream(
  user_message,
  deps=BffDeps(bff_tool_url=..., session_id=...)
) as result:
  async for text in result.stream_text(delta=True):
    emitter.on_text_token(text)`}
      </Code>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>When to Use</h4>
      <ul>
        <Bullet>
          Python team wanting type-safe, function-driven agent design.
        </Bullet>
        <Bullet>
          Prefer dependency injection over global state or conversation memory.
        </Bullet>
        <Bullet>
          Like Pydantic's ecosystem (validation, serialization, BaseModel).
        </Bullet>
      </ul>
    </>
  );
}

function LlamaIndexTab() {
  return (
    <>
      <FrameworkCard
        name="LlamaIndex Agent"
        language="Python 3.11+"
        port="8894"
        color="#f59e0b"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>RAG / codebase Q&amp;A.</strong> Retrieval over Weaviate +
          embeddings (<code>rag</code> Compose profile). Not selected via{" "}
          <code>llm_framework</code> — called for code-search style asks.
        </p>
      </FrameworkCard>
      <ul>
        <Bullet>
          Directory: <code>llamaindex_agent/</code> — FastAPI{" "}
          <code>/ask</code> + <code>/health</code> on port 8894.
        </Bullet>
        <Bullet>
          Backed by Weaviate + the embeddings llama.cpp container when the{" "}
          <code>rag</code> profile is up.
        </Bullet>
        <Bullet>
          Complements the banking AG-UI agents; same Ping session story when
          tools hit MCP through the BFF.
        </Bullet>
      </ul>
    </>
  );
}

function ComplianceTab() {
  return (
    <>
      <FrameworkCard
        name="Compliance Agent"
        language="Python · Pydantic AI"
        port="3007"
        color="#dc2626"
      >
        <p style={{ margin: "8px 0", fontSize: "0.85rem", color: "#64748b" }}>
          <strong>Specialist microservice.</strong> Transaction AML / risk
          scoring — not a drop-in replacement for the banking chat agent.
        </p>
      </FrameworkCard>
      <ul>
        <Bullet>
          Directory: <code>compliance_agent/</code> — FastAPI + Pydantic AI
          structured <code>ComplianceCheck</code> outputs.
        </Bullet>
        <Bullet>
          BFF bridge routes under <code>/api/compliance-agent/*</code> when the
          service is running (<code>COMPLIANCE_PORT=3007</code>).
        </Bullet>
        <Bullet>
          Demonstrates a second Pydantic AI deployment pattern: typed risk
          assessment beside the AG-UI banking runtime on 8893.
        </Bullet>
      </ul>
    </>
  );
}

function ComparisonTab() {
  return (
    <>
      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>
        Feature matrix (banking AG-UI runtimes)
      </h4>

      <div
        style={{
          overflowX: "auto",
          marginBottom: "1rem",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.75rem",
            lineHeight: 1.4,
          }}
        >
          <thead>
            <tr style={{ background: "#e2e8f0" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", border: "1px solid #cbd5e1" }}>
                Feature
              </th>
              <th style={{ textAlign: "center", padding: "6px 8px", border: "1px solid #cbd5e1" }}>
                LangChain
              </th>
              <th style={{ textAlign: "center", padding: "6px 8px", border: "1px solid #cbd5e1" }}>
                OpenAI Agents
              </th>
              <th style={{ textAlign: "center", padding: "6px 8px", border: "1px solid #cbd5e1" }}>
                Mastra
              </th>
              <th style={{ textAlign: "center", padding: "6px 8px", border: "1px solid #cbd5e1" }}>
                Pydantic AI
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Directory", "langchain_agent", "openai_agent", "mastra_agent", "pydantic_agent"],
              ["Language", "Python", "Python", "TypeScript", "Python"],
              ["Port", "8888", "8891", "8892", "8893"],
              ["Conversation Memory", "✅ Built-in", "❌ BFF-managed", "❌ BFF-managed", "❌ BFF-managed"],
              ["Execution Tracing", "✅ Rich viz", "❌ Minimal", "❌ Minimal", "❌ Minimal"],
              ["Dependency Injection", "❌ No", "❌ No", "❌ No", "✅ Yes"],
              ["Multi-Provider LLM", "✅ OpenAI, Anthropic, Helix, OSS", "❌ OpenAI only", "✅ Vercel ai-sdk", "✅ Pydantic AI models"],
              ["Minimal Implementation", "❌ ~300+ lines", "✅ ~140 lines", "✅ ~80 lines", "⚠️ ~100 lines"],
              ["Type Safety", "⚠️ Python hints", "⚠️ Python hints", "✅ TypeScript", "✅ Pydantic models"],
            ].map((row, i) => (
              <tr key={row[0]} style={{ background: i % 2 === 0 ? "#f8fafc" : "white" }}>
                <td style={{ padding: "6px 8px", border: "1px solid #cbd5e1", fontWeight: 500 }}>
                  {row[0]}
                </td>
                <td style={{ padding: "6px 8px", border: "1px solid #cbd5e1", textAlign: "center" }}>
                  {row[1]}
                </td>
                <td style={{ padding: "6px 8px", border: "1px solid #cbd5e1", textAlign: "center" }}>
                  {row[2]}
                </td>
                <td style={{ padding: "6px 8px", border: "1px solid #cbd5e1", textAlign: "center" }}>
                  {row[3]}
                </td>
                <td style={{ padding: "6px 8px", border: "1px solid #cbd5e1", textAlign: "center" }}>
                  {row[4]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.85rem" }}>
        Also in-repo: <code>llamaindex_agent</code> (:8894, RAG) and{" "}
        <code>compliance_agent</code> (:3007, AML specialist). See Overview →{" "}
        <strong>All agents in this repo</strong>.
      </p>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>How to Switch Frameworks</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        AG-UI frameworks can run under the Compose <code>agents</code> profile.
        To switch which one the BFF routes to:
      </p>
      <ol style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <li>Go to the <strong>/config</strong> page</li>
        <li>Scroll to <strong>"Agent LLM Framework"</strong> (<code>llm_framework</code>)</li>
        <li>
          Select <code>langchain</code>, <code>openai_agents</code>,{" "}
          <code>mastra</code>, or <code>pydantic_ai</code>
        </li>
        <li>
          Pick a brain in the agent header — demo trio:{" "}
          <strong>Heuristics</strong>, <strong>Gemini</strong>,{" "}
          <strong>llama.cpp</strong>
        </li>
        <li>
          Send a message on the dashboard — BFF routes to the selected framework
        </li>
      </ol>

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Debugging</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        Check which framework is active:
      </p>
      <Code>
        {`# Browser DevTools → Network → /api/agent/invoke
# Response headers → X-Agent-Framework: langchain

# Or from CLI:
curl https://api.ping.demo:3001/api/admin/feature-flags \\
  -H "Cookie: connect.sid=..." | jq '.flags[] | select(.id=="llm_framework")'

# Or in /tmp logs:
tail -f /tmp/demo-api.log | grep -i "framework\\|agent\\|8888\\|8891\\|8892\\|8893\\|8894"`}
      </Code>

      <AllAgentsInventory />
    </>
  );
}

function AgentFrameworksPanel({ isOpen, onClose, initialTabId }) {
  const [tab, setTab] = useState(initialTabId || "overview");

  const tabConfig = [
    { id: "overview", label: "Overview", content: <OverviewTab /> },
    { id: "langchain", label: "LangChain", content: <LangChainTab /> },
    { id: "openai", label: "OpenAI Agents", content: <OpenAIAgentsTab /> },
    { id: "mastra", label: "Mastra", content: <MastraTab /> },
    { id: "pydantic", label: "Pydantic AI", content: <PydanticAITab /> },
    { id: "llamaindex", label: "LlamaIndex", content: <LlamaIndexTab /> },
    { id: "compliance", label: "Compliance", content: <ComplianceTab /> },
    { id: "comparison", label: "Comparison", content: <ComparisonTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Frameworks"
      description="Banking AG-UI frameworks (LangChain, OpenAI Agents, Mastra, Pydantic AI), LlamaIndex RAG, compliance specialist — plus Heuristics / Gemini / llama.cpp brains"
      tabs={tabConfig}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}

export default AgentFrameworksPanel;