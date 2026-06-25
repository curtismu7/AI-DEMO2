// banking_api_ui/src/components/education/AgentBuilderLandscapePanel.js
// Education drawer — Agent Builder Landscape (LangChain, Open-Source, Commercial, Comparison)
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

/* ── Shared helpers ─────────────────────────────────────────────────────── */

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

function FrameworkCard({
  name,
  category,
  tagline,
  color = "var(--brand-navy)",
  children,
}) {
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
          gap: 8,
          marginBottom: 4,
        }}
      >
        <strong style={{ fontSize: "0.95rem", color: "#1e3a5f" }}>
          {name}
        </strong>
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
          {category}
        </span>
      </div>
      <p
        style={{
          margin: "0 0 8px",
          fontStyle: "italic",
          color: "#64748b",
          fontSize: "0.83rem",
        }}
      >
        {tagline}
      </p>
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

/* ── Tab content components ─────────────────────────────────────────────── */

function LangChainContent() {
  return (
    <>
      <p style={{ marginTop: 0 }}>
        <strong>LangChain</strong> is the most widely adopted open-source
        framework for building LLM-powered applications and agents. It provides
        composable primitives — chains, agents, tools, memory — that work with
        any LLM provider. The Super Banking demo's <code>langchain_agent/</code>{" "}
        uses LangChain 0.3.x to orchestrate the Banking Agent's tool calls via
        LCEL.
      </p>

      <h4 style={{ color: "#1e3a5f", marginBottom: 6 }}>
        1. LCEL — LangChain Expression Language
      </h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          Pipe syntax for composing chains:{" "}
          <code>chain = prompt | llm | parser</code>
        </Bullet>
        <Bullet>
          Lazy evaluation — chains are DAGs, not eager function calls
        </Bullet>
        <Bullet>Built-in streaming, batching, and async support</Bullet>
        <Bullet>
          Replaces the older <code>LLMChain</code> /{" "}
          <code>SequentialChain</code> API
        </Bullet>
      </ul>
      <Code>{`from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

prompt = ChatPromptTemplate.from_template("Answer: {question}")
llm = ChatOpenAI(model="gpt-4o")
chain = prompt | llm          # LCEL pipe
result = chain.invoke({"question": "What is RFC 8693?"})`}</Code>

      <h4 style={{ color: "#1e3a5f", marginBottom: 6 }}>
        2. Agents &amp; Tool Use
      </h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          Agents decide which tool to call based on the LLM's output
        </Bullet>
        <Bullet>
          Tool: any Python function decorated with <code>@tool</code> or wrapped
          in <code>Tool()</code>
        </Bullet>
        <Bullet>
          ReAct pattern: Reason → Act → Observe loop (default for{" "}
          <code>create_react_agent</code>)
        </Bullet>
        <Bullet>
          This demo uses <code>create_tool_calling_agent</code> (LangChain 0.3.x
          recommended pattern)
        </Bullet>
      </ul>
      <Code>{`from langchain.agents import create_react_agent, AgentExecutor
from langchain_core.tools import tool

@tool
def get_balance(account_id: str) -> str:
    """Get the balance for a given account."""
    return "£4,250.00"

agent = create_react_agent(llm, [get_balance], prompt)
executor = AgentExecutor(agent=agent, tools=[get_balance])
executor.invoke({"input": "What is my balance?"})`}</Code>

      <h4 style={{ color: "#1e3a5f", marginBottom: 6 }}>
        3. LangGraph — Stateful Agent Workflows
      </h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          Graph-based state machine for multi-step, multi-agent workflows
        </Bullet>
        <Bullet>
          Nodes = functions/agents; Edges = conditional transitions
        </Bullet>
        <Bullet>
          Supports cycles (loops), persistence (checkpointers),
          human-in-the-loop
        </Bullet>
        <Bullet>
          Key concepts: <code>StateGraph</code>, <code>MessagesState</code>,{" "}
          <code>interrupt_before</code>, <code>MemorySaver</code>
        </Bullet>
        <Bullet>
          Supersedes older <code>AgentExecutor</code> for complex workflows
        </Bullet>
      </ul>

      <h4 style={{ color: "#1e3a5f", marginBottom: 6 }}>
        4. LangSmith — Observability &amp; Evaluation
      </h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          Tracing: every LLM call, tool call, and chain step logged with latency
          + tokens
        </Bullet>
        <Bullet>
          Evaluation: run datasets through chains, score outputs, regression
          test
        </Bullet>
        <Bullet>Playground: interactive prompt iteration in the UI</Bullet>
        <Bullet>
          Requires <code>LANGCHAIN_API_KEY</code> and{" "}
          <code>LANGCHAIN_TRACING_V2=true</code>
        </Bullet>
      </ul>

      <h4 style={{ color: "#1e3a5f", marginBottom: 6 }}>
        5. LangServe — Deployment
      </h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          Turns any LangChain chain/agent into a FastAPI endpoint with one
          decorator
        </Bullet>
        <Bullet>
          Auto-generates <code>/invoke</code>, <code>/stream</code>,{" "}
          <code>/batch</code>, <code>/stream_log</code> routes
        </Bullet>
        <Bullet>
          Being superseded by LangGraph Platform for production deployments
        </Bullet>
      </ul>

      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          padding: "10px 14px",
          fontSize: "0.82rem",
          marginTop: 12,
        }}
      >
        <strong>Version note:</strong> LangChain 0.3.x split into{" "}
        <code>langchain-core</code> (stable primitives),
        <code>langchain</code> (agent abstractions),{" "}
        <code>langchain-community</code> (integrations), and provider packages
        like <code>langchain-openai</code>, <code>langchain-groq</code>,{" "}
        <code>langchain-google-genai</code>. Import paths changed significantly
        from 0.1.x. This demo uses 0.3.x.
      </div>
    </>
  );
}

