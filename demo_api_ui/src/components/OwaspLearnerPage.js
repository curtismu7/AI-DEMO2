// OwaspLearnerPage.js
// Learner page for the OWASP Securing Agentic Applications Guide v1.0.
// Links the source document and distils the parts most relevant to this demo:
// the key components (KC1-KC6), the 15 agentic threats (T1-T15), the secure
// architectures, the lifecycle controls, and how our use-case catalog maps to
// OWASP (the "how we protect" payoff). Offline-safe: all content is static.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./OwaspLearnerPage.css";

const GUIDE_URL = "https://genai.owasp.org/";
const THREATS_DOC_URL =
  "https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

// KC1-KC6 — the building blocks OWASP says every agentic system is made of.
const KEY_COMPONENTS = [
  {
    id: "KC1",
    name: "Generative Language Models",
    blurb: "The reasoning 'brain' (LLM/MLLM/SLM). Risks: hallucination, goal misalignment, manipulation.",
  },
  {
    id: "KC2",
    name: "Orchestration / Control Flow",
    blurb: "Workflows, hierarchical planning, multi-agent coordination that decide what runs next.",
  },
  {
    id: "KC3",
    name: "Reasoning / Planning",
    blurb: "How tasks are decomposed (ReAct, CoT, Tree-of-Thoughts, plan-and-execute).",
  },
  {
    id: "KC4",
    name: "Memory Modules",
    blurb: "Short- and long-term memory (incl. RAG/vector stores). Prime target for poisoning and leakage.",
  },
  {
    id: "KC5",
    name: "Tool Integration",
    blurb: "How the agent calls external tools/APIs (SDKs, MCP, managed platforms).",
  },
  {
    id: "KC6",
    name: "Operational Environment",
    blurb: "What the agent can actually touch: APIs, code exec, databases, web, OS, critical systems.",
  },
];

// T1-T15 — the OWASP Agentic Security Initiative threat catalog.
// `lane`: "covered" = enforced in the demo today; "planned" = in our use-case
// catalog but the control is still needs-build; "out" = a guardrail/sandbox
// concern outside this demo's identity/authorization focus.
const THREATS = [
  { id: "T1", name: "Memory Poisoning", lane: "out" },
  { id: "T2", name: "Tool Misuse", lane: "covered" },
  { id: "T3", name: "Privilege Compromise", lane: "covered" },
  { id: "T4", name: "Resource Overload", lane: "planned" },
  { id: "T5", name: "Cascading Hallucination", lane: "out" },
  { id: "T6", name: "Intent Breaking & Goal Manipulation", lane: "covered" },
  { id: "T7", name: "Misaligned Behaviors", lane: "out" },
  { id: "T8", name: "Repudiation", lane: "covered" },
  { id: "T9", name: "Identity Spoofing", lane: "covered" },
  { id: "T10", name: "Overwhelming Human-in-the-Loop", lane: "covered" },
  { id: "T11", name: "Unexpected RCE", lane: "out" },
  { id: "T12", name: "Communication Poisoning", lane: "out" },
  { id: "T13", name: "Rogue Agents", lane: "covered" },
  { id: "T14", name: "Human Attacks (on agent trust)", lane: "out" },
  { id: "T15", name: "Human Manipulation", lane: "out" },
];

// Lifecycle controls — section 3 of the guide, condensed to one line each.
const LIFECYCLE = [
  {
    phase: "Design",
    points: [
      "Harden the system prompt; clear DOs/DON'Ts with an implicit-deny topic list.",
      "Define HITL gates for high-impact actions; plan memory access policies.",
      "Authn/authz up front: on-behalf-of identity, least privilege.",
    ],
  },
  {
    phase: "Build & Deploy",
    points: [
      "Sandbox agent/tool execution; SAST + dependency (SCA) scanning.",
      "Secrets in a manager, not config; JIT access + ephemeral credentials.",
      "Separate control-plane from data-plane in multi-agent systems.",
    ],
  },
  {
    phase: "Operate & Runtime",
    points: [
      "Continuous monitoring: tool-call, plan, and memory anomaly detection.",
      "Runtime guardrails on inputs/outputs; rate-limit to protect humans + backends.",
      "Comprehensive, structured, tamper-evident logging with trace IDs.",
    ],
  },
];

