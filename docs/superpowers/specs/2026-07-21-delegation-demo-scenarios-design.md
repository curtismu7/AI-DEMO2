# Delegation Demo Scenarios — Design (Phase 1: Script)

**Date:** 2026-07-21
**Status:** Design approved (spine + 4-stage arc). This doc IS the Phase-1 deliverable
(the SE runbook) and doubles as the spec for the Phase-2 wiring pass.

## Purpose

Give an SE a single, sharper delegation story to present. Four stages, one
escalating arc, one identity primitive shown four ways. Not new plumbing —
storytelling and click-paths over surfaces that already exist (gaps flagged
per stage under *Wiring notes*).

- **Audience being demoed to:** technical identity / security (IAM buyer).
  Payoff beats emphasize the `act` claim, RFC 8693 token exchange, gateway +
  PingOne Authorize enforcement, and the live Token Chain panel.
- **Deliverable form:** written runbook now; app wiring later (Phase 2).
- **Structure:** continuous arc with modular exits — each stage ends on a
  "here's the proof" beat, so an SE can stop after any stage.

## Through-line — "Prove who's acting for me"

A principal hands authority to progressively more autonomous actors — a spouse,
an AI agent, that agent's specialist sub-agent, and finally (enterprise pivot)
an employee under a manager. The identity question never changes: *can the
system prove who is really acting, and with exactly what authority?* Ping
answers it identically every time — **RFC 8693 token exchange stamps an `act`
claim; the gateway + PingOne Authorize enforce the delegated scope.** One
delegation primitive, four escalating actors.

Stages 1–3 escalate actor autonomy in a **consumer** world (persona: Maya, a
Super Bank customer). Stage 4 pivots to the **enterprise** (personas: employee
+ manager, WX Workforce) — same primitive, plus a human approval gate
(separation of duties). Closing on a human-in-the-loop after the agent-autonomy
peak is deliberate.

## Cross-cutting payoff vocabulary (say these at every proof beat)

- **`act` claim** — the token literally names who is acting for whom. Not
  hand-rolled attribution; it's in the token.
- **RFC 8693 token exchange** — the user's token is exchanged for a narrowed,
  delegated token. Scope shrinks; the actor is recorded.
- **Gateway + PingOne Authorize** — every call is validated (`aud`, `exp`,
  `act`) and only routed after a PERMIT. Enforcement, not just issuance.
- **Live Token Chain panel** — shows the whole chain of custody in real time.
  This is the visual that closes each stage.

## Anchor & generalization

Stages 1–3 anchor in **banking** (concrete, matches the live `/delegation`
page and banking use-cases). The same script generalizes to any vertical: the
`/delegation` page now reads the active vertical's manifest `delegation` block
(`pageTitle`, `pageDescription`, `granteeLabel`, `scopeLabels`), so the grantee
relabels automatically — "family member" in banking, "caregiver" in healthcare,
"colleague or delegate" in workforce. Stage 4 uses this directly.

---

## Stage 1 — Family (human → human)

**Persona:** Maya (customer) delegates to her spouse.
**Handoff:** a human acts for another human.

**Setup:** Banking vertical active. Logged in as Maya.

**Click-path:**
1. Go to `/delegation` (nav: "Family Delegation").
2. In *Grant Account Access*, enter the spouse's email, check **View Accounts**
   + **View Balances**, click *Grant Access*.
3. If a new delegate user is provisioned, the credential card appears — copy it.
4. Open a private window, log in as the spouse, land on the dashboard.
5. Back on Maya's `/delegation`, show the delegate row and the *Live Token
   Chain* panel.
6. Revoke the spouse to show lifecycle.

**Talk track:**
> "Maya wants her spouse to see the accounts — not share a password. She grants
> two scopes. The spouse logs in as themselves; the token they carry proves,
> via the `act` claim, that they're acting on Maya's behalf, limited to exactly
> what she granted. One click revokes it."

**Payoff beat:** Live Token Chain shows the delegated token + `act`. Delegated
access with proof, revocable, no shared credential.

**Mapped surfaces:** `/delegation` page (`DelegationPage.js`); `POST/DELETE
/api/delegation` (`routes/delegation.js`); PingOne user provisioning + Messages
API email.

**Modular exit:** stop here for a "shared access done right" story.

---

## Stage 2 — User → AI agent

**Persona:** Maya authorizes the AI banking agent.
**Handoff:** a human authorizes an autonomous software actor.

**Setup:** Still Maya, banking. Agent dock available.

**Click-path:**
1. On the dashboard, use the **AI Agent Authorization** card to authorize the
   agent (sets the PingOne `may_act` attribute).
2. Ask the agent a read: chip **"show my balance"**
   (use-case `delegated-access-with-proof`, primary tool `get_account_balance`).
3. Show the Token Chain: `user-token → token-exchange → authorize-decision →
   tool-dispatched`; the exchanged token carries `act={agent}`.
4. Ask the agent a write over the HITL threshold (e.g. a ~$300 transfer):
   the `hitl-consent` gate fires (428) — approve the 👤 consent.

**Talk track:**
> "Now Maya hands the same kind of authority to an AI agent. She authorizes it
> once — `may_act`. When the agent calls a banking tool, Ping exchanges Maya's
> token for a delegated agent token that carries `act={agent}`. The agent can't
> exceed the scope Maya granted, and every action is attributable to
> Maya-via-agent. High-value writes still stop for her explicit consent."

**Payoff beat:** agent action is scope-capped and attributable; the HITL gate
proves the human stays in control of money movement.

**Mapped surfaces:** `AgentAuthorizationCard` (`may_act`); use-case
`delegated-access-with-proof` (UC1); `hitl-consent` (UC, 428 gate,
`services/transactionConsentChallenge.js`); token exchange
(`agentMcpTokenService.js`), gateway (`GatewayTokenPolicy.ts`), P1AZ decision.

