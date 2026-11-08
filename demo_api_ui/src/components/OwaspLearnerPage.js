// OwaspLearnerPage.js
// Learner page for the OWASP Securing Agentic Applications Guide v1.0.
// Links the source document and distils the parts most relevant to this demo:
// the key components (KC1-KC6), the 15 agentic threats (T1-T15), the secure
// architectures, the lifecycle controls, and how our use-case catalog maps to
// OWASP (the "how we protect" payoff). Offline-safe: all content is static.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips,
// P9 buttons. Skipped: P6 (no inspector) and P8 (no diagram). P9 "one primary per
// view": this page has one view state, so the one primary is the link to the source
// guide (the page's single call to action). The theme toggle, the KC disclosure
// buttons and the demo-map rows are bordered secondaries.
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeOptional } from "../context/ThemeContext";
import PageHeader from "./common/PageHeader";
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from "./pingUi";
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
  { uc: "UC10, UC11, UC13", threats: "T3, T9, T13", control: "Confused-deputy, bad-client, and rogue-actor-injection rejected at the gateway.", to: "/mcp-inspector" },
  { uc: "UC12, UC17", threats: "T9, T3", control: "Token theft/replay defense (audience binding, DPoP, introspection) + short-lived JIT credentials.", to: "/actor-token-education" },
  { uc: "UC18", threats: "T4", control: "Rate-limit / resource-overload defense at the agent gateway.", to: "/agent-gateway-capabilities" },
];

const LANES = [
  {
    lane: "covered",
    tone: "ok",
    word: "In scope",
    heading: "Enforced by this demo",
    note: "Identity, delegation and authorization controls this demo shows today.",
  },
  {
    lane: "planned",
    tone: "warn",
    word: "Planned",
    heading: "In the catalog, still being built",
    note: "A use case exists, but the control is not built yet.",
  },
  {
    lane: "out",
    tone: "neutral",
    word: "Out of scope",
    heading: "Left to other layers",
    note: "Guardrail, sandboxing and content-moderation concerns, not identity or authorization.",
  },
];

