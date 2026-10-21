# Standalone Demo Stories

Date: 2026-10-20 · Status: draft for review · Companion to [standalone-demo-family-plan.md](standalone-demo-family-plan.md)
(catalog IDs like D15 refer to that file)

## Why stories

An SE presenting live is not explaining a protocol; they are telling a customer what happened to a person.
Every demo opens with a story, the flow is the evidence, and the talk-track panel (Phase 0.5) is the story's script.

## Story rules

1. **One person, one goal, one obstacle.** A story that needs two obstacles is two stories.
2. **Under 3 minutes** from first click to proof.
3. **Name the control.** Every story ends with the sentence "that happened because ___ (the Ping product/policy)".
4. **End on proof**, not on a screen: a decoded token, a decision record, an audit line, a blocked response with its reason.
5. **Every story has a happy path and a blocked path** behind one toggle, so the SE can show "allowed" and "stopped" on the same data.
6. **Recurring cast** across all demos, so a customer who sees two demos recognizes the people.
7. **Stories are data** (`stories/<id>.json`): persona, steps, talk-track lines, expected result, mock responses. The talk-track panel,
   Simulate, mock mode and the Learn pack all read the same file. Change the story once; nothing else drifts.
8. **Re-skinnable**: names, company and vertical come from `customer.config`; the plot stays.

## Story card format

```
id, title, vertical(s)
Cast:     who is involved
Goal:     what the person wants
Obstacle: what stands in the way (the single reason Ping is in the story)
Control:  the Ping product / policy that handles it
Happy path / Blocked path
Proof:    the artifact shown at the end
Say:      the one-line takeaway for the customer
Mock:     what mock mode returns if the tenant fails live
Demo(s):  catalog IDs that run it
```

## Recurring cast

| Name | Role | Used for |
|---|---|---|
| **Mark** | Customer / traveler / account holder | Buys, books, signs in; the person agents act for |
| **Mary** | Employee / analyst using agents and MCP tools | Tool access, partial blocks, connectors |
| **Priya** | Manager / approver | Human-in-the-loop approvals, on a phone |
| **Dana** | Security / identity admin | Policies, agent onboarding, kill switch, revoke |
| **Ravi** | Developer | Debugging tokens, building agents, shadow agents |
| **Ellis** | Auditor / compliance | "Who did that, through which agent, under what policy" |
| **Lena** | Partner employee at Acme | Cross-company access (ID-JAG) |
| **Dot** | Mark's personal agent | Acts on Mark's behalf with limits |
| **Atlas** | Worker/digital worker agent | Unattended, scheduled work |
| **Rogue** | Hostile MCP server / agent / content | The attacker the controls stop |

Names are placeholders; `customer.config` can swap them.

## Stories

### 1. Human approval

| | |
|---|---|
| **S01 Mark's ticket needs a second pair of eyes** | **Goal:** Mark books a $2,400 business-class fare. **Obstacle:** over his $1,000 self-service limit. **Control:** Authorize policy holds the call; CIBA push to Priya's phone. **Happy:** Priya approves, booking completes. **Blocked:** Priya denies, Mark sees a plain-language reason. **Proof:** decision record with approver, binding message, timestamps. **Say:** "The agent didn't get smarter permissions; a human stayed in the loop for exactly the risky one." **Demos:** D15, A4, B1 |
| **S02 The 3 a.m. approval** | **Goal:** Atlas needs to release a held payment overnight. **Obstacle:** no human online. **Control:** hold with expiry; escalation to a second approver, then auto-deny. **Proof:** expired-and-denied record. **Say:** "Silence is a no, not a yes." **Demos:** D15, D23 |
| **S03 Priya can't be talked into it** | **Goal:** an agent writes a persuasive justification to bypass approval. **Obstacle:** free-text justification. **Control:** typed free-text gate; policy ignores prose. **Proof:** the request and the unchanged hold. **Say:** "Persuasion is not authorization." **Demos:** D15, D8 |

### 2. Partial access to tools

