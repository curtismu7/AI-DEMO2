// AgentGuardrailsDiagram.jsx
// Lucid-style reference diagram of the Ping agent guardrail chain:
// actors -> identity -> runtime enforcement -> risk + oversight -> resources.
// Scenario chips highlight the subset of cards relevant to each threat story.
import React, { useState, useCallback } from "react";
import "./AgentGuardrailsDiagram.css";

const SCENARIOS = [
  { id: "default", label: "Full guardrail flow" },
  { id: "findagents", label: "Find agents" },
  { id: "impersonation", label: "Impersonation" },
  { id: "overprivilege", label: "Over-privilege" },
  { id: "risky", label: "Risky behavior" },
  { id: "secrets", label: "Secret exposure" },
];

// Single source of truth for scenario copy. The original HTML kept a
// scenarioCopy + summaryCopy pair that restated each other; we keep one
// talk track and render it in both places.
const TALK_TRACK = {
  default:
    "Ping treats the agent as its own identity, gives it scoped delegated authority, checks every action at runtime, adds risk signals, can surface newly seen agents into Governance for AI, and forces human approval when the action crosses a high-risk boundary.",
  findagents:
    "Agent Gateway sees new tool-using agents, endpoint controls can surface new endpoint agents, and Governance for AI becomes the system of record for bringing them under policy and oversight.",
  impersonation:
    "The agent must use its own identity and delegated authority instead of borrowing a human login, while Protect helps detect suspicious non-human behavior pretending to be something it is not.",
  overprivilege:
    "Ping limits what the agent can do through delegated entitlements, runtime policy, and just-in-time access instead of standing broad permissions.",
  risky:
    "Protect adds risk signals and Authorize can force step-up or human approval when behavior looks abnormal or the requested action is too sensitive.",
  secrets:
    "The gateway and privileged access layers broker access so the agent gets tightly scoped outcomes without being handed reusable credentials or secrets.",
};

// Cards keyed by id; each card lists the scenarios it belongs to.
const CARDS = [
  {
    key: "actor-human",
    lane: "actors",
    kind: "actor",
    title: "Human sponsor / operator",
    body: "The human initiates intent and can remain accountable for sensitive outcomes.",
    tags: [{ label: "Owner" }, { label: "Approval point", kind: "risk" }],
    scenarios: ["default", "impersonation"],
  },
  {
    key: "actor-agent",
    lane: "actors",
    kind: "actor",
    title: "AI agent / runtime",
    body: "The agent can plan and act, but it should never inherit raw human credentials or unlimited standing access.",
    tags: [
      { label: "No shared creds", kind: "danger" },
      { label: "Task execution" },
    ],
    scenarios: ["default", "overprivilege", "risky", "secrets"],
  },
  {
    key: "iam-core",
    lane: "identity",
    kind: "identity",
    title: "Agent IAM Core",
    body: "Registers the agent as a first-class non-human identity with its own credentials, ownership, lifecycle controls, and delegated authority.",
    tags: [
      { label: "Unique agent identity", kind: "identity" },
      { label: "Delegation", kind: "identity" },
    ],
    scenarios: ["default", "impersonation", "overprivilege"],
  },
  {
    key: "gateway",
    lane: "runtime",
    kind: "runtime",
    title: "Agent Gateway / Ping Gateway",
    body: "Sits in front of MCP servers, APIs, and tools to validate requests, enforce least privilege, centralize runtime control, and surface newly observed agents so they can be added into Governance for AI.",
    tags: [
      { label: "PEP", kind: "runtime" },
      { label: "MCP / API control", kind: "runtime" },
      { label: "Discover new agents", kind: "identity" },
    ],
    scenarios: ["default", "overprivilege", "secrets"],
  },
  {
    key: "authorize",
    lane: "runtime",
    kind: "runtime",
    title: "PingOne Authorize",
    body: "Evaluates each action against policy, context, risk, scope, and intent so the agent receives only the minimum authority needed for the current task.",
    tags: [
      { label: "Per-action policy", kind: "runtime" },
      { label: "JIT / scoped access", kind: "runtime" },
    ],
    scenarios: ["default", "overprivilege", "risky"],
  },
  {
    key: "protect",
    lane: "risk",
    kind: "risk",
    title: "PingOne Protect",
    body: "Continuously scores runtime risk and can distinguish legitimate agents from malicious bots or suspicious AI/browser behavior, then trigger the right response.",
    tags: [
      { label: "Risk signals", kind: "risk" },
      { label: "Agent detection", kind: "risk" },
    ],
    scenarios: ["default", "risky", "impersonation"],
  },
  {
    key: "oversight",
    lane: "risk",
    kind: "risk",
    title: "Governance for AI + human approval",
    body: "High-impact steps can require approval, and every action can be logged for audit, accountability, review, and ongoing governance of newly observed agents.",
    tags: [
      { label: "HITL", kind: "risk" },
      { label: "Audit trail", kind: "risk" },
    ],
    scenarios: ["default", "risky", "overprivilege"],
  },
  {
    key: "privilege",
    lane: "risk",
    kind: "risk",
    title: "Agent Privilege",
    body: "Desktop and coding agents get access to resources without being handed the underlying secrets, reducing standing privilege and secret sprawl.",
    tags: [
      { label: "No secret handoff", kind: "danger" },
      { label: "Privileged access", kind: "risk" },
    ],
    scenarios: ["default", "secrets"],
  },
  {
    key: "endpoint-jit",
    lane: "risk",
    kind: "risk",
    title: "Endpoint agent + JIT privileged access",
    body: "If the agent is running on an endpoint for a privileged user, Ping can broker just-in-time access so the agent receives time-bound elevation for the task instead of broad standing privilege, and newly observed endpoint agents can also be brought into Governance for AI.",
    tags: [
      { label: "Endpoint agent", kind: "risk" },
      { label: "JIT access", kind: "runtime" },
      { label: "Protect privileged users", kind: "danger" },
      { label: "Enroll into governance", kind: "identity" },
    ],
    scenarios: ["default", "overprivilege", "secrets"],
  },
  {
    key: "resources",
    lane: "resources",
    kind: "resource",
    title: "MCP servers, SaaS apps, APIs, data, repos",
    body: "Resources are exposed to the agent only through policy-aware access paths, not by trusting the agent outright.",
    tags: [
      { label: "Tool use" },
      { label: "Controlled resource access" },
    ],
    scenarios: ["default", "overprivilege", "secrets"],
  },
];

