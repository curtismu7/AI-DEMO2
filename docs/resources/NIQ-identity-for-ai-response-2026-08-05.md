# NIQ (NielsenIQ) — What They're Asking For vs. What Ping Identity + This Demo Already Show

Source: Aug 5, 2026 SE call notes (Pete Ross, David Gwizdala, John Baker / Sandeep Bommisetti, Otis Garner, Ralph Ciotkowski)

---

## 1. What NIQ is asking for

Distilled from the notes into four asks:

1. **Centralize NHI inventory** — no central view of agents/service accounts/service principals across AWS/GCP/Azure/on-prem. Want one place that includes agents, prompts, and service accounts, with attributes.
2. **Identity governance for agents (JML)** — how are agents joined/certified/approved, the way humans are. **Caveat: they're locked into SailPoint for IGA** — don't lead with "replace your IGA," lead with "feed your IGA."
3. **Runtime authorization + telemetry** — a centralized layer that authorizes and logs what an agent does at execution time, notifies on new/unexpected access, ties back to identity. Explicit ask: "notified if an agent gets access to something."
4. **Kill switch** — ability to disable an agent's actions immediately.

Secondary signals: multi-cloud/platform-agnostic is important to them; cost-sensitivity (Otis expects the "AI bubble" to deflate and budget to tighten); they want to see partner proof points, not theory.

---

## 2. Ping Identity's company-level answer: the 5-pillar Identity for AI model

| Pillar | Answers which NIQ ask | Primary Ping surface |
|---|---|---|
| **Agent Identity** | #1 Centralize (registration, ownership) | PingOne AI Agents feature (Agent IAM Core license), PingOne AIC `/aiagent/register` DCR, PingFederate DCR |
| **Agent Security** | #3 Runtime authz, #4 Kill switch | PingOne/PingFederate OAuth 2.0 AS — client credentials, `private_key_jwt`/mTLS, scoped short-TTL tokens, RFC 8693 delegation, revocation |
| **Agent Gateway** | #3 Runtime telemetry ("which gateways do we even have") | PingGateway Agent Gateway module (MCP audit/protection/validation filters) — sits in front of MCP servers/APIs, centralized audit trail |
| **Agent Detection** | #1 "shadow AI" / unmanaged agent traffic | PingOne Protect bot-detection predictor — flags agentic AI/CUA traffic distinctly from human traffic |
| **AI App Auth + Verified Trust** | #2 delegation model, cross-boundary trust | RFC 8693 token exchange, PingOne Credentials / DaVinci Verified Trust |

**Positioning for the SailPoint constraint:** Ping doesn't need to win IGA. The pitch is Ping as the **machine identity + runtime control plane** that SailPoint doesn't cover — agent registration, live token issuance/scoping/revocation, and runtime authorization decisions — with agent attributes and lifecycle events exportable **into** SailPoint's governance/certification process rather than replacing it.

---

## 3. What this demo (AI-DEMO2) already proves, ask by ask

### Ask #1 — Centralized NHI inventory / "don't know full scope of the AI ecosystem"