| | |
|---|---|
| **S04 Mary gets 2 of 3 tools** | **Goal:** Mary asks an agent to use Search, Ticketing and Payments MCP tools. **Obstacle:** her role allows Search and Ticketing, not Payments. **Control:** Privilege gateway per-tool policy. **Happy:** all three (finance role). **Blocked:** Payments is denied with a named reason while the other two keep working. **Proof:** the tool list she sees vs the tool list the server offers; deny record. **Say:** "The agent only sees what Mary is allowed to use, so it can't be tricked into asking for more." **Demos:** D1, B7 |
| **S05 The tool list changed overnight** | **Goal:** Mary uses a tool she approved last week. **Obstacle:** the server swapped the tool's description and schema (rug pull). **Control:** schema pinning and diff; the 3 dangerous tools denied. **Proof:** side-by-side before/after, ungoverned vs governed. **Say:** "Approval is for a specific tool, not a name." **Demos:** D6, D1 |
| **S06 Mary connects ChatGPT to the company tools** | **Goal:** Mary adds the company MCP server as a ChatGPT connector. **Obstacle:** the client needs OAuth metadata and a login that works from a hosted app. **Control:** protected-resource metadata, DCR/CIMD, pi.flow sign-in. **Proof:** the connector signed in; her token scoped to her tools. **Say:** "Same identity, same policy, whichever AI client she picks." **Demos:** D25, D2 |
| **S07 The model Mary is not allowed to use** | **Goal:** Mary pastes customer data into an agent. **Obstacle:** the agent would route to an unapproved model provider. **Control:** LLM gateway lane policy. **Proof:** the routing decision and the blocked lane. **Say:** "Data goes only where policy says." **Demos:** D19 |

### 3. Acting on someone's behalf

| | |
|---|---|
| **S08 Dot books for Mark, but only as Mark** | **Goal:** Mark's personal agent books a flight. **Obstacle:** the agent must not exceed what Mark can do, and must be traceable. **Control:** token exchange with `act`; consent. **Proof:** decoded token showing `sub` = Mark, `act` = Dot. **Say:** "The agent carries Mark's rights, never more, and signs its own name." **Demos:** C6, D21 |
| **S09 Mark sets a spending limit for Dot** | **Goal:** Mark lets Dot buy up to $500. **Obstacle:** consent should be narrow and revocable. **Control:** act-only consent grant. **Happy:** $480 passes. **Blocked:** $650 is refused with the limit named. **Proof:** consent record and the refused call. **Demos:** B9, D21 |
| **S10 Mary's agent calls another agent** | **Goal:** Mary's agent asks a specialist agent for a report. **Obstacle:** the middle agent must not widen access. **Control:** A2A delegation chain; scopes only narrow. **Proof:** chain of `act` claims across hops; a denied hop. **Demos:** D9, C6 |
| **S11 Lena from Acme reads a shared dataset** | **Goal:** a partner employee needs access without a second account. **Obstacle:** two companies, two IdPs. **Control:** ID-JAG: Acme's IdP issues the grant, our authorization server redeems it. **Proof:** the five checks against the draft, and the refused self-redeem (an IdP can't redeem its own ID-JAG). **Say:** "No shared passwords, no duplicate accounts, and we still decide." **Demos:** C1 |

### 4. Stopping things

| | |
|---|---|
| **S12 Atlas loops** | **Goal:** a worker agent retries a failing call. **Obstacle:** runaway cost and rate. **Control:** rate and cost caps; Dana's kill switch. **Proof:** the cap hit, the revoke, the next call refused. **Say:** "A runaway agent is a bounded problem." **Demos:** D14 |
| **S13 Mark leaves the company, in the middle of a task** | **Goal:** HR disables Mark's account. **Obstacle:** his agent still holds a refresh token. **Control:** revocation (RFC 7009), next ID-JAG/exchange refused. **Proof:** the refusal after revoke. **Demos:** C12, D23 |
| **S14 Rogue content tells the agent to refund everyone** | **Goal:** an agent reads a review that contains hidden instructions. **Obstacle:** prompt injection. **Control:** AI Guard on the input plus a policy on the tool call. **Proof:** the injected text, the guard verdict, the unmade call. **Demos:** D8, D12 |
| **S15 Ravi's agent, with a key in a .env file** | **Goal:** a developer runs an ungoverned agent. **Obstacle:** shadow agent. **Control:** discovery plus Agent Registry onboarding. **Proof:** discovered list; the same agent after onboarding. **Demos:** D16, D11 |

