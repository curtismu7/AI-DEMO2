// banking_api_ui/src/components/education/AiPrimerPanel.js
import EducationDrawer from '../shared/EducationDrawer';

/* ─── Reusable primitives ─────────────────────────────────────────────────── */

function Term({ name, href, children }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
        {name}
        {href && (
          <>
            {' '}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.78rem', fontWeight: 400, color: '#2563eb', marginLeft: 4 }}
            >
              spec ↗
            </a>
          </>
        )}
      </p>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700, color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Note({ children }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #6366f1', borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#475569', lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

function StepList({ steps }) {
  return (
    <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
      {steps.map((s) => <li key={s}>{s}</li>)}
    </ol>
  );
}

/* ─── Tab: Terminology ───────────────────────────────────────────────────── */

function TerminologyContent() {
  return (
    <div>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        Precise vocabulary for communicating AI concepts with customers. Conflating these terms erodes trust and leads to misaligned expectations.
      </p>

      <Section title="Section 1: Nomenclature and Terminology">
        <Term
          name="Artificial Intelligence (AI)"
          href="https://www.nist.gov/artificial-intelligence"
        >
          A field of computer science dedicated to building systems that process information in a way that mimics cognitive functions. It is an umbrella term for many different technologies and should not be used to describe a specific product or feature without further qualification.
        </Term>

        <Term
          name="Machine Learning (ML)"
          href="https://www.iso.org/standard/74442.html"
        >
          A specific approach to AI where a system is trained on data to identify patterns and make decisions. Unlike traditional software, which relies on hard-coded logic, ML models adjust their internal parameters based on the data they ingest.
        </Term>

        <Term
          name="Large Language Model (LLM)"
          href="https://arxiv.org/abs/1706.03762"
        >
          A sophisticated statistical model trained on massive text datasets to predict the next most likely word or token in a sequence. An LLM is a reasoning engine, not a database. It does not store facts in a structured table, but rather stores weights or associations between concepts. Responses are probabilistic: a given answer is the most likely sequence of words based on training, not a verified lookup.
        </Term>

        <Term
          name="Generative AI"
          href="https://airc.nist.gov/AI_Glossary"
        >
          A subset of AI models focused on creating new data that resembles the training data. While traditional AI might classify an existing image, Generative AI creates a new one.
        </Term>

        <Term
          name="Agent"
          href="https://www.ibm.com/topics/ai-agents"
        >
          A software system that uses an LLM to perceive its environment, reason about how to achieve a goal, and execute actions via external tools. An important distinction: the chat interface a user types into is not the agent itself; it is a presentation layer, or frontend. The agent is the backend reasoning and execution layer that manages tasks, calls tools, and orchestrates workflows autonomously.
        </Term>

        <Term name="Agentic AI">
          A system architecture where the primary logic is driven by autonomous agents. This move from chat-based AI to agentic AI represents a shift from a user asking questions to a user delegating complex workflows to a system that can work independently.
        </Term>

        <Term
          name="Model Context Protocol (MCP)"
          href="https://modelcontextprotocol.io"
        >
          An open standard designed to enable seamless, secure integration between AI models and local or remote data sources. MCP is a protocol, not a proxy or a data warehouse. It defines the communication schema so that any model can interact with any data source that implements the standard, without custom integration code for every connection.
        </Term>

        <Term
          name="Identity and Access Management (IAM)"
          href="https://pages.nist.gov/800-63-3/"
        >
          A security framework for managing digital identities. In AI contexts, IAM ensures that an agent only accesses data or performs actions that the specific user or service account is authorized to execute.
        </Term>

        <Term
          name="Retrieval-Augmented Generation (RAG)"
          href="https://arxiv.org/abs/2005.11401"
        >
          An architecture that allows an LLM to access specific, up-to-date data during a conversation by retrieving relevant documents from an external source and providing them to the model as context. RAG exists because LLMs are not real-time systems like search engines; they are limited by a fixed training cutoff date. RAG augments the reasoning capabilities of the model with information it was not originally trained on.
        </Term>
      </Section>
    </div>
  );
}

/* ─── Tab: Foundations ───────────────────────────────────────────────────── */

function FoundationsContent() {
  return (
    <div>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        Conceptual explanations of how these technologies work together. Designed to be accurate enough to inform technical conversations without requiring an academic background.
      </p>

      <Section title="Distinguishing LLMs from Databases">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          A common misconception is treating a Large Language Model as a database or a search engine. A database stores exact data points that can be retrieved with 100% fidelity. An LLM is a probabilistic engine. When it provides an answer, it is calculating the most likely sequence of words based on its training. If the model is not provided with external data via RAG or MCP, it may generate hallucinations, which are responses that sound plausible but are factually incorrect.
        </p>
      </Section>

      <Section title="The Role of MCP as a Universal Interface">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          In many customer environments, data is siloed across different applications and servers. Historically, to give an AI access to this data, a developer would have to write custom APIs or proxy layers for every single connection. The Model Context Protocol provides a standardized way for an agent to say "show me the files in this folder" or "query this database" using a common language. By implementing MCP, a company ensures that their AI tools are interoperable and that the model can be swapped out or upgraded without rewriting the data connections.
        </p>
      </Section>

      <Section title="Machine Learning Types">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          While the current market focus is on Generative AI, customers may also encounter Predictive or Discriminative AI.
        </p>
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li>Predictive AI uses historical data to forecast future events, such as inventory needs or equipment failure.</li>
          <li>Discriminative AI is used to categorize data, such as identifying whether an email is spam or whether a medical image shows a specific condition.</li>
          <li>Generative AI differs because its primary output is a new synthesis of information rather than a label or a numerical forecast.</li>
        </ul>
        <Note>These distinctions rarely surface in typical AI agent conversations, but knowing them prevents confusion when customers reference them.</Note>
      </Section>

      <Section title="Simple RAG vs. Agentic RAG">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          Simple RAG is a linear process: a user asks a question, the system looks up a document, and the model summarizes it. Agentic RAG is more advanced because the agent can evaluate the quality of the information it finds. If the initial search results are insufficient or contradictory, an agent can decide to search a different database, refine its search terms, or ask the user for more clarification. This creates a more reliable and robust system for complex technical or legal inquiries.
        </p>
        <Note>Think of Simple RAG as a researcher who reads one book. Agentic RAG is a researcher who reads one book, decides it is not sufficient, and goes to find three more.</Note>
      </Section>

      <Section title="Securing Agents with IAM">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          When an AI agent is given the ability to take actions, such as updating a customer record in a CRM, it must be treated as a distinct identity within the network. This requires applying the Principle of Least Privilege. An agent should never be given admin access by default. Instead, IAM policies should be configured so that the agent operates under a service account with the minimum permissions necessary to perform its specific task. This ensures that even if an agentic system misinterprets a prompt, the potential for unauthorized data access or system damage is restricted.
        </p>
        <Note>
          Further reading: "The lethal trifecta for AI agents: private data, untrusted content, and external communication"{' '}
          <a href="https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
            simonwillison.net ↗
          </a>
        </Note>
      </Section>
    </div>
  );
}

/* ─── Tab: Prompts ───────────────────────────────────────────────────────── */

function PromptsContent() {
  return (
    <div>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        The quality of an LLM or agent response is directly proportional to the quality of the instructions provided. This tab covers prompt construction principles and what goes wrong when prompts are underspecified.
      </p>

      <Section title="What Makes a Prompt Effective">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          A successful prompt is not a simple question. It is a structured set of requirements. A professional prompt typically includes four components:
        </p>
        <StepList steps={[
          'Context: The background information or role the model should assume.',
          'Goals: A clear description of the problem the model needs to solve.',
          'Outcomes: The specific format, length, or tone expected for the output.',
          'Constraints: The rules the model must follow, such as what to avoid or what data to prioritize.',
        ]} />
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          If prompts are simplistic and lack these details, the model is forced to fill in the gaps with its own statistical biases. This often leads to underspecification, where the AI provides a generic answer that fails to meet the actual technical or business need.
        </p>
        <Note>
          Further reading:{' '}
          <a href="https://platform.openai.com/docs/guides/prompt-engineering" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
            OpenAI Prompt Engineering Guide ↗
          </a>
        </Note>
      </Section>

      <Section title="Example: Weak vs. Strong Prompt">
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, fontWeight: 600 }}>Weak prompt:</p>
        <pre style={{ background: '#fff5f5', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', fontSize: '0.8rem', margin: '0 0 1rem', whiteSpace: 'pre-wrap', color: '#7f1d1d' }}>
          {`Summarize the contract.`}
        </pre>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6, fontWeight: 600 }}>Strong prompt:</p>
        <pre style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '10px 14px', fontSize: '0.8rem', margin: 0, whiteSpace: 'pre-wrap', color: '#14532d' }}>
          {`You are a legal analyst reviewing vendor contracts for a financial services firm.

Goal: Identify all clauses that could expose the firm to liability in the event of a data breach.

Output: A bulleted list of clause titles and a one-sentence explanation of each risk.

Constraints:
- Limit your response to clauses directly related to data handling, indemnification, and breach notification.
- Do not summarize general contract terms.
- If no such clauses are present, state that explicitly.`}
        </pre>
      </Section>

      <Section title="Prompt Roles in Agentic Systems">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          In an agentic system, prompts operate at multiple levels simultaneously:
        </p>
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li><strong>System prompt:</strong> Sets the agent's persistent behavior, persona, and hard constraints. Applied by the engineer at configuration time.</li>
          <li><strong>User prompt:</strong> The instruction provided at runtime by the human or an orchestrating system.</li>
          <li><strong>Tool result injection:</strong> Structured data returned by MCP tools is appended to the context window before the model generates its next response.</li>
        </ul>
        <Note>A well-engineered system prompt is the primary defense against prompt injection. If an adversary can override the system prompt through user input, the agent's behavior becomes unpredictable and potentially dangerous.</Note>
      </Section>

      <Section title="Common Prompt Failures">
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li><strong>Underspecification:</strong> The prompt lacks context, so the model produces a generic answer that misses the actual need.</li>
          <li><strong>Role confusion:</strong> No persona is established, so the model defaults to a generic assistant behavior rather than acting as a domain expert.</li>
          <li><strong>Missing constraints:</strong> Without explicit guardrails, the model may include information that should be excluded (e.g., competitor mentions, legal disclaimers).</li>
          <li><strong>Ambiguous output format:</strong> If no format is specified, the model may return prose when the caller expected JSON, breaking downstream parsing.</li>
        </ul>
      </Section>
    </div>
  );
}