export default function OwaspLearnerPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const navigate = useNavigate();
  const [openKc, setOpenKc] = useState(null);

  const coveredCount = THREATS.filter((t) => t.lane === "covered").length;
  const plannedCount = THREATS.filter((t) => t.lane === "planned").length;

  return (
    <PingPage className="owasp-page" data-testid="owasp-learner-page">
      <SimBanner data-testid="owasp-banner">
        <strong>STATIC LESSON</strong> &mdash; nothing on this page is simulated, called live, or produces
        sample attack output. The text summarizes the OWASP guide, and the &ldquo;in scope&rdquo; and
        &ldquo;planned&rdquo; labels are this demo&apos;s own mapping, not an OWASP rating and not tested
        here. The use-case rows open the demo pages where the controls actually run.
      </SimBanner>
      <PageHeader
        eyebrow="Learn · AI Experiences"
        title="OWASP: Securing Agentic Applications"
        summary="A learner's guide to the OWASP Gen AI Security Project's framework for AI-agent security — and how this demo maps to it."
        badge="OWASP ASI"
        actions={
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn owasp-theme-toggle"
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
          </button>
        }
      />
      <PageFrame>
        <Section
          id="owasp-what-h"
          kicker="1 · The guide"
          title="What it is"
          lede={
            <>
              The guide gives builders and defenders concrete, technical controls for
              designing, deploying, and operating secure agentic applications. It
              defines the components every agent is made of (KC1&ndash;KC6), the
              threats that target them (T1&ndash;T15), reference architectures, and a
              lifecycle of practical controls. It complements the OWASP Top&nbsp;10 for
              LLMs by focusing on the new attack surface that <em>agency</em> creates:
              persistent memory, autonomous planning, and tool use.
            </>
          }
        >
          <CardGrid>
            <Card title="Source document" data-testid="owasp-source">
              <KvList
                items={[
                  { label: "Published by", value: "OWASP Gen AI Security Project · Agentic Security Initiative" },
                  { label: "Version", value: "v1.0, July 28\u00a02025" },
                  {
                    label: "Companion",
                    value: (
                      <a href={THREATS_DOC_URL} target="_blank" rel="noopener noreferrer">
                        Agentic AI Threats &amp; Mitigations
                      </a>
                    ),
                  },
                  {
                    label: "Licence",
                    value: (
                      <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
                        CC&nbsp;BY-SA&nbsp;4.0
                      </a>
                    ),
                  },
                ]}
              />
              <div className="pu-actions">
                <a
                  className="pu-btn pu-btn--primary owasp-guide-link"
                  href={GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the guide on genai.owasp.org
                </a>
              </div>
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="owasp-kc-h"
          kicker="2 · Building blocks"
          title="Key components (KC1–KC6)"
          lede="Every agentic system is assembled from these six building blocks. Select a card for detail."
        >
          <CardGrid>
            {KEY_COMPONENTS.map((kc) => {
              const isOpen = openKc === kc.id;
              return (
                <Card key={kc.id} className="owasp-kc" data-testid={`owasp-kc-${kc.id}`}>
                  <button
                    type="button"
                    className="pu-btn owasp-kc-toggle"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? `owasp-kc-blurb-${kc.id}` : undefined}
                    onClick={() => setOpenKc(isOpen ? null : kc.id)}
                  >
                    <span className="owasp-kc-id">{kc.id}</span>
                    <span className="owasp-kc-name">{kc.name}</span>
                    <span className="owasp-kc-cue">{isOpen ? "Hide detail" : "Show detail"}</span>
                  </button>
                  {isOpen && (
                    <p className="pu-note" id={`owasp-kc-blurb-${kc.id}`}>{kc.blurb}</p>
                  )}
                </Card>
              );
            })}
          </CardGrid>
        </Section>

        <Section
          id="owasp-threats-h"
          kicker="3 · Threat catalog"
          title="The 15 agentic threats (T1–T15)"
          lede="OWASP's threat catalog for agentic systems, grouped by how this demo treats each one. Threats in scope are enforced by this demo's identity & authorization controls today; planned ones are in our use-case catalog but still being built; the rest belong to guardrail, sandboxing, and content-moderation layers."
        >
          <CardGrid>
            {LANES.map(({ lane, tone, word, heading, note }) => {
              const items = THREATS.filter((t) => t.lane === lane);
              return (
                <Card key={lane} tone={tone} title={heading} data-testid={`owasp-lane-${lane}`}>
                  <p className="pu-status-line">
                    <StatusChip tone={tone}>{word}</StatusChip>
                    <span>{items.length} of {THREATS.length} threats</span>
                  </p>
                  <p className="pu-note">{note}</p>
                  <ul className="owasp-threat-list">
                    {items.map((t) => (
                      <li key={t.id} className="owasp-threat">
                        <span className="owasp-threat-id">{t.id}</span>
                        <span className="owasp-threat-name">{t.name}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </CardGrid>
        </Section>

        <Section id="owasp-arch-h" kicker="4 · Architectures" title="Reference architectures">
          <CardGrid>
            <Card title="Sequential">
              <p className="pu-note">One LLM, linear workflow, limited tools. Smallest attack surface.</p>
            </Card>
            <Card title="Hierarchical">
              <p className="pu-note">Orchestrator decomposes tasks to specialized sub-agents. Adds identity &amp; routing risk.</p>
            </Card>
            <Card title="Swarm / Mesh">
              <p className="pu-note">Peer agents collaborate without a strict hierarchy. Hardest to authenticate and trace.</p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="owasp-life-h" kicker="5 · Lifecycle" title="Lifecycle controls">
          <CardGrid>
            {LIFECYCLE.map((stage) => (
              <Card key={stage.phase} title={stage.phase}>
                <ul className="owasp-stage-list">
                  {stage.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section
          id="owasp-map-h"
          kicker="6 · This demo"
          title="How this demo maps to OWASP"
          lede={
            <>
              Our use-case catalog (UC1&ndash;UC20) is tagged to OWASP threats, so every
              control we show has a citable, vendor-neutral backing. We enforce{" "}
              <strong>{coveredCount} of the 15</strong> threats today — the identity,
              delegation, and authorization ones — with <strong>{plannedCount} more</strong>{" "}
              in the catalog and still being built. The rest are stated as out-of-scope
              rather than faked.
            </>
          }
        >
          <div className="owasp-map">
            {DEMO_MAP.map((row) => (
              <button
                key={row.uc}
                type="button"
                className="pu-btn owasp-map-row"
                onClick={() => navigate(row.to)}
                title={`Open ${row.to}`}
              >
                <span className="owasp-map-uc">{row.uc}</span>
                <span className="owasp-map-threats">{row.threats}</span>
                <span className="owasp-map-control">
                  {row.control}
                  {row.planned && <StatusChip tone="warn">planned</StatusChip>}
                </span>
                <span className="owasp-map-go" aria-hidden="true">&rarr;</span>
              </button>
            ))}
          </div>
          <p className="pu-note">
            <strong>Out of scope for this demo (by design):</strong> memory poisoning (T1),
            cascading hallucination (T5), misaligned behaviors (T7), unexpected RCE (T11),
            communication poisoning (T12), human attacks (T14), human manipulation (T15) —
            these are guardrail / sandboxing / content-moderation concerns, not
            identity &amp; authorization.
          </p>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