### 5. Signing in and proving who you are

| | |
|---|---|
| **S16 Mark signs up and adds a passkey** | **Goal:** a new customer registers. **Obstacle:** friction and phishing risk. **Control:** pi.flow registration, passkey. **Proof:** sign-in with no password. **Demos:** A12, A2, A3 |
| **S17 Mark signs in from a new country** | **Goal:** Mark logs in while traveling. **Obstacle:** risk signal. **Control:** Protect score, step-up. **Happy:** step-up with OTP, in. **Blocked:** a bot pattern is stopped. **Proof:** the risk evaluation. **Demos:** A6, A7 |
| **S18 Mary lost her phone** | **Goal:** Mary can't pass MFA. **Obstacle:** her only device is gone. **Control:** MFA policy and recovery. **Proof:** the policy decision at each method. **Demos:** A1 (MFA tester) |
| **S19 Why is this a 401?** | **Goal:** Ravi's client fails against an API. **Obstacle:** unclear token problem. **Control:** token inspector against the draft and the trusted-IdP registry. **Proof:** the failing check named. **Demos:** C3, C5 |
| **S20 Sign out means signed out** | **Goal:** Mark ends a session. **Obstacle:** the app and the IdP disagree. **Control:** front/back-channel logout, `id_token_hint`. **Proof:** both sessions gone. **Demos:** A22 |

### 6. Proof and audit

| | |
|---|---|
| **S21 Ellis asks who approved the $2,400** | **Goal:** an auditor reconstructs a transaction. **Obstacle:** many systems. **Control:** audit trail joined by subject, agent and decision. **Proof:** one timeline: Mark, Dot, policy, Priya, outcome. **Say:** "One question, one answer." **Demos:** D17 |
| **S22 Why was Mark denied?** | **Goal:** a customer is blocked. **Obstacle:** opaque denial. **Control:** decision explainer, caught-errors view. **Proof:** the deciding rule in plain language. **Demos:** D13, B1, B2 |
| **S23 Cedar says no, even though another rule says yes** | **Goal:** same request evaluated by Cedar and PingOne Authorize. **Obstacle:** conflicting rules. **Control:** Cedar forbid overrides permit; compare with Authorize. **Proof:** both engines' decision and deciding policy. **Demos:** B3, B5 |

### 7. Vertical variants (same plot, different skin)

Decided 2026-10-20: a vertical is a **pack** (see the plan, E5), not a separate story. The stories below are the plots to write once with tokens; the pack supplies names and nouns. S11 already ships this way in the ID-JAG kit.

| | |
|---|---|
| **S24 Airline:** Mark books, Dot rebooks on cancellation, Priya is the supervisor (United engagement). | S01, S08, S09 |
| **S25 Banking:** Mark wires $40,000; step-up, then HITL above the daily limit. | S01, S17 |
| **S26 Healthcare:** Dr. Okafor's agent reads a chart; blocked outside the care team; break-glass requires approval. | S04, S01 |
| **S27 Retail:** a promo agent applies a discount; capped by policy; an injected review tries to raise it. | S12, S14 |

### 7b. Group policy