function OpenSourceContent() {
  return (
    <>
      <p
        style={{
          marginTop: 0,
          marginBottom: 16,
          color: "#4b5563",
          fontSize: "0.87rem",
        }}
      >
        Open-source agent builder alternatives to LangChain — each with a
        distinct philosophy and primary use case.
      </p>

      <FrameworkCard
        name="LlamaIndex"
        category="RAG & data-first agents"
        tagline="Turn your data into AI-queryable knowledge"
        color="#f97316"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: connecting LLMs to data sources (PDFs, databases, APIs, web).
            Best-in-class for RAG pipelines.
          </Bullet>
          <Bullet>
            Key primitives: <code>VectorStoreIndex</code>,{" "}
            <code>QueryEngine</code>, <code>RouterQueryEngine</code>,{" "}
            <code>SubQuestionQueryEngine</code>
          </Bullet>
          <Bullet>
            Agents: <code>FunctionCallingAgent</code>, <code>ReActAgent</code> —
            tool use on top of indexed data
          </Bullet>
          <Bullet>
            2024+ evolution: <code>llama-index-core</code> split; LlamaCloud for
            managed indexes
          </Bullet>
          <Bullet>
            Best for: document Q&amp;A, knowledge bases, enterprise data agents
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Microsoft AutoGen"
        category="Multi-agent conversation"
        tagline="Orchestrate multiple AI agents in collaborative conversations"
        color="var(--brand-navy)"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: multi-agent systems where agents converse with each other to
            solve tasks
          </Bullet>
          <Bullet>
            Key primitives: <code>ConversableAgent</code>,{" "}
            <code>AssistantAgent</code>, <code>UserProxyAgent</code>,{" "}
            <code>GroupChat</code>
          </Bullet>
          <Bullet>
            Unique: agents can execute code (Python, shell) in sandboxed
            environments
          </Bullet>
          <Bullet>
            AutoGen 0.4+: redesigned with <code>AutoGen Core</code> for
            event-driven agent networks
          </Bullet>
          <Bullet>
            Best for: data analysis pipelines, code generation, research
            workflows with multiple collaborating agents
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="CrewAI"
        category="Role-based multi-agent orchestration"
        tagline="Crews of AI agents with roles, goals, and tasks"
        color="#7c3aed"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: structured teams — define Agents with roles (researcher,
            writer, analyst), assign Tasks, assemble into a Crew
          </Bullet>
          <Bullet>
            Key primitives: <code>Agent(role=, goal=, backstory=)</code>,{" "}
            <code>Task(description=, agent=)</code>,{" "}
            <code>Crew(agents=, tasks=, process=)</code>
          </Bullet>
          <Bullet>
            Processes: Sequential (linear), Hierarchical (manager delegates),
            Parallel
          </Bullet>
          <Bullet>
            CrewAI Enterprise: hosted control plane with triggers and monitoring
          </Bullet>
          <Bullet>
            Best for: content pipelines, research-to-report workflows,
            long-horizon tasks with clear role separation
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Haystack"
        category="NLP pipeline framework"
        tagline="Production-ready NLP pipelines since before LLMs existed"
        color="#0d9488"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: modular pipeline graphs with Components; strong NLP roots
            (QA, summarization, NER)
          </Bullet>
          <Bullet>
            Key primitives: <code>Pipeline</code>, <code>Component</code>,{" "}
            <code>Generator</code>, <code>Retriever</code>,{" "}
            <code>DocumentStore</code>
          </Bullet>
          <Bullet>
            Haystack 2.0 (2024): fully redesigned; async-first, typed
            dataclasses, YAML serializable pipelines
          </Bullet>
          <Bullet>
            Integrations: Weaviate, Qdrant, OpenSearch, Elasticsearch, PgVector
          </Bullet>
          <Bullet>
            Best for: production NLP/RAG pipelines; teams wanting declarative,
            serializable pipeline definitions
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="HuggingFace smolagents"
        category="Lightweight code-executing agents"
        tagline="Minimal, transparent agents that run HuggingFace models"
        color="#d97706"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: agents that write and execute Python code to solve tasks
            (Code Agent pattern)
          </Bullet>
          <Bullet>
            Key primitives: <code>CodeAgent</code>,{" "}
            <code>ToolCallingAgent</code>, <code>Tool</code>,{" "}
            <code>HfApiModel</code>
          </Bullet>
          <Bullet>
            Philosophy: agents write Python snippets as actions — more flexible
            but requires a sandboxed execution environment
          </Bullet>
          <Bullet>
            Best for: research, learning agent internals, HuggingFace
            model-centric workflows
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Phidata / Agno"
        category="Full-stack agent framework"
        tagline="Agents with memory, knowledge, tools, and reasoning baked in"
        color="var(--brand-navy)"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Focus: production agents with built-in memory (PostgreSQL/SQLite),
            knowledge bases (PDFs, URLs, tables), structured outputs
          </Bullet>
          <Bullet>Phidata rebranded to Agno in early 2025</Bullet>
          <Bullet>
            Key primitives:{" "}
            <code>Agent(model=, tools=, knowledge=, storage=)</code>,{" "}
            <code>Team</code> for multi-agent
          </Bullet>
          <Bullet>
            Best for: full-stack agents that need persistent memory + knowledge
            base without assembling primitives manually
          </Bullet>
        </ul>
      </FrameworkCard>
    </>
  );
}

