import { Link } from "react-router-dom";
import { Section, LessonLayout, Lede, OnThisRun, Status } from "../components/lesson";
import "./PingAiProductPage.css";

const PRODUCTS = {
  core: {
    title: "Agent IAM Core",
    eyebrow: "Identity foundation for AI agents",
    accent: "core",
    subtitle: "Give every agent a distinct identity, a bounded token, and an accountable relationship to the person it represents.",
    lede: "AI agents are becoming active participants in customer, workforce, and partner workflows. Agent IAM Core establishes the identity and token layer those interactions need before an agent can reach an API, service, or resource.",
    capabilities: [
      ["Agent identity", "Register agents as distinct OAuth clients with their own credentials and lifecycle."],
      ["Authentication", "Authenticate the agent before it requests access to protected resources."],
      ["Delegation", "Support on-behalf-of patterns with token exchange, preserving the human, agent, and resulting token relationship."],
      ["Scoped tokens", "Issue short-lived, audience-restricted tokens for a specific resource or service."],
    ],
    runExamples: [
      ["Agent lifecycle", "Register an agent, delegate access, and make a scoped MCP call.", "/agent-lifecycle"],
      ["Delegated commerce", "See RFC 8693 delegation reach a protected resource.", "/delegated-commerce"],
    ],
    flow: ["Human or system owner", "Agent IAM Core", "Delegated token", "API, service, or resource"],
    sections: ["Overview", "What it provides", "Agent runs", "How it fits", "Takeaway"],
    takeaway: "Move from shared credentials and ambiguous impersonation to explicit agent identity and delegated authority.",
  },
  gateway: {
    title: "Agent Gateway",
    eyebrow: "The enforcement point for agent traffic",
    accent: "gateway",
    subtitle: "Put a policy-aware boundary between an agent and the APIs, tools, and MCP servers it can reach.",
    lede: "Agent Gateway is the runtime control point: it validates the token presented by an agent, binds the request to its intended audience, and enforces the rules that must hold before traffic continues downstream.",
    capabilities: [
      ["Validate identity", "Check the delegated token, audience, scopes, and delegation chain before forwarding a request."],
      ["Protect MCP traffic", "Apply the same boundary to discovery and tool calls so MCP servers are not directly exposed to agents."],
      ["Enforce consistently", "Centralize routing, token exchange, rate limits, and policy hooks at the edge of the agent interaction."],
      ["Create evidence", "Record the decision and enforcement path so teams can explain what happened on every request."],
    ],
    runExamples: [
      ["Weather MCP — permit", "Let the gateway forward an in-scope third-party MCP request.", "/weather-mcp"],
      ["Gateway inspector", "Inspect gateway routing, token checks, and policy hooks.", "/agent-gateway-inspector"],
      ["Gateway deny", "Run the live workbench and watch an out-of-scope call stop at the boundary.", "/use-cases/live"],
    ],
    flow: ["Agent", "Agent Gateway", "Policy decision", "Protected API or MCP server"],
    sections: ["Overview", "What it enforces", "Agent runs", "Request path", "Takeaway"],
    takeaway: "Make the gateway the place where agent identity becomes an enforceable runtime decision.",
  },
  authorize: {
    title: "PingOne Authorize",
    eyebrow: "Fine-grained, policy-based decisions",
    accent: "authorize",
    subtitle: "Decide whether this agent, representing this user, may take this action on this resource right now.",
    lede: "Authentication answers who is calling. PingOne Authorize answers what that caller may do in context. It evaluates the agent, user, resource, action, and other policy attributes before a sensitive operation proceeds.",
    capabilities: [
      ["Contextual decisions", "Use runtime attributes and policy rather than hard-coding every business rule in the application."],
      ["Tool and resource controls", "Authorize access to APIs, resources, and individual agent actions."],
      ["Bounded delegation", "Keep user intent, agent identity, and requested action visible to the policy decision."],
      ["Step-up and obligations", "Return a deny, permit, or additional requirement when the action needs stronger assurance."],
    ],
    runExamples: [
      ["Policy console", "Evaluate live PingOne Authorize decisions with guided scenarios.", "/pingone-authorize"],
      ["Denied transfer", "See a policy deny before a high-value transfer can run.", "/use-cases/live"],
      ["Intent binding", "Compare an allowed request with one that exceeds the approved intent.", "/intent-binding-learning"],
    ],
    flow: ["Agent request", "Agent Gateway", "PingOne Authorize", "Permit, deny, or step-up"],
    sections: ["Overview", "What it decides", "Agent runs", "Decision path", "Takeaway"],
    takeaway: "Keep authorization outside the agent and in a policy decision point that can evaluate every action in context.",
  },
  privilegeLlm: {
    title: "PingOne Privilege for AI — LLM protection",
    eyebrow: "Control the model interaction",
    accent: "privilege",
    subtitle: "Add a control layer around LLM traffic so prompts, responses, and agent actions meet the organization’s policy.",
    lede: "An LLM can be manipulated by untrusted instructions, sensitive context, or a response that steers the agent toward an unsafe action. Privilege for AI helps put policy between the model interaction and the business system that ultimately carries out the work.",
    capabilities: [
      ["Inspect the conversation", "Evaluate the model interaction for risky instructions, sensitive content, and policy violations."],
      ["Control the outcome", "Allow, block, or route a response for additional review before it becomes an action."],
      ["Keep identity in view", "Connect the model request to the user, agent, and session that produced it."],
      ["Support auditability", "Give security teams an evidence trail for what the model saw and how the control responded."],
    ],
    runExamples: [
      ["LLM Gateway", "Send a model request through a Privilege virtual key and inspect the verdict.", "/llm-gateway"],
      ["LLM request tester", "Compare direct and Privilege-routed model requests.", "/llm-test"],
    ],
    flow: ["User or agent", "LLM interaction", "Privilege control", "Approved response or blocked action"],
    sections: ["Overview", "LLM risks", "Agent runs", "Control path", "Takeaway"],
    takeaway: "Treat the model interaction as a security boundary, not as a trusted source of instructions.",
  },
  privilegeA2a: {
    title: "PingOne Privilege for AI — A2A protection",
    eyebrow: "Control agent-to-agent delegation",
    accent: "privilege",
    subtitle: "Bring identity, trust, and policy to the handoff between agents when one agent asks another to act.",
    lede: "Agent-to-agent protocols make delegation powerful: a planner can ask a specialist to complete a task, and a remote agent can act on a user’s behalf. That handoff also needs a clear caller, an accountable target, and bounded authority.",
    capabilities: [
      ["Recognize the agent", "Distinguish workload and personal agents instead of treating every caller as an anonymous service."],
      ["Protect the handoff", "Validate the A2A request and keep the originating identity and delegation context attached."],
      ["Limit authority", "Apply policy to the remote agent, requested task, user context, and destination."],
      ["Record the chain", "Make the relationship between the initiating agent, receiving agent, and resulting action visible."],
    ],
    runExamples: [
      ["A2A protocol walkthrough", "Run the real Agent Card, bearer, and nested-act delegation walkthrough.", "/a2a-protocol-learning"],
      ["Delegation chain", "Follow a user-to-agent-to-specialist chain with narrowed authority.", "/delegation-chain-value"],
    ],
    flow: ["User or initiating agent", "A2A request", "Privilege control", "Remote agent"],
    sections: ["Overview", "Why A2A needs control", "Agent runs", "Handoff path", "Takeaway"],
    takeaway: "Make every agent handoff explicit, authenticated, policy-bound, and accountable.",
  },
  privilegeMcp: {
    title: "PingOne Privilege for AI — MCP protection",
    eyebrow: "Control agent access to tools",
    accent: "privilege",
    subtitle: "Protect MCP discovery and tool calls so an agent only sees and invokes what it is allowed to use.",
    lede: "MCP gives agents a practical way to discover tools and reach data or actions. The same discoverability can widen the blast radius of a poisoned description, an over-privileged token, or an unsafe tool call. Protection belongs at the MCP boundary.",
    capabilities: [
      ["Protect discovery", "Put a control point in front of tools/list so an agent does not receive an unrestricted catalog."],
      ["Protect invocation", "Evaluate the actual tool, arguments, identity, and policy before the MCP server runs it."],
      ["Stop unsafe actions", "Block calls that exceed scope, user authority, risk limits, or the approved delegation context."],
      ["Leave evidence", "Show which gateway and policy controls allowed or rejected the request."],
    ],
    runExamples: [
      ["Privilege MCP client", "Connect to the protected MCP client and exercise per-tool access.", "/privilege-mcp-client"],
      ["MCP protection guide", "Walk through the Privilege gateway, app, policy, and tool path.", "/privilege-mcp-learning"],
      ["Gateway scope deny", "Let the Agent Gateway block an out-of-scope third-party tool call.", "/weather-mcp"],
    ],
    flow: ["Agent", "MCP discovery", "Privilege control", "Allowed tool call"],
    sections: ["Overview", "MCP risks", "Agent runs", "Protection path", "Takeaway"],
    takeaway: "Treat MCP as a real application boundary: protect both what the agent discovers and what it invokes.",
  },
};