/* ─── Tab: Workflow ──────────────────────────────────────────────────────── */

function WorkflowContent() {
  return (
    <div>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        How these technologies work together in a professional environment, from user input to final action.
      </p>

      <Section title="Interaction Workflow">
        <StepList steps={[
          'A user provides a structured prompt to the system interface.',
          'The Agent receives the prompt and uses an LLM to reason about the required steps.',
          'The Agent uses RAG or MCP to retrieve factual context from authorized company sources.',
          'The IAM layer validates that the Agent has permission to access those specific sources.',
          'The LLM processes the retrieved context and generates a suggested action or response.',
          'The Agent executes the action or presents the final output to the human user.',
        ]} />
      </Section>

      <Section title="Where Identity Matters in the Workflow">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          Each step in the workflow above has an identity surface. The agent does not act anonymously; it operates under credentials that define what it can access and what actions it can take.
        </p>
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li>The user authenticates via standard OAuth flows. Their identity and granted scopes constrain what the agent can request on their behalf.</li>
          <li>The agent acts as a distinct service identity with its own credentials, separate from the user.</li>
          <li>MCP tool calls are authorized individually. A tool that reads account balances does not automatically grant permission to initiate a transfer.</li>
          <li>Token exchange (RFC 8693) enables the agent to prove it is acting on behalf of a specific user without exposing that user's credentials to downstream services.</li>
        </ul>
      </Section>

      <Section title="Failure Modes to Communicate to Customers">
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li><strong>Hallucination:</strong> The LLM generates a plausible-sounding but factually incorrect response because no grounding data was provided via RAG or MCP.</li>
          <li><strong>Scope creep:</strong> An agent granted overly broad permissions accesses data it did not need, violating the Principle of Least Privilege.</li>
          <li><strong>Prompt injection:</strong> Malicious content in retrieved documents attempts to override the system prompt and redirect the agent's behavior.</li>
          <li><strong>Context window overflow:</strong> Too much data is provided to the model, causing it to lose track of earlier instructions or retrieved context.</li>
        </ul>
      </Section>
    </div>
  );
}