function CommercialContent() {
  return (
    <>
      <p
        style={{
          marginTop: 0,
          marginBottom: 16,
          color: "#4b5563",
          fontSize: "0.87rem",
        }}
      >
        Cloud-hosted and enterprise agent builder platforms — managed
        infrastructure with platform-specific integrations.
      </p>

      <FrameworkCard
        name="AWS Bedrock Agents"
        category="Managed cloud agent service"
        tagline="Build agents without managing infrastructure — AWS-native"
        color="#f97316"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Action Groups (Lambda-backed tool definitions), Knowledge Bases (S3
            + OpenSearch RAG), Guardrails (content safety)
          </Bullet>
          <Bullet>
            Agent collaboration: multi-agent orchestration via supervisor agents
            (2024)
          </Bullet>
          <Bullet>
            Model choice: Claude, Llama, Titan, Mistral via Amazon Bedrock
          </Bullet>
          <Bullet>
            Auth: IAM-native — cross-account agent invocation via resource-based
            policies
          </Bullet>
          <Bullet>
            Best for: AWS shops; compliance-heavy orgs (FedRAMP, HIPAA, SOC 2)
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Microsoft Copilot Studio"
        category="Low-code agent builder"
        tagline="Build custom copilots — from no-code to pro-code"
        color="var(--brand-navy)"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Generative AI topics (GPT-4o backbone), Plugin actions (OpenAPI
            connectors), Power Automate flows
          </Bullet>
          <Bullet>
            MCP support added 2025; publish to Teams, web, phone; autonomous
            triggers
          </Bullet>
          <Bullet>
            Enterprise features: DLP policies, Azure AD integration, audit logs,
            usage analytics
          </Bullet>
          <Bullet>
            Semantic Kernel: the pro-code SDK underneath for custom plugins
          </Bullet>
          <Bullet>
            Best for: Microsoft 365 shops extending Copilot with
            company-specific data and workflows
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Google Vertex AI Agent Builder"
        category="Managed cloud agent service"
        tagline="Ground agents in your data with Google Search quality"
        color="#16a34a"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Data Stores (website, structured, unstructured), Grounding (Google
            Search + own data), Playbooks (declarative orchestration)
          </Bullet>
          <Bullet>
            Extensions (tool use via OpenAPI), Agent Engine (managed
            LangChain/LlamaIndex runtime)
          </Bullet>
          <Bullet>Evolved from Dialogflow CX + CCAI in 2024</Bullet>
          <Bullet>
            Best for: customer-facing agents needing Google Search grounding;
            GCP shops; Gemini long-context
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Salesforce Agentforce"
        category="Enterprise CRM-native agent platform"
        tagline="AI agents that take action in your CRM — no prompt engineering"
        color="#0ea5e9"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Agent topics + instructions (declarative), Standard actions (CRM
            CRUD, flows, Apex), Atlas reasoning engine
          </Bullet>
          <Bullet>
            Data Cloud grounding (360° customer data); built-in trust layer (PII
            masking, audit)
          </Bullet>
          <Bullet>
            Agentforce 2.0 (late 2024): background agents, multi-agent
            coordination, MuleSoft API action library
          </Bullet>
          <Bullet>
            Best for: sales, service, and marketing orgs already on Salesforce;
            CRM-centric agent workflows
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="Dify"
        category="Open-source + SaaS LLM app platform"
        tagline="LLM app platform with visual orchestration — open-source or cloud"
        color="#7c3aed"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Workflow canvas (drag-drop), Chatbot / agent modes, RAG pipeline
            (native chunking + retrieval)
          </Bullet>
          <Bullet>
            Model provider hub (100+ models), API / iframe embed, self-hostable
            (Docker)
          </Bullet>
          <Bullet>
            Popular in Asia-Pacific market; large open-source community
          </Bullet>
          <Bullet>
            Best for: teams wanting a visual workflow builder; quick internal
            tool deployment; self-hosted LLM apps
          </Bullet>
        </ul>
      </FrameworkCard>

      <FrameworkCard
        name="n8n"
        category="Workflow automation + AI agents"
        tagline="Automate anything — visual workflows with AI Agent nodes and 400+ app integrations"
        color="#ea4b71"
      >
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <Bullet>
            Visual workflow builder with native AI Agent node
            (LangChain-backed); supports tool-calling via connected nodes
          </Bullet>
          <Bullet>
            400+ integrations (Slack, Salesforce, GitHub, databases) usable as
            agent tools out of the box
          </Bullet>
          <Bullet>
            MCP support added 2025 — connect n8n workflows as MCP tools for any
            agent framework
          </Bullet>
          <Bullet>
            Fair-code license (self-hostable free; n8n Cloud for SaaS); large
            OSS community
          </Bullet>
          <Bullet>
            Best for: ops automation with embedded AI; teams who need broad
            integrations without custom tool code
          </Bullet>
        </ul>
      </FrameworkCard>
    </>
  );
}

