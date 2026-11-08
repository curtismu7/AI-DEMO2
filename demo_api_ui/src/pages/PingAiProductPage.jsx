// The seven /ai-products/* lessons. Layout follows the Ping UI Standard (docs/ping-ui-primitives.md):
// P2 banner first, P4 cards, P7 chips with a word, P9 one primary per view. Skipped, with the reason:
// P3 PageFrame (LessonLayout already supplies the 1100px column and the section nav) and P5 key-value
// (the content is prose, there are no key/value rows). The standalone shell bar is not added.
import { Link, useNavigate } from "react-router-dom";
import { Section, LessonLayout, Lede } from "../components/lesson";
import { PingPage, SimBanner, CardGrid, Card, StatusChip } from "../components/pingUi";
import PingOneProtectBrowserDemo from "./PingOneProtectBrowserDemo";
import A2aDocsLinks from "../components/shared/A2aDocsLinks";
import "./PingAiProductPage.css";

const PRODUCTS = {
  core: {
    title: "Agent IAM Core",
    eyebrow: "Identity foundation for AI agents",
    subtitle: "Give every agent a distinct identity, a bounded token, and an accountable relationship to the person it represents.",
    lede: "AI agents are becoming active participants in customer, workforce, and partner workflows. Agent IAM Core establishes the identity and token layer those interactions need before an agent can reach an API, service, or resource.",
    capabilities: [
      ["Agent identity", "Register agents as distinct OAuth clients with their own credentials and lifecycle."],
      ["Authentication", "Authenticate the agent before it requests access to protected resources."],
      ["Delegation", "Support on-behalf-of patterns with token exchange, preserving the human, agent, and resulting token relationship."],
      ["Scoped tokens", "Issue short-lived, audience-restricted tokens for a specific resource or service."],
    ],
    runExamples: [
      ["Agent lifecycle", "Register an agent, delegate access, and make a scoped MCP call. Registration creates a real PingOne application; the approval step can run on a simulated backchannel.", "/agent-lifecycle", "mixed"],
      ["Delegated commerce", "RFC 8693 delegation to a protected MCP tool runs live. The human-approval step is simulated when the CIBA engine is simulated, and the page badges which.", "/delegated-commerce", "mixed"],
    ],
    flow: ["Human or system owner", "Agent IAM Core", "Delegated token", "API, service, or resource"],
    sections: ["Overview", "What it provides", "Agent runs", "How it fits", "Takeaway"],
    takeaway: "Move from shared credentials and ambiguous impersonation to explicit agent identity and delegated authority.",
  },
  gateway: {
    title: "Agent Gateway",
    eyebrow: "The enforcement point for agent traffic",
    subtitle: "Put a policy-aware boundary between an agent and the APIs, tools, and MCP servers it can reach.",
    lede: "Agent Gateway is the runtime control point: it validates the token presented by an agent, binds the request to its intended audience, and enforces the rules that must hold before traffic continues downstream.",
    capabilities: [
      ["Validate identity", "Check the delegated token, audience, scopes, and delegation chain before forwarding a request."],
      ["Protect MCP traffic", "Apply the same boundary to discovery and tool calls so MCP servers are not directly exposed to agents."],
      ["Enforce consistently", "Centralize routing, token exchange, rate limits, and policy hooks at the edge of the agent interaction."],
      ["Create evidence", "Record the decision and enforcement path so teams can explain what happened on every request."],
    ],
    runExamples: [
      ["Weather MCP — permit", "Run the agent against a third-party weather MCP server that the gateway fronts; an in-region ask is forwarded. Needs the gateway running.", "/weather-mcp", "live"],
      ["Gateway inspector", "Inspect real gateway traffic and decisions. The page has a Real / Simulated switch for the authorize step and labels the mode it is in.", "/agent-gateway-inspector", "switch"],
      ["Out-of-scope deny cases", "Opens the use-case workbench, where you pick a deny case. Run in agent cards call the live agent; Run sim cards are labelled simulations.", "/use-cases/live", "mixed"],
    ],
    flow: ["Agent", "Agent Gateway", "Policy decision", "Protected API or MCP server"],
    sections: ["Overview", "What it enforces", "Agent runs", "Request path", "Takeaway"],
    takeaway: "Make the gateway the place where agent identity becomes an enforceable runtime decision.",
  },
  authorize: {
    title: "PingOne Authorize",
    eyebrow: "Fine-grained, policy-based decisions",
    subtitle: "Decide whether this agent, representing this user, may take this action on this resource right now.",
    lede: "Authentication answers who is calling. PingOne Authorize answers what that caller may do in context. It evaluates the agent, user, resource, action, and other policy attributes before a sensitive operation proceeds.",
    capabilities: [
      ["Contextual decisions", "Use runtime attributes and policy rather than hard-coding every business rule in the application."],
      ["Tool and resource controls", "Authorize access to APIs, resources, and individual agent actions."],
      ["Bounded delegation", "Keep user intent, agent identity, and requested action visible to the policy decision."],
      ["Step-up and obligations", "Return a deny, permit, or additional requirement when the action needs stronger assurance."],
    ],
    runExamples: [
      ["Policy console", "Run decisions with guided scenarios. The console starts in Mock mode (a built-in policy, no PingOne call); switch to Real P1AZ to send them to PingOne Authorize.", "/pingone-authorize", "switch"],
      ["Policy deny cases", "Opens the use-case workbench, where you pick a deny case. Run in agent cards call the live agent; Run sim cards are labelled simulations.", "/use-cases/live", "mixed"],
      ["Intent binding", "Compare an allowed request with one that exceeds the approved intent. Live mode (on by default, needs sign-in) uses real PingOne Authorize; a checkbox switches to the simulated engine.", "/intent-binding-learning", "switch"],
    ],
    flow: ["Agent request", "Agent Gateway", "PingOne Authorize", "Permit, deny, or step-up"],
    sections: ["Overview", "What it decides", "Agent runs", "Decision path", "Takeaway"],
    takeaway: "Keep authorization outside the agent and in a policy decision point that can evaluate every action in context.",
  },
  privilegeLlm: {
    title: "PingOne Privilege for AI — LLM protection",
    eyebrow: "Control the model interaction",
    subtitle: "Add a control layer around LLM traffic so prompts, responses, and agent actions meet the organization’s policy.",
    lede: "An LLM can be manipulated by untrusted instructions, sensitive context, or a response that steers the agent toward an unsafe action. Privilege for AI helps put policy between the model interaction and the business system that ultimately carries out the work.",
    capabilities: [
      ["Inspect the conversation", "Evaluate the model interaction for risky instructions, sensitive content, and policy violations."],
      ["Control the outcome", "Allow, block, or route a response for additional review before it becomes an action."],
      ["Keep identity in view", "Connect the model request to the user, agent, and session that produced it."],
      ["Support auditability", "Give security teams an evidence trail for what the model saw and how the control responded."],
    ],
    runExamples: [
      ["Try a prompt-injection attack", "Opens the LLM Gateway with a known override attack loaded. You send it through a Privilege virtual key and read the verdict Privilege returns; the outcome is not decided in advance. Needs sign-in.", "/llm-gateway?attack=prompt_injection", "live"],
      ["LLM Gateway", "Send a model request through a Privilege virtual key and inspect the verdict. Needs sign-in.", "/llm-gateway", "live"],
      ["LLM request tester", "Raw request tester for a direct request and a Privilege-routed one; it interprets nothing. Needs sign-in.", "/llm-test", "live"],
    ],
    flow: ["User or agent", "LLM interaction", "Privilege control", "Approved response or blocked action"],
    sections: ["Overview", "LLM risks", "Agent runs", "Control path", "Takeaway"],
    takeaway: "Treat the model interaction as a security boundary, not as a trusted source of instructions.",
  },
  privilegeA2a: {
    title: "PingOne Privilege for AI — A2A protection",
    eyebrow: "Control agent-to-agent delegation",
    subtitle: "Bring identity, trust, and policy to the handoff between agents when one agent asks another to act.",
    lede: "Agent-to-agent protocols make delegation powerful: a planner can ask a specialist to complete a task, and a remote agent can act on a user’s behalf. That handoff also needs a clear caller, an accountable target, and bounded authority.",
    capabilities: [
      ["Recognize the agent", "Distinguish workload and personal agents instead of treating every caller as an anonymous service."],
      ["Protect the handoff", "Each agent calls through the Agent Privilege with its own agent key; the gateway checks the key, its a2a scope and the policy for that remote agent before forwarding."],
      ["Limit authority", "Grant each agent only the remote agents, tools and model it needs; an ungranted hand-off is refused at the gateway."],
      ["Screen what crosses", "The gateway's guardrail blocks a prompt-injection message between agents, redacts personal data in tool results, and blocks a tool result that carries hidden instructions."],
      ["Record the chain", "Make the relationship between the initiating agent, receiving agent, and resulting action visible."],
    ],
    runExamples: [
      ["A2A access review through the gateway", "Main agent, worker agent and MCP tools, every hop through the Agent Privilege. The agents and hops are live; the access data the tools return is sample data.", "/privilege-a2a", "sample"],
      ["Three-deep agent chain", "Opens the dashboard; run Demo Step 26 there for an allowed run, a blocked prompt injection and a refused hand-off, played in the reel and sequence view. Needs the agents running.", "/dashboard", "live"],
      ["Agent-to-agent architecture", "Where the gateway sits between the agents, the tool server and the model provider. A diagram page; live node stats appear only for an admin.", "/privilege-gateway-topologies", "guide"],
      ["A2A protocol walkthrough", "Fetches the live Agent Card and runs the bearer and nested-act delegation. When no live run is available it shows a recorded run, and each section is labelled live or recorded.", "/a2a-protocol-learning", "switch"],
      ["Delegation chain", "Follow a user-to-agent-to-specialist chain with narrowed authority. Both scenarios run through the live token-exchange and authorization path.", "/delegation-chain-value", "live"],
    ],
    flow: ["Calling agent", "A2A request with its agent key", "Agent Privilege", "Remote agent"],
    sections: ["Overview", "Why A2A needs control", "Agent runs", "Handoff path", "Takeaway"],
    takeaway: "Make every agent handoff explicit, authenticated, policy-bound, and accountable.",
  },
  privilegeMcp: {
    title: "PingOne Privilege for AI — MCP protection",
    eyebrow: "Control agent access to tools",
    subtitle: "Protect MCP discovery and tool calls so an agent only sees and invokes what it is allowed to use.",
    lede: "MCP gives agents a practical way to discover tools and reach data or actions. The same discoverability can widen the blast radius of a poisoned description, an over-privileged token, or an unsafe tool call. Protection belongs at the MCP boundary.",
    capabilities: [
      ["Protect discovery", "Put a control point in front of tools/list so an agent does not receive an unrestricted catalog."],
      ["Protect invocation", "Evaluate the actual tool, arguments, identity, and policy before the MCP server runs it."],
      ["Stop unsafe actions", "Block calls that exceed scope, user authority, risk limits, or the approved delegation context."],
      ["Leave evidence", "Show which gateway and policy controls allowed or rejected the request."],
    ],
    runExamples: [
      ["Privilege MCP client", "Connect to the protected MCP client and exercise per-tool access. With no Privilege access the approval step uses a labelled sample approver.", "/privilege-mcp-client", "switch"],
      ["MCP protection guide", "Walk through the Privilege gateway, app, policy, and tool path. A diagram walk-through; nothing is called.", "/privilege-mcp-learning", "guide"],
      ["Out-of-region weather call", "Run the agent against the third-party weather MCP server; the Miami ask is meant to be blocked by the Agent Gateway's region policy. Needs the gateway running.", "/weather-mcp", "live"],
    ],
    flow: ["Agent", "MCP discovery", "Privilege control", "Allowed tool call"],
    sections: ["Overview", "MCP risks", "Agent runs", "Protection path", "Takeaway"],
    takeaway: "Treat MCP as a real application boundary: protect both what the agent discovers and what it invokes.",
  },
  protect: {
    title: "PingOne Protect",
    eyebrow: "Browser risk evaluation",
    subtitle: "Send browser Signals to PingOne Protect and inspect its risk response.",
    lede: "This standalone demo collects browser context with the PingOne Signals SDK, sends the payload to PingOne Protect through the BFF, and displays the returned evaluation. It does not start a sign-in or dispatch an agent action.",
    capabilities: [
      ["Collect browser Signals", "The Signals SDK collects device context when the user runs this demo; its raw payload is sent only to the BFF."],
      ["Evaluate browser risk", "The BFF adds request context and calls PingOne Protect with the collected Signals payload."],
      ["Inspect the response", "See the returned risk level, recommended action, and available bot-detection details."],
      ["Keep credentials server-side", "The browser never receives the Protect Worker token or raw evaluation details."],
    ],
    runExamples: [],
    flow: ["Browser Signals SDK", "BFF request", "PingOne Protect", "Risk response in the page"],
    sections: ["Overview", "Risk signals", "Run the demo", "Evaluation path", "Takeaway"],
    takeaway: "Evaluate browser risk in a standalone page and inspect the Protect response without changing an authentication or agent flow.",
  },
};