// How our use-case catalog (UC1-UC20) answers the OWASP threats it's built for.
const DEMO_MAP = [
  { uc: "UC1, UC16, UC20", threats: "T8, T9", control: "Delegated access with proof (RFC 8693 act-chain) + full audit trail; impersonation blocked.", to: "/actor-token-education" },
  { uc: "UC2, UC3, UC19", threats: "T9, T13", control: "A2A delegation, may_act gate, and per-agent (non-human) identity lifecycle.", to: "/agentic-trust" },
  { uc: "UC4, UC5", threats: "T2, T3", control: "Least-privilege scopes; wrong/insufficient scope is denied.", to: "/scope-audit" },
  { uc: "UC6, UC9", threats: "T3, T6", control: "PingOne Authorize policy decision (deny over-limit; group/entitlement check).", to: "/pingone-authorize" },
  { uc: "UC7, UC8", threats: "T10", control: "Step-up MFA and human-in-the-loop consent for high-value actions.", to: "/pingone-authorize" },
  { uc: "UC10, UC11, UC13", threats: "T3, T9, T13", control: "Confused-deputy, bad-client, and rogue-actor-injection rejected at the gateway.", to: "/mcp-tools" },
  { uc: "UC12, UC17", threats: "T9, T3", control: "Token theft/replay defense (audience binding, DPoP, introspection) + short-lived JIT credentials.", to: "/actor-token-education" },
  { uc: "UC18", threats: "T4", control: "Rate-limit / resource-overload defense at the agent gateway.", to: "/setup?tab=mcp-gateway&subtab=tester" },
];