const CHECK = "✅";
const WARN = "⚠️";
const CROSS = "❌";

const osFW = [
    [
      "LangChain / LangGraph",
      "General purpose",
      CHECK + " LangGraph",
      CHECK + " loaders + vectorstores",
      CHECK + " LangGraph checkpointers",
      "Most use cases; largest ecosystem",
    ],
    [
      "LlamaIndex",
      "Data & RAG",
      WARN + " limited",
      CHECK + " Core feature",
      WARN + " basic",
      "Document Q&A, enterprise data",
    ],
    [
      "AutoGen",
      "Multi-agent conversation",
      CHECK + " Core feature",
      CROSS + " bring your own",
      CHECK + " ConversationHistory",
      "Code gen, research, data analysis",
    ],
    [
      "CrewAI",
      "Role-based teams",
      CHECK + " Core feature",
      CROSS + " bring your own",
      WARN + " basic",
      "Structured pipelines, content",
    ],
    [
      "Haystack",
      "NLP pipelines",
      CROSS,
      CHECK + " native pipeline",
      CROSS,
      "Production NLP/RAG",
    ],
    [
      "smolagents",
      "Code-executing agents",
      CROSS,
      CROSS,
      CROSS,
      "Research, HuggingFace models",
    ],
    [
      "Phidata / Agno",
      "Full-stack agents",
      CHECK + " Team",
      CHECK + " built-in",
      CHECK + " built-in (Postgres)",
      "Production agents with persistence",
    ],
  ];

