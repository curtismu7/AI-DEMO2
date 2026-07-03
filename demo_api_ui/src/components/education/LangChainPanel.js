// banking_api_ui/src/components/education/LangChainPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

const LCEL_SNIPPET = `# LangChain 0.3.x LCEL pattern
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

llm = ChatGroq(model="llama-3.1-8b-instant", api_key=groq_key)

# Bind tools so the model can call them
chain = prompt | llm.bind_tools(tools)

# Tool-calling loop
while True:
    result = await chain.ainvoke({"input": msg, "chat_history": hist})
    if not result.tool_calls:
        break
    # execute tools and append ToolMessage results…`;

const PROVIDER_TABLE = `| Provider   | Package                  | Default model              |
|------------|--------------------------|----------------------------|
| Groq       | langchain-groq           | llama-3.1-8b-instant       |
| OpenAI     | langchain-openai         | gpt-4o-mini                |
| Anthropic  | langchain-anthropic      | claude-haiku-4-5-20251001  |
| Google AI  | langchain-google-genai   | gemini-2.0-flash           |
| LM Studio  | langchain-openai         | auto (local)               |`;

function OverviewContent() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>What is LangChain?</h3>
      <p>
        LangChain is an open-source framework for building LLM applications.{" "}
        <strong>LCEL (LangChain Expression Language)</strong> — a declarative
        pipe-syntax for composing prompts, models, tools and output parsers into
        streaming-first chains — was introduced in 2023, before the 0.1 release.
        This demo pins <strong>0.3.x</strong>; the current stable release is{" "}
        <strong>LangChain 1.x</strong> (GA Oct 2025), which recommends{" "}
        <code>create_agent</code> / LangGraph as the default agent pattern.
      </p>

      <h3>LCEL in one line</h3>
      <pre className="edu-code">{`chain = prompt | llm.bind_tools(tools)`}</pre>
      <p>
        <code>bind_tools</code> attaches your MCP tools to the LLM. The model decides which
        tools to call; you run the tool-calling loop yourself or let LangGraph manage it.
      </p>

      <h3>Model-agnostic by design</h3>
      <p>
        Each provider ships its own <code>langchain-*</code> package. You swap the LLM
        object — the rest of the chain stays the same.
      </p>
      <pre className="edu-code">{PROVIDER_TABLE}</pre>

      <h3>Security: keys stay on the server</h3>
      <p>
        In this demo, provider API keys are stored in the <strong>BFF session</strong> only
        (<code>req.session.langchain_config</code>). They are never included in API responses
        sent to the browser.
      </p>

      <p>
        <a href="/langchain" style={{ fontWeight: 600 }}>
          Full deep dive with live model indicator →
        </a>
      </p>
    </div>
  );
}

function LcelContent() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>LCEL — the new way to chain</h3>
      <p>
        Before 0.2.x, LangChain used <code>AgentExecutor + create_openai_functions_agent</code>.
        These are deprecated. The 0.3.x way (pinned in this demo) creates an LCEL
        runnable agent — though the current stable release, <strong>LangChain 1.x</strong>{" "}
        (GA Oct 2025), recommends <code>create_agent</code> / LangGraph as the default
        going forward:
      </p>
      <pre className="edu-code">{LCEL_SNIPPET}</pre>
      <h3>Why LCEL?</h3>
      <ul>
        <li>Streaming out of the box — every step yields deltas</li>
        <li>Works with any model that supports tool calling</li>
        <li>Composable — add output parsers, retry logic, fallbacks as pipe steps</li>
        <li>Testable — mock any pipe stage independently</li>
      </ul>
    </div>
  );
}

const tabs = [
  { id: 'overview', label: 'Overview', content: <OverviewContent /> },
  { id: 'lcel',     label: 'LCEL pattern', content: <LcelContent /> },
];

export default function LangChainPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="LangChain 0.3.x — LCEL + multi-provider"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(640px, 100vw)"
    />
  );
}