const NAV = [
  ["core", "Agent IAM Core"],
  ["gateway", "Agent Gateway"],
  ["authorize", "PingOne Authorize"],
  ["privilegeLlm", "Privilege · LLM"],
  ["privilegeA2a", "Privilege · A2A"],
  ["privilegeMcp", "Privilege · MCP"],
  ["protect", "PingOne Protect"],
];

const slug = (key) => `/ai-products/${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;

// What is real on the page, said once at the top. Six pages are explainers; Protect hosts one live form.
// What each run card tells the reader about its destination. Written from the destination's page code, not
// from its title: a card must never read as a real verdict when the page behind it is simulated or a diagram.
const RUN_KIND = {
  live: "Opens a page that makes live calls",
  mixed: "Opens a page that mixes live and simulated",
  switch: "Opens a live page with a simulated option",
  sample: "Opens live agents with sample data",
  guide: "Opens an explainer, nothing is called",
};

const BANNER = {
  explainer: {
    mode: "PRODUCT EXPLAINER",
    body: "Nothing on this page is run or simulated: it describes the product's role in an AI security architecture. The Start with button and the cards below open other demo pages, and not every one of them labels what it runs live and what it simulates. Each card says what that page does, read from its code. The destination's own wording is the final word.",
  },
  protect: {
    mode: "EXPLAINER WITH ONE LIVE FORM",
    body: "The text is an explanation. The evaluation form below is real: it collects this browser's Signals, sends them through this machine's BFF to PingOne Protect, and shows the response (or the error when Protect is not configured). It does not sign anyone in or run an agent.",
  },
};

export default function PingAiProductPage({ product = "core" }) {
  const data = PRODUCTS[product] || PRODUCTS.core;
  const navigate = useNavigate();
  const banner = product === "protect" ? BANNER.protect : BANNER.explainer;
  // P9, one primary per view. Product pages: the hero button that opens the first agent run (the cards
  // below stay links). Protect has no agent runs; its one primary is the evaluation form's submit button.
  const firstRun = data.runExamples[0];

  return (
    <PingPage className="pai-page">
      <SimBanner data-testid="pai-banner">
        <strong>{banner.mode}</strong> — {banner.body}
      </SimBanner>
      <LessonLayout
        pageClassName="pai-lesson-page"
        title={data.title}
        subtitle={<><span className="pai-eyebrow">{data.eyebrow}</span> {data.subtitle}</>}
        sections={data.sections.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), label }))}
        storageKey={`ping-ai-product-${product}`}
        printExclude={[]}
        headerNav={
          <nav className="pai-product-nav" aria-label="AI product pages">
            {NAV.map(([key, label]) => <Link className={key === product ? "pai-product-nav__link pai-product-nav__link--active" : "pai-product-nav__link"} key={key} to={slug(key)} aria-current={key === product ? "page" : undefined}>{label}</Link>)}
          </nav>
        }
      >
        <Section id="overview" title="The role it plays">
          <Lede>{data.lede}</Lede>
          <Card className="pai-hero">
            <div className="pai-hero-mark" aria-hidden="true">AI</div>
            <div>
              <p className="pai-hero-kicker">Ping for AI</p>
              <p className="pai-hero-copy">{data.takeaway}</p>
              {firstRun && (
                <div className="pu-actions">
                  <button type="button" className="pu-btn pu-btn--primary" onClick={() => navigate(firstRun[2])}>Start with {firstRun[0]}</button>
                </div>
              )}
            </div>
          </Card>
        </Section>

        <Section id={data.sections[1].toLowerCase().replaceAll(" ", "-")} title={data.sections[1]}>
          <CardGrid>
            {data.capabilities.map(([title, body], index) => (
              <Card key={title}>
                <span className="pai-capability-index">0{index + 1}</span>
                <h3 className="pu-h3">{title}</h3>
                <p className="pu-note">{body}</p>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section id={data.sections[2].toLowerCase().replaceAll(" ", "-")} title={data.sections[2]}>
          {product === "protect" && <PingOneProtectBrowserDemo />}
          {data.runExamples.length > 0 && (
            <CardGrid>
              {data.runExamples.map(([title, description, path, kind]) => (
                <Card tone="neutral" className="pai-run" key={title}>
                  <p className="pai-run__label">{RUN_KIND[kind]}</p>
                  <h3 className="pu-h3"><Link className="pai-run__link" to={path}>{title}</Link></h3>
                  <p className="pu-note">{description}</p>
                  <span className="pai-run__arrow" aria-hidden="true">→</span>
                </Card>
              ))}
            </CardGrid>
          )}
        </Section>

        <Section id={data.sections[3].toLowerCase().replaceAll(" ", "-")} title={data.sections[3]}>
          <div className="pai-flow" role="img" aria-label={`${data.title} flow: ${data.flow.join(", then ")}`}>
            {data.flow.map((node, index) => <div className="pai-flow__item" key={node}><span>{node}</span>{index < data.flow.length - 1 && <i aria-hidden="true" />}</div>)}
          </div>
          <Card tone="neutral" title="Architecture note">
            <p className="pu-status-line">
              <StatusChip tone={product === "protect" ? "info" : "neutral"}>{product === "protect" ? "Live form on this page" : "Explainer only"}</StatusChip>
              {product === "protect" ? "The page collects browser Signals, sends them through the BFF to PingOne Protect, and displays the returned evaluation. It does not make sign-in, MFA, or agent-dispatch decisions." : "This page explains the product’s role in an AI security architecture. Other demo pages are in the navigation; some run live, some mix in simulation, and some only explain."}
            </p>
            {product === "protect" && <p className="pu-note"><a href="https://docs.pingidentity.com/pingone/threat_protection_using_pingone_protect/p1_protect_risk_predictors.html" target="_blank" rel="noreferrer">Read PingOne Protect predictor guidance</a></p>}
          </Card>
        </Section>

        <Section id="takeaway" title={data.sections[4]}>
          <p className="pai-takeaway">{data.takeaway}</p>
          {product === "privilegeA2a" && <A2aDocsLinks />}
          <p className="pai-next">Continue with another layer: <Link to={slug("core")}>identity</Link>, <Link to={slug("gateway")}>enforcement</Link>, <Link to={slug("authorize")}>authorization</Link>, or <Link to={slug("privilegeMcp")}>MCP protection</Link>.</p>
        </Section>
      </LessonLayout>
    </PingPage>
  );
}
