import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Section, LessonLayout, Lede, OnThisRun, Status } from "../components/lesson";
import apiClient from "../services/apiClient";
import { markCameFromUseCases } from "../utils/fromUseCasesNav";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
import { useVertical } from "../vertical/useVertical";
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
      ["Prompt injection blocked", "Send a known override attack and see Privilege stop it before the model.", "/llm-gateway?attack=prompt_injection"],
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
  protect: {
    title: "PingOne Protect",
    eyebrow: "Risk signals before agent dispatch",
    accent: "protect",
    subtitle: "Evaluate browser and device risk before an authenticated user request reaches an AI agent.",
    lede: "PingOne Protect adds behavioral risk context to the agent dispatch boundary. The browser Signals SDK supplies device and bot signals, and the BFF asks Protect to evaluate the signed-in user’s request before it can reach an agent tool.",
    capabilities: [
      ["Collect browser signals", "The Signals SDK gathers device and AI-agent indicators in the browser and sends its payload only to the BFF."],
      ["Evaluate request context", "The BFF submits the signed-in user, client IP, browser, session, and available Signals data to PingOne Protect."],
      ["Combine configured predictors", "Depending on the tenant's risk policy and available context, Protect can use Bot Detection, New Device, IP Reputation, User Velocity, Geovelocity Anomaly, and Adversary-in-the-Middle predictors."],
      ["Return risk evidence", "Protect returns a risk level, recommended action, and available bot-detection details for the request. The active tenant policy determines which predictors contribute."],
      ["Gate agent dispatch", "The demo blocks HIGH risk and deny-style recommendations such as BOT_MITIGATION, then fails closed if Protect returns an unknown level."],
    ],
    runExamples: [],
    flow: ["Browser Signals SDK", "BFF risk evaluation", "PingOne Protect", "Dispatch policy", "Authorized agent tool"],
    sections: ["Overview", "Risk signals", "Run the demo", "Evaluation path", "Takeaway"],
    takeaway: "Evaluate risk before an agent acts, then keep the existing authorization and MCP controls in the path for requests that continue.",
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

const PROTECT_USE_CASE = {
  id: "UC36",
  useCaseId: "protect-agent-dispatch-risk",
  title: "PingOne Protect — detect AI agent dispatch",
  trigger: { type: "chip", text: "show my balance" },
  primaryTool: "get_account_balance",
  expectedOutcome: "PERMIT",
  evidence: { tokenChain: ["user-token", "protect-risk-evaluation", "tool-dispatched"], activity: ["token", "protect", "mcp"] },
  maturity: "flag:ff_protect_agent_dispatch",
};

export default function PingAiProductPage({ product = "core" }) {
  const data = PRODUCTS[product] || PRODUCTS.core;
  const navigate = useNavigate();
  const { activeId } = useVertical();
  const [runState, setRunState] = useState("idle");
  const [runError, setRunError] = useState("");

  const runProtectDemo = async () => {
    const vertical = activeId || "banking";
    setRunState("running");
    setRunError("");

    const flags = requiredFlagsForUseCase(PROTECT_USE_CASE);
    if (flags.length) {
      const updates = Object.fromEntries(flags.map((flag) => [flag, true]));
      try {
        await apiClient.patch("/api/admin/feature-flags", { updates }, { _noAuthBanner: true });
      } catch (error) {
        // Match the use-case launcher: a non-admin cannot arm a flag, but an
        // already-enabled demo remains runnable and the BFF is authoritative.
        console.warn("[PingAiProductPage] Could not auto-enable Protect demo flags:", error.message);
      }
    }

    try {
      const { data: run } = await apiClient.post("/api/use-cases/demo/run", {
        useCaseId: PROTECT_USE_CASE.useCaseId,
        vertical,
      });
      await apiClient.post("/api/verticals/active", { id: vertical });
      markCameFromUseCases();
      navigate("/dashboard", {
        state: {
          useCaseId: run.useCaseId,
          triggerText: run.triggerText,
          type: run.type,
          vertical,
          runContext: {
            source: "use-cases",
            useCaseId: PROTECT_USE_CASE.useCaseId,
            useCaseLabel: PROTECT_USE_CASE.title,
            triggerText: PROTECT_USE_CASE.trigger.text,
            expectedOutcome: PROTECT_USE_CASE.expectedOutcome,
            evidence: PROTECT_USE_CASE.evidence,
          },
        },
      });
    } catch (error) {
      setRunState("error");
      setRunError(error?.response?.data?.message || error.message || "Could not start the PingOne Protect demo.");
    }
  };

  return (
    <LessonLayout
      pageClassName="pai-lesson-page"
      title={data.title}
      subtitle={<><span className={`pai-eyebrow pai-eyebrow--${data.accent}`}>{data.eyebrow}</span> {data.subtitle}</>}
      sections={data.sections.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), label }))}
      storageKey={`ping-ai-product-${product}`}
      printExclude={[]}
      headerNav={
        <nav className="pai-product-nav" aria-label="AI product pages">
          {NAV.map(([key, label]) => <Link className={key === product ? "pai-product-nav__link pai-product-nav__link--active" : "pai-product-nav__link"} key={key} to={slug(key)}>{label}</Link>)}
        </nav>
      }
    >
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
        {product === "protect" && (
          <div className="pai-protect-action">
            <p>Run UC36 with the active vertical. The dashboard will collect Signals, evaluate the request, and show whether the Protect result permits or blocks agent dispatch.</p>
            <button type="button" onClick={runProtectDemo} disabled={runState === "running"} aria-busy={runState === "running"}>
              {runState === "running" ? "Starting Protect demo…" : "Run PingOne Protect demo"}
            </button>
            {runError && <p className="pai-protect-action__error" role="alert">{runError}</p>}
          </div>
        )}
        {data.runExamples.length > 0 && (
          <div className="pai-run-grid">
            {data.runExamples.map(([title, description, path]) => <Link className="pai-run" key={title} to={path}><span className="pai-run__label">Open agent run</span><h3>{title}</h3><p>{description}</p><span className="pai-run__arrow" aria-hidden="true">→</span></Link>)}
          </div>
        )}
      </Section>

      <Section id={data.sections[3].toLowerCase().replaceAll(" ", "-")} title={data.sections[3]}>
        <div className="pai-flow" aria-label={`${data.title} flow`}>
          {data.flow.map((node, index) => <div className="pai-flow__item" key={node}><span>{node}</span>{index < data.flow.length - 1 && <i aria-hidden="true" />}</div>)}
        </div>
        <OnThisRun title="Architecture note"><p><Status ok>Boundary defined</Status> {product === "protect" ? "Predictor results depend on the risk policy configured in your PingOne environment and the event context available to it. PingOne Protect returns the risk result; this demo applies the dispatch decision." : "This page explains the product’s role in an AI security architecture. Live demo routes and inspectors remain available in the navigation."}</p>
          {product === "protect" && <p>Protect also prioritizes a routable public client IP for IP-based signals; when the request IP is private, Signals data can help identify the user’s public IP.</p>}
          {product === "protect" && <p><a href="https://docs.pingidentity.com/pingone/threat_protection_using_pingone_protect/p1_protect_risk_predictors.html" target="_blank" rel="noreferrer">Read PingOne Protect predictor guidance</a></p>}
        </OnThisRun>
      </Section>

      <Section id="takeaway" title={data.sections[4]}>
        <p className="pai-takeaway">{data.takeaway}</p>
        <p className="pai-next">Continue with another layer: <Link to={slug("core")}>identity</Link>, <Link to={slug("gateway")}>enforcement</Link>, <Link to={slug("authorize")}>authorization</Link>, or <Link to={slug("privilegeMcp")}>MCP protection</Link>.</p>
      </Section>
    </LessonLayout>
  );
}