**Modular exit:** stop here for the core "agent-on-behalf with proof" story.

---

## Stage 3 — Agent → agent (A2A)

**Persona:** the banking agent delegates to a specialist sub-agent.
**Handoff:** a software actor delegates to another software actor.

**Setup:** Maya, banking. Feature flag `ff_a2a_delegation` ON.

**Click-path:**
1. Ask the agent to hand off: chip **"hand off to a specialist"**
   (use-case `a2a-delegation`, primary tool `delegate_to_specialist`).
2. Show the Token Chain: `user-token → a2a-agent1-actor → a2a-exchange1 →
   a2a-agent2-actor → a2a-exchange2 → tool-dispatched` — a **nested** `act`
   chain, scope narrowed at each hop.

**Talk track:**
> "The generalist agent needs a specialist. Instead of handing over Maya's full
> authority, Ping mints a nested-act token: the specialist inherits only what
> the handoff explicitly granted. The full chain — Maya → agent → specialist —
> is visible in the token, and Authorize evaluates every link. No ambient
> authority, even between agents."

**Payoff beat:** the nested `act` chain — least privilege across agent hops,
attributable end-to-end.

**Mapped surfaces:** use-case `a2a-delegation` (UC2, `ff_a2a_delegation`);
`a2aDelegationService.js`, `demoAgentLangGraphService.js`. (UC2.5
`a2a-orchestrator-learning` is the interactive-learning variant.)

**Modular exit:** stop here for the "multi-agent, still governed" story.

---

## Stage 4 — Workforce (manager → employee): grant, then approve

**Personas:** manager (grantor/approver) + employee (actor), WX Workforce.
**Handoff:** an org role delegates standing scope to a subordinate, and gates
elevated actions behind per-action approval.
**Mechanic:** **both** — standing grant *and* per-action CIBA approval.

**Setup:** switch active vertical to **workforce**. The `/delegation` page
relabels automatically via the workforce manifest `delegation` block
(`pageTitle: "Delegate Access"`, `granteeLabel: "colleague or delegate"`,
scope `create_transfer → "Approve high-value expense reports"`).

**Click-path:**
1. As the manager, on `/delegation` grant the employee baseline scope —
   **Submit Requests** (`create_deposit`) — and optionally **Approve Expenses**
   (`create_transfer`, the elevated scope).
2. Log in as the employee (workforce demo user). Chip **"submit an expense"**
   (wf4) — a normal, in-scope request succeeds under the granted authority.
3. Employee submits an **over-threshold** expense (~$600 — the workforce
   step-up/HITL band, chips `sec_hitl` / `sec_mfa_*`). The elevated action
   triggers **per-action approval**.
4. **Ideal:** a CIBA push (`ciba-out-of-band-approval`, `ff_ciba`) goes to the
   **manager's** device; the employee's action proceeds only after the manager
   approves out-of-band.

**Talk track:**
> "Same primitive, now in your workforce. A manager delegates standing scope to
> an employee — least privilege from day one. Routine requests just work. But a
> high-value expense crosses a line, so it stops for out-of-band approval —
> the manager approves on their own device, and that approval is bound to this
> exact transaction and audited. Grant plus approve: least privilege and
> separation of duties, same tokens, same proof."

**Payoff beat:** the token proves the employee acted under manager-granted
scope; the approval receipt proves a *second* human authorized the elevated
action. Least privilege + separation of duties in one flow.

**Mapped surfaces:** `/delegation` with workforce vertical (grant); workforce
chips wf4 / `sec_hitl` / `sec_mfa_*`; use-case `ciba-out-of-band-approval`
(`cibaService.js`, `routes/ciba.js`, `ff_ciba`); `step-up-required` /
`hitl-consent` as interim per-action gates.

**Modular exit:** the enterprise capstone — stop here for the "works for your
workforce too, with human approval" close.

---

## Phase-2 wiring notes (what exists vs. gap)

| Stage | Exists today | Gap to wire |
|---|---|---|
| 1 Family | Live `/delegation` grant/revoke, token chain, email | None — presentable as-is |
| 2 Agent | `may_act` card, UC1 chip, HITL 428, token exchange, P1AZ | None material — confirm HITL threshold value used in script |
| 3 A2A | UC2 chip + `a2aDelegationService`, nested-act token chain | Requires `ff_a2a_delegation` ON; confirm specialist chip label matches |
| 4 Workforce | Workforce delegation block, expense chips, CIBA use-case | **Manager-as-approver (DECIDED: build it).** Today's CIBA is *self*-approval (same user approves on their device). Phase 2 wires a **distinct approver principal** so the **manager** approves the **employee's** elevated action out-of-band. This is the primary Phase-2 code task. |

**Guided-tour hook (Phase 2):** the arc maps cleanly onto `DemoTourContext`
steps + the per-page Talk Track panel; each stage's payoff beat is a tour stop.

## Open questions / assumptions (confirm before Phase 2)

1. **Stage 4 approver identity** — DECIDED: build manager-as-approver (a
   distinct approver principal; the manager approves the employee's elevated
   action out-of-band). This is the primary Phase-2 code task; the HITL/step-up
   surrogate is not the target.
2. **Persona names** — Maya (consumer) and the workforce manager/employee names
   are placeholders; align to the actual banking + workforce demo users.
3. **Exact dollar thresholds** — script uses ~$300 (HITL) and ~$600 (workforce
   step-up) per current config; confirm at wiring time.
4. **Vertical switch mid-demo** — stage 4 assumes an SE can switch the active
   vertical to workforce live; confirm the switch is smooth mid-session.