const NAV = [
  ["core", "Agent IAM Core"],
  ["gateway", "Agent Gateway"],
  ["authorize", "PingOne Authorize"],
  ["privilegeLlm", "Privilege · LLM"],
  ["privilegeA2a", "Privilege · A2A"],
  ["privilegeMcp", "Privilege · MCP"],
];

const slug = (key) => `/ai-products/${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;

export default function PingAiProductPage({ product = "core" }) {
  const data = PRODUCTS[product] || PRODUCTS.core;
  return (
    <LessonLayout
      title={data.title}
      subtitle={<><span className={`pai-eyebrow pai-eyebrow--${data.accent}`}>{data.eyebrow}</span> {data.subtitle}</>}
      sections={data.sections.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), label }))}
      storageKey={`ping-ai-product-${product}`}
      printExclude={[]}
    >
      <nav className="pai-product-nav" aria-label="AI product pages">
        {NAV.map(([key, label]) => <Link className={key === product ? "pai-product-nav__link pai-product-nav__link--active" : "pai-product-nav__link"} key={key} to={slug(key)}>{label}</Link>)}
      </nav>

      <Section id="overview" title="The role it plays">
        <Lede>{data.lede}</Lede>
        <div className={`pai-hero pai-hero--${data.accent}`}>
          <div className="pai-hero-mark" aria-hidden="true">AI</div>
          <div><p className="pai-hero-kicker">Ping for AI</p><p className="pai-hero-copy">{data.takeaway}</p></div>
        </div>
      </Section>

      <Section id={data.sections[1].toLowerCase().replaceAll(" ", "-")} title={data.sections[1]}>
        <div className="pai-capability-grid">
          {data.capabilities.map(([title, body], index) => <article className="pai-capability" key={title}><span className="pai-capability-index">0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}
        </div>
      </Section>

      <Section id={data.sections[2].toLowerCase().replaceAll(" ", "-")} title={data.sections[2]}>
        <div className="pai-run-grid">
          {data.runExamples.map(([title, description, path]) => <Link className="pai-run" key={title} to={path}><span className="pai-run__label">Open agent run</span><h3>{title}</h3><p>{description}</p><span className="pai-run__arrow" aria-hidden="true">→</span></Link>)}
        </div>
      </Section>

      <Section id={data.sections[3].toLowerCase().replaceAll(" ", "-")} title={data.sections[3]}>
        <div className="pai-flow" aria-label={`${data.title} flow`}>
          {data.flow.map((node, index) => <div className="pai-flow__item" key={node}><span>{node}</span>{index < data.flow.length - 1 && <i aria-hidden="true" />}</div>)}
        </div>
        <OnThisRun title="Architecture note"><p><Status ok>Boundary defined</Status> This page explains the product’s role in an AI security architecture. Live demo routes and inspectors remain available in the navigation.</p></OnThisRun>
      </Section>

      <Section id="takeaway" title={data.sections[4]}>
        <p className="pai-takeaway">{data.takeaway}</p>
        <p className="pai-next">Continue with another layer: <Link to={slug("core")}>identity</Link>, <Link to={slug("gateway")}>enforcement</Link>, <Link to={slug("authorize")}>authorization</Link>, or <Link to={slug("privilegeMcp")}>MCP protection</Link>.</p>
      </Section>
    </LessonLayout>
  );
}