const commFW = [
    [
      "Bedrock Agents",
      "AWS",
      CROSS + " (SDK/console)",
      CHECK + " (2024)",
      "IAM",
      "AWS-native, compliance",
    ],
    [
      "Copilot Studio",
      "Microsoft",
      CHECK,
      WARN + " limited",
      "Azure AD / MCP",
      "M365 + Teams copilots",
    ],
    [
      "Vertex AI Agent Builder",
      "Google",
      WARN + " partial",
      WARN + " Playbooks",
      "GCP IAM",
      "Customer-facing, Google Search",
    ],
    [
      "Agentforce",
      "Salesforce",
      CHECK,
      CHECK + " (2.0)",
      "Salesforce OAuth",
      "CRM-centric agents",
    ],
    [
      "Dify",
      "Open-source / SaaS",
      CHECK + " (canvas)",
      CHECK,
      "API key / SSO",
      "Visual workflow, self-hosted",
    ],
    [
      "n8n",
      "Fair-code / Cloud",
      CHECK + " (canvas)",
      CHECK + " (AI Agent node)",
      "API key / OAuth / MCP",
      "Ops automation + AI agents",
    ],
  ];

function ComparisonContent() {
  const thStyle = {
    background: "#1e3a5f",
    color: "#fff",
    padding: "8px 12px",
    textAlign: "left",
    fontSize: "0.78rem",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "7px 12px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: "0.8rem",
    verticalAlign: "top",
  };
  const tdAltStyle = { ...tdStyle, background: "#f8fafc" };

  return (
    <>
      <h4 style={{ color: "#1e3a5f", marginTop: 0 }}>Open-Source Frameworks</h4>
      <div style={{ overflowX: "auto", marginBottom: 24 }}>
        <table
          className="edu-table"
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}
        >
          <thead>
            <tr>
              {[
                "Framework",
                "Primary Focus",
                "Multi-agent",
                "Built-in RAG",
                "State/Memory",
                "Best For",
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {osFW.map((row, i) => (
              <tr key={row[0]}>
                {row.map((cell, j) => (
                  <td key={j} style={i % 2 === 0 ? tdStyle : tdAltStyle}>
                    {j === 0 ? <strong>{cell}</strong> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ color: "#1e3a5f" }}>Commercial Platforms</h4>
      <div style={{ overflowX: "auto", marginBottom: 24 }}>
        <table
          className="edu-table"
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}
        >
          <thead>
            <tr>
              {[
                "Platform",
                "Provider",
                "No-code?",
                "Multi-agent",
                "Auth model",
                "Best for",
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {commFW.map((row, i) => (
              <tr key={row[0]}>
                {row.map((cell, j) => (
                  <td key={j} style={i % 2 === 0 ? tdStyle : tdAltStyle}>
                    {j === 0 ? <strong>{cell}</strong> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ color: "#1e3a5f" }}>How to choose</h4>
      <ul style={{ paddingLeft: 20, margin: "0 0 12px" }}>
        <Bullet>
          <strong>Learning / prototyping:</strong> LangChain — largest
          community, most tutorials, works with every LLM.
        </Bullet>
        <Bullet>
          <strong>Production RAG pipelines:</strong> LlamaIndex or Haystack —
          designed around data ingestion, chunking, retrieval quality.
        </Bullet>
        <Bullet>
          <strong>Multi-agent research workflows:</strong> AutoGen or CrewAI —
          AutoGen if you need code execution; CrewAI for structured role/task
          definitions.
        </Bullet>
        <Bullet>
          <strong>Full-stack with persistence:</strong> Phidata / Agno — memory,
          knowledge base, structured outputs out of the box.
        </Bullet>
        <Bullet>
          <strong>AWS cloud-native:</strong> Bedrock Agents — no infra, IAM
          auth, Guardrails, tight AWS integration.
        </Bullet>
        <Bullet>
          <strong>Microsoft / Teams:</strong> Copilot Studio — publish to Teams,
          Power Automate integration, Azure AD governance.
        </Bullet>
        <Bullet>
          <strong>Salesforce CRM:</strong> Agentforce — only platform with
          native CRM action library and Data Cloud grounding.
        </Bullet>
        <Bullet>
          <strong>Visual / no-code:</strong> Dify — drag-and-drop workflow
          canvas, self-hostable, broad model support.
        </Bullet>
        <Bullet>
          <strong>Ops automation + AI:</strong> n8n — 400+ integrations as agent
          tools, AI Agent node, MCP support, self-hostable.
        </Bullet>
        <Bullet>
          <strong>This demo:</strong> <code>langchain_agent/</code> uses
          LangChain 0.3.x with <code>create_tool_calling_agent</code>, tool
          functions calling BFF REST routes, and LangSmith tracing.
        </Bullet>
      </ul>

      <p
        style={{
          fontSize: "0.75rem",
          color: "#94a3b8",
          marginTop: 16,
          borderTop: "1px solid #e2e8f0",
          paddingTop: 10,
        }}
      >
        Table reflects framework capabilities as of early 2026. Check each
        project's docs for current status.
      </p>
    </>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

const tabs = [
  { id: "langchain", label: "LangChain", content: <LangChainContent /> },
  { id: "opensource", label: "Open-Source", content: <OpenSourceContent /> },
  { id: "commercial", label: "Commercial", content: <CommercialContent /> },
  { id: "comparison", label: "Comparison", content: <ComparisonContent /> },
];

export default function AgentBuilderLandscapePanel({
  isOpen,
  onClose,
  initialTabId,
}) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Builder Landscape"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