const LANES = [
  { id: "actors", title: "Actors" },
  { id: "identity", title: "Identity guardrails" },
  { id: "runtime", title: "Runtime enforcement" },
  { id: "risk", title: "Risk + oversight" },
  { id: "resources", title: "Protected resources" },
];

// "Stopped:" callouts — one per threat scenario. findagents has no callout
// (it is a discovery story, not a stop), so the grid hides itself for that
// scenario instead of leaving four half-opacity placeholders.
const CALLOUTS = [
  {
    scenario: "impersonation",
    title: "Stopped: human impersonation",
    body: "The agent gets its own identity and delegated authority instead of borrowing a human login.",
  },
  {
    scenario: "overprivilege",
    title: "Stopped: over-privileged actions",
    body: "Policy and JIT scope keep the agent inside the exact action boundary for the task.",
  },
  {
    scenario: "risky",
    title: "Stopped: abnormal or malicious behavior",
    body: "Risk signals and agent detection can block, challenge, or escalate before damage happens.",
  },
  {
    scenario: "secrets",
    title: "Stopped: secret leakage",
    body: "Privileged access is brokered so the agent gets access outcomes, not raw reusable secrets.",
  },
];

const LEGEND = [
  { className: "", label: "Normal request path" },
  { className: "good", label: "Allowed only after policy checks" },
  { className: "risk", label: "Block / challenge / approval boundary" },
];

export default function AgentGuardrailsDiagram() {
  const [scenario, setScenario] = useState("default");
  const isActive = useCallback(
    (card) =>
      scenario === "default" || card.scenarios.includes(scenario),
    [scenario],
  );

  const handleSelect = useCallback(
    (id) => setScenario(id),
    [],
  );

  const showCallouts = scenario !== "findagents";

  return (
    <div className="agd-root">
      <section className="agd-hero">
        <span className="agd-eyebrow">
          Lucid-style reference diagram • Identity for AI
        </span>
        <h1>How Ping keeps an AI agent from doing bad things</h1>
        <p className="agd-subhead">
          This diagram shows the control chain from agent identity, to
          delegated access, to per-action enforcement, to runtime risk
          detection and human oversight — so the agent can act, but only
          inside explicit guardrails.
        </p>
      </section>

      <section className="agd-scenario-panel" aria-label="Scenario selector">
        <div className="agd-scenario-row" role="group" aria-label="Guardrail scenarios">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`agd-chip${scenario === s.id ? " active" : ""}`}
              aria-pressed={scenario === s.id}
              onClick={() => handleSelect(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="agd-scenario-copy" aria-live="polite">
          {TALK_TRACK[scenario]}
        </p>
      </section>

      <section className="agd-diagram" aria-label="Guardrail flow diagram">
        {LANES.map((lane) => (
          <div key={lane.id} className="agd-lane">
            <div className="agd-lane-title">{lane.title}</div>
            {CARDS.filter((c) => c.lane === lane.id).map((card) => {
              const active = isActive(card);
              const muted = scenario !== "default" && !active;
              return (
                <article
                  key={card.key}
                  className={`agd-card ${card.kind}${active ? " agd-active-card" : ""}${muted ? " agd-muted-card" : ""}`}
                  aria-current={active && scenario !== "default" ? "true" : undefined}
                >
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <div className="agd-tags">
                    {card.tags.map((tag) => (
                      <span
                        key={tag.label}
                        className={`agd-tag${tag.kind ? ` ${tag.kind}` : ""}`}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
      </section>

      {showCallouts && (
        <section className="agd-callout-grid" aria-label="Threats stopped">
          {CALLOUTS.map((c) => {
            const match = scenario === "default" || c.scenario === scenario;
            return (
              <article
                key={c.scenario}
                className={`agd-callout${match ? " good" : ""}${!match ? " agd-muted-callout" : ""}`}
              >
                <h4>{c.title}</h4>
                <p>{c.body}</p>
              </article>
            );
          })}
        </section>
      )}

      <div className="agd-legend" aria-hidden="true">
        {LEGEND.map((l) => (
          <span key={l.label} className="agd-legend-item">
            <span className={`agd-swatch${l.className ? ` ${l.className}` : ""}`} />
            {l.label}
          </span>
        ))}
      </div>

      <section className="agd-summary">
        <strong>Talk track:</strong> {TALK_TRACK[scenario]}
      </section>

      <p className="agd-footer-note">
        Designed as a clean Lucid-style reference view for customer
        conversations, with scenario toggles you can use to explain how Ping
        prevents agent impersonation, overreach, risky behavior, secret
        exposure, and how Ping finds new agents.
      </p>
    </div>
  );
}