/* ─── Tab: About This Guide ─────────────────────────────────────────────── */

function AboutContent() {
  return (
    <div>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        The prompts and iteration process used to develop this guide. Included here as a practical example of structured prompt construction.
      </p>

      <Section title="Version 1.3 — Authoring Context">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          This guide was authored using an AI language model operating in the role of a senior software engineer and instructor specializing in AI, agentic systems, machine learning, prompt design, and MCP. The following prompts were used to produce and refine it.
        </p>
      </Section>

      <Section title="Initial Prompt">
        <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 8, padding: '12px 16px', fontSize: '0.78rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
{`For this session you are an expert software engineer and instructor
specializing in AI, agentic AI engineering, machine learning, prompt
design, MCP, and related topics.

The problem: AI technologies are new to our company. When speaking to
customers, we need to speak the same language accurately. Language
matters. Conflating terms leads to miscommunication or loss of trust.

I need a document that outlines terminology and nomenclature for:
AI, Agents, Agentic AI, Machine Learning, MCP, LLMs, IAM as it
relates to securing agents, and related concepts.

The nomenclature section should be followed by a foundational
"For Dummies" level primer.

Requirements:
- No marketing fluff or corporate buzzwords
- Matter of fact and pedantic
- No icons or emojis (professional appearance)
- Avoid making words bold mid-sentence
- Ask me questions before generating the first draft`}</pre>
      </Section>

      <Section title="Clarification Answers">
        <ul style={{ margin: 0, padding: '0 0 0 1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li>MCP refers to the Model Context Protocol (the open standard), not a proprietary control plane.</li>
          <li>IAM coverage should address both HITL authorization and M2M service account patterns, kept brief and accessible.</li>
          <li>Include Discriminative/Predictive AI as side notes rather than primary topics.</li>
          <li>Broader agent definition takes priority; Simple vs. Agentic RAG as a brief aside.</li>
          <li>Format: a technical enablement guide, not a cheat sheet or white paper.</li>
        </ul>
      </Section>

      <Section title="Iteration 1 Prompt">
        <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 8, padding: '12px 16px', fontSize: '0.78rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
{`For terms that have an official specification (e.g., MCP) or an
industry standard, include a link so the reader can go deeper.
Prefer official or formal sources over blogs.

Also add more detail where feasible. Examples:
- For MCP, clarify what it is and what it is not (not a proxy server)
- For LLMs, clarify they are not databases`}</pre>
      </Section>

      <Section title="Iteration 2 Prompt">
        <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 8, padding: '12px 16px', fontSize: '0.78rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
{`Keep everything else identical. Only change:
- "Agent": Add clarity that the chatbot interface is not the agent
  itself; it is a presentation layer. The agent is the backend.
- "RAG": Add that RAG exists because LLMs are not real-time systems
  like search engines and are limited by a training cutoff date.
Then validate there are no conflicting explanations.`}</pre>
      </Section>

      <Section title="Iteration 3 Prompt">
        <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 8, padding: '12px 16px', fontSize: '0.78rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>
{`One last change. Keep this current version the same but add a new
topic in Section 2 about what makes prompts effective: context,
goals, outcomes, constraints, and what happens when prompts are
simplistic and lack detail.`}</pre>
      </Section>
    </div>
  );
}

/* ─── Exported panel ─────────────────────────────────────────────────────── */

const tabs = [
  { id: 'terminology', label: 'Terminology',  content: <TerminologyContent /> },
  { id: 'foundations', label: 'Foundations',  content: <FoundationsContent /> },
  { id: 'prompts',     label: 'Prompts',       content: <PromptsContent /> },
  { id: 'workflow',    label: 'Workflow',       content: <WorkflowContent /> },
  { id: 'about',       label: 'About / Prompts used', content: <AboutContent /> },
];

export default function AiPrimerPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="AI and Agentic Systems — Technical Primer"
      tabs={tabs}
      initialTabId={initialTabId}
      width="clamp(380px, 52vw, 720px)"
    />
  );
}