export default function OwaspLearnerPage() {
  const navigate = useNavigate();
  const [openKc, setOpenKc] = useState(null);

  const coveredCount = THREATS.filter((t) => t.lane === "covered").length;
  const plannedCount = THREATS.filter((t) => t.lane === "planned").length;

  return (
    <div className="owasp-page" data-testid="owasp-learner-page">
      <header className="owasp-header">
        <div className="owasp-badge" aria-hidden="true">OWASP ASI</div>
        <h1>OWASP: Securing Agentic Applications</h1>
        <p className="owasp-subtitle">
          A learner's guide to the OWASP Gen AI Security Project's framework for
          AI-agent security — and how this demo maps to it.
        </p>
        <div className="owasp-doclinks">
          <a className="owasp-doc-primary" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
            Securing Agentic Applications Guide v1.0 — read on genai.owasp.org &rarr;
          </a>
          <span className="owasp-doc-meta">
            OWASP Gen AI Security Project &middot; Agentic Security Initiative &middot; v1.0, July 28&nbsp;2025
          </span>
          <div className="owasp-doc-secondary">
            <a href={THREATS_DOC_URL} target="_blank" rel="noopener noreferrer">
              Companion: Agentic AI Threats &amp; Mitigations
            </a>
            <span className="owasp-dot">&middot;</span>
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
              Licensed CC&nbsp;BY-SA&nbsp;4.0
            </a>
          </div>
        </div>
      </header>

      <section className="owasp-section">
        <h2>What it is</h2>
        <p className="owasp-intro">
          The guide gives builders and defenders concrete, technical controls for
          designing, deploying, and operating secure agentic applications. It
          defines the components every agent is made of (KC1&ndash;KC6), the
          threats that target them (T1&ndash;T15), reference architectures, and a
          lifecycle of practical controls. It complements the OWASP Top&nbsp;10 for
          LLMs by focusing on the new attack surface that <em>agency</em> creates:
          persistent memory, autonomous planning, and tool use.
        </p>
      </section>

      <section className="owasp-section">
        <h2>Key components (KC1&ndash;KC6)</h2>
        <p className="owasp-section-intro">
          Every agentic system is assembled from these six building blocks. Click a card for detail.
        </p>
        <div className="owasp-kc-grid">
          {KEY_COMPONENTS.map((kc) => (
            <button
              key={kc.id}
              type="button"
              className={`owasp-kc-card${openKc === kc.id ? " is-open" : ""}`}
              aria-expanded={openKc === kc.id}
              onClick={() => setOpenKc(openKc === kc.id ? null : kc.id)}
            >
              <span className="owasp-kc-id">{kc.id}</span>
              <span className="owasp-kc-name">{kc.name}</span>
              {openKc === kc.id && <span className="owasp-kc-blurb">{kc.blurb}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="owasp-section">
        <h2>The 15 agentic threats (T1&ndash;T15)</h2>
        <p className="owasp-section-intro">
          OWASP's threat catalog for agentic systems. Green threats are enforced
          by this demo's identity &amp; authorization controls today; amber are in our
          use-case catalog but still being built; the rest belong to guardrail,
          sandboxing, and content-moderation layers.
        </p>
        <div className="owasp-threat-grid">
          {THREATS.map((t) => (
            <div key={t.id} className={`owasp-threat owasp-threat--${t.lane}`}>
              <span className="owasp-threat-id">{t.id}</span>
              <span className="owasp-threat-name">{t.name}</span>
              {t.lane === "covered" && (
                <span className="owasp-threat-tag" title="Enforced by this demo's identity/authz controls today">
                  in scope
                </span>
              )}
              {t.lane === "planned" && (
                <span className="owasp-threat-tag owasp-threat-tag--planned" title="In our use-case catalog; control still being built">
                  planned
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="owasp-section">
        <h2>Reference architectures</h2>
        <div className="owasp-arch-row">
          <div className="owasp-arch">
            <h3>Sequential</h3>
            <p>One LLM, linear workflow, limited tools. Smallest attack surface.</p>
          </div>
          <div className="owasp-arch">
            <h3>Hierarchical</h3>
            <p>Orchestrator decomposes tasks to specialized sub-agents. Adds identity &amp; routing risk.</p>
          </div>
          <div className="owasp-arch">
            <h3>Swarm / Mesh</h3>
            <p>Peer agents collaborate without a strict hierarchy. Hardest to authenticate and trace.</p>
          </div>
        </div>
      </section>

      <section className="owasp-section">
        <h2>Lifecycle controls</h2>
        <div className="owasp-lifecycle">
          {LIFECYCLE.map((stage) => (
            <div key={stage.phase} className="owasp-stage">
              <h3>{stage.phase}</h3>
              <ul>
                {stage.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="owasp-section owasp-section--map">
        <h2>How this demo maps to OWASP</h2>
        <p className="owasp-section-intro">
          Our use-case catalog (UC1&ndash;UC20) is tagged to OWASP threats, so every
          control we show has a citable, vendor-neutral backing. We enforce{" "}
          <strong>{coveredCount} of the 15</strong> threats today — the identity,
          delegation, and authorization ones — with <strong>{plannedCount} more</strong>{" "}
          in the catalog and still being built. The rest are stated as out-of-scope
          rather than faked.
        </p>
        <div className="owasp-map">
          {DEMO_MAP.map((row) => (
            <button
              key={row.uc}
              type="button"
              className="owasp-map-row"
              onClick={() => navigate(row.to)}
              title={`Open ${row.to}`}
            >
              <span className="owasp-map-uc">{row.uc}</span>
              <span className="owasp-map-threats">{row.threats}</span>
              <span className="owasp-map-control">
                {row.control}
                {row.planned && <span className="owasp-map-planned"> (planned)</span>}
              </span>
              <span className="owasp-map-go" aria-hidden="true">&rarr;</span>
            </button>
          ))}
        </div>
        <p className="owasp-outscope">
          <strong>Out of scope for this demo (by design):</strong> memory poisoning (T1),
          cascading hallucination (T5), misaligned behaviors (T7), unexpected RCE (T11),
          communication poisoning (T12), human attacks (T14), human manipulation (T15) —
          these are guardrail / sandboxing / content-moderation concerns, not
          identity &amp; authorization.
        </p>
      </section>
    </div>
  );
}