| | |
|---|---|
| **S33 Mark loses a group mid-session** | **Goal:** Mark asks for a premium upgrade. **Obstacle:** an admin removed Mark from the Premium group a minute ago, but Mark's token still lists it. **Control:** group membership evaluated by PingOne Authorize, plus a fresh token. **Happy:** a new token reflects the change and the request is denied with the group named. **Blocked variant:** the stale token still permits, and the page says why. **Proof:** the decision with its statement code and the `groups` claim before and after. **Say:** "Policy is only as current as the token it reads." **Demos:** B7 |
| **S34 One rule, three industries** | **Goal:** the same group rule applied in banking, healthcare and an airline. **Obstacle:** each industry names groups and resources differently. **Control:** a rule per vertical pack. **Proof:** three decisions side by side, each with its own deciding rule. **Demos:** B7, verticals |
| **S35 Dana maps groups to tools** | **Goal:** Dana decides which groups may use which MCP tools. **Obstacle:** three tools, four groups, and one must wait for approval. **Control:** allow / hold / deny mapping. **Proof:** the mapping table and one decision per cell (this is S04 from the admin's side). **Demos:** B7, D1 |

### 8. Following one transaction (telemetry and workload identity)

| | |
|---|---|
| **S28 Follow Mark's $2,400 from click to ledger** | **Goal:** Ellis wants every step of one booking. **Obstacle:** the request crosses sign-in, Dot, the gateway, Authorize, an approval, the MCP tool and the audit log, each owned by a different product. **Control:** one `traceparent` and the shared trace envelope. **Proof:** a timeline with, at every hop, the subject and actor, the decision and deciding rule, the latency and the LLM cost. **Say:** "One ID, every product, one answer." **Demos:** F1, D17, S01 as the transaction |
| **S29 Where did the time and the money go?** | **Goal:** Dana sees the booking took 9 s and cost 14¢. **Obstacle:** don't know which hop. **Control:** per-hop latency and cost. **Proof:** the slow hop (the human approval) separated from the slow tool. **Demos:** F6, F1 |
| **S30 The trace that breaks at hop 4** | **Goal:** Ravi's trace stops partway. **Obstacle:** a service drops the correlation ID. **Control:** propagation tester. **Proof:** the hop where `traceparent` was lost, then fixed. **Demos:** F5 |
| **S31 Dot has no password** | **Goal:** Dot calls the booking MCP server. **Obstacle:** a static secret in an agent is a liability. **Control:** SPIFFE SVID presented by Dot, rotated automatically, then exchanged for a Ping token that carries Mark's `sub` and Dot's `act`. **Happy:** SVID valid, token issued. **Blocked:** expired or unknown SPIFFE ID is refused before any token exists. **Proof:** the SPIFFE ID in the trace beside the user token. **Say:** "The agent proves what it is; Mark's token proves who it acts for." **Demos:** F8, F9, C6 |
| **S32 Rotate it live** | **Goal:** show that identity rotation doesn't break a running agent. **Obstacle:** long-lived credentials. **Control:** short-lived SVIDs. **Proof:** two SVID serials in the trace, no outage. **Demos:** F10 |

## Stories per demo (starting set)

Every demo should ship at least these; the rest come as time allows.

| Demo | Stories |
|---|---|
| ID-JAG (C1) | S11 (plus the negative tests as the blocked path) |
| MFA tester (A1) | S18, S16 |
| Privilege (D1) | S04, S05 |
| MCP auth lab (D2/D25) | S06 |
| OBO (C6) | S08, S09 |
| A2A (D9) | S10 |
| HITL (D15) | S01, S02, S03 |
| Kill switch (D14) | S12, S13 |
| Prompt injection / AI Guard (D8/D12) | S14 |
| Agent Registry / shadow agents (D11/D16) | S15 |
| Authorize / Cedar (B1/B3) | S22, S23 |
| Protect (A6) | S17 |
| Audit (D17) | S21 |
| Token inspector (C3) | S19 |
| Digital worker (D23) | S02, S13 |
| LLM gateway (D19) | S07 |
| Transaction trace (F1) | S28, S29 |
| Propagation tester (F5) | S30 |
| SPIFFE (F8/F9/F10) | S31, S32 |

## Phase 0 impact

- **0.5 Talk-track panel** becomes **0.5 Story engine**: a `stories/<id>.json` schema, a panel that plays it, a happy/blocked toggle, and Mock responses read from the same file.
- ID-JAG ships S11 first (the five checks, the self-redeem refusal, the revoke step), proving the schema before it moves into `demo-kit-base`.
- Add to the base requirements: every demo ships ≥1 story with both paths and a proof artifact.

## Open questions

1. Is the recurring cast right, or do you want real-world persona names the customer will recognize (per engagement)?
2. Should stories exist as printable one-page SE cards (PDF) as well as in-app?
3. Airline (United) as the default vertical, or banking?
4. Do you want a story-writing skill so new demos get consistent stories?