**AI Control Plane / roster** — [ControlPlaneRoster.jsx](../../demo_api_ui/src/components/ControlPlaneRoster.jsx)
- Live view of every active agent session (SSE-driven, `useAppEventsSSE`), not a static list — this is the "runtime overview of agents" Atul asked for directly.
- Each entry is attributable to an identity, an audit count is tracked per session.
- Reached via **Agent Lifecycle** nav ([AdminSideNav.jsx:486](../../demo_api_ui/src/components/AdminSideNav.jsx#L486)).

**Gap to flag honestly:** this is one demo environment's agents, not a multi-cloud/multi-platform aggregator. The real PingOne **AI Agents** admin surface (Directory > AI Agents) is the product answer to "one inventory across everything," and it requires the Agent IAM Core license — the demo doesn't currently exercise that specific surface, it exercises the runtime/control-plane half.

### Ask #2 — Governance / JML for agents (with SailPoint already in place)

- [AgentLifecyclePage.jsx](../../demo_api_ui/src/pages/AgentLifecyclePage.jsx) walks the actual lifecycle stages live: **(1)** register agent + scoped consent → **(2)** agent calls MCP with a scoped, revocable token → **(3)** step-up approval (CIBA) on a sensitive action → **(4)** self-service revoke.
- That first stage — registration with scoped consent — is the JML "join" moment for an agent, demonstrable end-to-end rather than described.
- **Framing for NIQ:** this is the piece that would hand off attributes/events to SailPoint for certification, not a competing IGA.

### Ask #3 — Runtime authorization + telemetry, "notify me if an agent gets new access"

- **RFC 8693 token exchange chain** — [TokenChainContext.js](../../demo_api_ui/src/context/TokenChainContext.js), [TokenChainDisplay.jsx](../../demo_api_ui/src/components/TokenChainDisplay.jsx) — shows the actual delegated-token chain (`sub` + `act.sub`) an agent used for a given action, not just a log line.
- **Policy Decision Trace** — [PolicyDecisionTracePage.jsx](../../demo_api_ui/src/components/PolicyDecisionTracePage.jsx) — records and replays the authorization decision itself (PingOne Authorize / P1AZ), so "why was this permitted/denied" is answerable after the fact, matching Sandeep's ask for certification/audit visibility.
- **Agent Gateway** — [AgentGatewayCapabilitiesPage.jsx](../../demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx) documents the gateway sitting in front of MCP tool calls — directly answers "we have some gateways but unsure which ones do what."
- **Guardrails** — [AgentGuardrailsPage.jsx](../../demo_api_ui/src/pages/AgentGuardrailsPage.jsx) / [AgentGuardrailsDiagram.jsx](../../demo_api_ui/src/components/AgentGuardrailsDiagram.jsx).

### Ask #4 — Kill switch

- Fully live, not mocked: [KillSwitchConfirmModal.jsx](../../demo_api_ui/src/components/KillSwitchConfirmModal.jsx) → `POST /api/admin/agent/:id/kill-switch` with a `reason` and `scope`.
- **Scope matters for the NIQ pitch:** the demo distinguishes killing one agent instance vs. the agent's full grant — i.e., "disable this one runaway session" vs. "revoke everything this agent type can do," which is the nuance Sandeep's question implies he actually needs (a single compromised instance shouldn't require nuking the whole agent class).
- Demonstrated twice in the same page: admin-initiated kill (stage 2 of the lifecycle) and self-service revoke (stage 4), same underlying mechanism both times — proves it's a real control, not a demo-only button.

### Cross-cutting: the framework to hang all of this on

- [TRiSMTrainingPanel.jsx](../../demo_api_ui/src/components/TRiSMTrainingPanel.jsx) / [TRiSMSlide.jsx](../../demo_api_ui/src/components/TRiSMSlide.jsx) implement **Gartner AI TRiSM** (Trust, Risk & Security Management) as the narrative spine: Trust & Transparency, Risk Management & Assurance, Security & Privacy by Design, Governance/Compliance/Accountability, Lifecycle Management & Observability, Identity/Access/Least Privilege.
- This is useful **specifically** because NIQ's asks map cleanly onto TRiSM's own categories — it gives Otis/Sandeep an analyst-validated frame to take back to execs, instead of "trust the vendor."

---

## 4. What's NOT in the demo (say this up front, don't let them discover it)

- No live multi-cloud NHI aggregation (AWS/GCP/Azure/on-prem) — the demo's inventory is one control plane, not a cross-cloud discovery/CMDB feed.
- PingOne AI Agents managed-identity feature and AIC `/aiagent/register` DCR endpoint are **licensed/roadmap surfaces**, not wired into this demo's code path.
- Verified Trust (cross-org signed assertions) isn't exercised in this repo.
- PingOne Protect bot-detection-for-agents isn't demonstrated here (see `ping-universal-services` for that).
- No SailPoint integration exists in this repo — the "feed IGA, don't replace it" story is a positioning argument for the call, not a built connector.

---

## 5. Suggested next step for the SE follow-up

Lead the next NIQ session with **Agent Lifecycle** end-to-end (registration → scoped token → CIBA step-up → kill switch) since it hits three of their four asks in one continuous flow, then layer in **Policy Decision Trace** for the audit/certification angle, explicitly positioned as "exports into whatever governs JML today" — not a SailPoint replacement.
