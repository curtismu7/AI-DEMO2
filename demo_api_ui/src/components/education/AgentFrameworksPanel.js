// banking_api_ui/src/components/education/AgentFrameworksPanel.js
// Education panel — Agent Framework Comparison (LangChain, OpenAI Agents, Mastra, Pydantic AI)
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

function OverviewTab() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        This demo includes <strong>four production-ready agent frameworks</strong>, all
        serving the same banking assistant use case. They differ in language,
        LLM SDK, and reasoning approach — but are functionally equivalent from
        the UI perspective. The BFF (Express server) routes to whichever
        framework is configured via the <code>llm_framework</code> flag.
      </p>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>Why Four Frameworks?</h4>
      <ul style={{ marginBottom: 0.5 }}>
        <Bullet>
          <strong>Educational:</strong> Demonstrate the same agent workflow in
          different paradigms — LangGraph agentic loops, SDK-based (OpenAI
          Agents), declarative (Mastra), and dependency-injection-based
          (Pydantic AI).
        </Bullet>
        <Bullet>
          <strong>Performance comparison:</strong> Measure token usage, latency,
          and reasoning quality across frameworks for the same user request.
        </Bullet>
        <Bullet>
          <strong>Stack flexibility:</strong> Teams can pick the framework
          matching their existing infrastructure (Python LangChain shop? Use
          Langchain. TypeScript-first? Use Mastra.).
        </Bullet>
        <Bullet>
          <strong>Behavioral verification:</strong> Ensure agent responses are
          deterministic and framework-agnostic for the same user intent.
        </Bullet>
      </ul>

      <h4 style={{ marginTop: "1.2rem", marginBottom: 0.5 }}>
        Common Interface
      </h4>
      <p>
        All four frameworks expose the same <code>/run</code> HTTP endpoint,
        accepting this BFF payload:
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
        Each framework streams Server-Sent Events (SSE) back with the{" "}
        <strong>AG-UI event protocol</strong>: <code>on_run_start</code>,{" "}
        <code>on_llm_start</code>, <code>on_llm_token</code>,{" "}
        <code>on_tool_start</code>, <code>on_tool_end</code>,{" "}
        <code>on_run_end</code>, etc. The React UI is framework-agnostic.
      </p>
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

function ComparisonTab() {
  return (
    <>
      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>Feature Matrix</h4>

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
              ["Language", "Python", "Python", "TypeScript", "Python"],
              ["Port", "8888", "8891", "8892", "8893"],
              ["Conversation Memory", "✅ Built-in", "❌ BFF-managed", "❌ BFF-managed", "❌ BFF-managed"],
              ["Execution Tracing", "✅ Rich viz", "❌ Minimal", "❌ Minimal", "❌ Minimal"],
              ["Dependency Injection", "❌ No", "❌ No", "❌ No", "✅ Yes"],
              ["Multi-Provider LLM", "✅ OpenAI, Anthropic, Helix, OSS", "❌ OpenAI only", "✅ Vercel ai-sdk", "✅ Pydantic AI models"],
              ["Minimal Implementation", "❌ ~300+ lines", "✅ ~140 lines", "✅ ~80 lines", "⚠️ ~100 lines"],
              ["Type Safety", "⚠️ Python hints", "⚠️ Python hints", "✅ TypeScript", "✅ Pydantic models"],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#f8fafc" : "white" }}>
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

      <h4 style={{ marginTop: "1rem", marginBottom: 0.5 }}>How to Switch Frameworks</h4>
      <p style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        All frameworks are <strong>live and running simultaneously</strong>. To
        switch which one the BFF routes to:
      </p>
      <ol style={{ fontSize: "0.85rem", marginBottom: 0.5 }}>
        <li>Go to the <strong>/config</strong> page</li>
        <li>Scroll to <strong>"Agent LLM Framework"</strong></li>
        <li>
          Select <code>langchain</code>, <code>openai_agents</code>,{" "}
          <code>mastra</code>, or <code>pydantic_ai</code>
        </li>
        <li>
          Go to <strong>/dashboard</strong> and send a message — the BFF will
          route to the selected framework
        </li>
        <li>
          The <strong>EmbeddedAgentDock header</strong> displays the active
          framework name
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
tail -f /tmp/demo-api.log | grep -i "framework\\|agent\\|8888\\|8891\\|8892\\|8893"`}
      </Code>
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
    { id: "comparison", label: "Comparison", content: <ComparisonTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Frameworks"
      description="Compare four production-ready agent frameworks (LangChain, OpenAI Agents, Mastra, Pydantic AI)"
      tabs={tabConfig}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}

export default AgentFrameworksPanel;