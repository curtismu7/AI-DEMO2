# Customers AI Footprint — Demo Runbook + Build Plan

Map the Gartner / Ping slide **"Enable customers to inventory their AI footprint"**
(Personal vs Workload boundaries) onto the Super Banking demo.

| Choice | Value |
|--------|-------|
| Audience | SE deep-dive (~30 min) |
| Deliverables | Live talk-track now + build plan to make all six boxes live |
| Source slide | Personal Agents (Coding, End-Point Native, Agentic Customers) · Workload Agents (Platform-Native, Self-Managed Enterprise, SaaS-Embedded) |
| Locked costume defaults | Coding: **Claude Code** · Platform-Native: **Light workbench** · End-Point: **Desktop light** · SaaS: **Vendor embed** |
| SE entry | Side nav **AI Footprint** → `/demo/footprint-picks`; gallery → `/demo/footprint-mocks` |

Companion docs:

- [AGENT_SHOWCASE_DEMO_SCENARIOS.md](user-guide/AGENT_SHOWCASE_DEMO_SCENARIOS.md) — click-level banking scripts
- [AGENT_SHOWCASE_NARRATIVE.md](AGENT_SHOWCASE_NARRATIVE.md) — why / storytelling
- [COPILOT_PART3_RUNBOOK.md](COPILOT_PART3_RUNBOOK.md) — Copilot → backend wiring
- [demo_api_ui/COPILOT_SETUP.md](../demo_api_ui/COPILOT_SETUP.md) — Entra / Copilot Studio Part 2
- [CHATGPT_INTEGRATION_PLAN.md](CHATGPT_INTEGRATION_PLAN.md) — End-Point Native target design

---

## Part A — 30-minute SE runbook (use today)

### Timing

| Block | Minutes | Slide box | Mode |
|-------|---------|-----------|------|
| Open + frame | 2 | All six | Slide |
| Self-Managed Enterprise | 6 | Workload #5 | **Live** |
| Agentic Customers | 6 | Personal #3 | **Live** |
| Platform-Native | 4 | Workload #4 | **Live** — `/demo/vscode-copilot` shell |
| Coding | 3 | Personal #1 | Live-adjacent (Code Explorer) or talk-track |
| End-Point Native | 3 | Personal #2 | **Live** — `/demo/chatgpt-desktop` shell |
| SaaS-Embedded | 3 | Workload #6 | Talk-track / stub until built |
| Close | 3 | Inventory → Ping | Slide |

**Costume shells:** Copilot / ChatGPT / SaaS / Coding beats use **simulated UI chrome**
over the **same Ping banking agent**. Pick visuals at `/demo/footprint-mocks`, then open
the live route. Badge: `Simulated shell · Ping demo agent`. Real Entra `/copilot` stays
dark/unused for this beat.

### Thesis (say once)

> Customers cannot secure what they cannot name. Personal agents and workload agents
> hit the same banking APIs under different trust boundaries. Ping inventories and
> controls that footprint — OAuth, token exchange, HITL, MFA — regardless of where
> the agent runs.

### Preflight (day of)

1. `./run.sh` from repo root.
2. Open `https://local.ping-devops.com:4000` (passkeys / session host — not `api.ping.demo:4000` alone).
3. Customer login with demo user (`DEMO_USER_*` in `demo_api_server/.env`).
4. Dashboard: agent panel + **Token Chain** open.
5. Second tab: Admin → Controls — transfer threshold / MFA flags set for the HITL beat.
6. Confirm at least one alternate agent runtime boots (LangChain default + one of OpenAI / Mastra / Pydantic) if you plan the framework swap.
7. Footprint shells: open `/demo/vscode-copilot` and `/demo/chatgpt-desktop` once while signed in — agent should portal into the chat panel; badge visible.
8. Have the Gartner/Ping footprint slide ready (Personal vs Workload).
9. Leave real `/copilot` (Entra + Copilot Studio) off for this talk track unless separately rehearsed.

### Script by beat

#### 0. Open (2 min)

- Show the six-box slide.
- Point at Personal vs Workload icons: individuals vs enterprise-owned.
- Promise: two live paths first (self-managed + agentic customer), then the rest of the inventory.

#### 1. Self-Managed Enterprise — Workload (6 min) — LIVE

**Slide meaning:** Agents running in environments you operate (LangChain, custom).

**Do:**

1. Dashboard agent: *"Show me my accounts"* (or Banking → My Accounts chip).
2. Token Chain: user OAuth → MCP tool `get_my_accounts` — read path, no exchange required.
3. Optional: switch agent framework; repeat a read. Say: *framework swaps; Ping authorization does not.*
4. Optional one-liner: MCP Audit / compliance steps 1–4.

**Say:**

> This is a workload agent you own — runtime in your VPC or demo stack, tools through
> an MCP gateway, tokens never in the browser.

**Watch for:** Token Chain events, MCP success. No consent modal on read.

#### 2. Agentic Customers — Personal (6 min) — LIVE

**Slide meaning:** Agents acting on behalf of customers/partners in digital channels.

**Do:**

1. Same UI, new story: *this is the customer's channel agent, not an ops bot.*
2. *"Transfer $500 from checking to savings"* (or Transfer chip).
3. HITL consent modal → approve.
4. MFA / step-up if threshold requires it.
5. Token Chain: exchange / delegated token / `act` chain if visible.

**Say:**

> Personal-side agentic customer: on-behalf-of the human, with human-in-the-loop and
> step-up. That is the CIAM-for-AI-agents story.

**Watch for:** Consent + MFA; transfer success; Token Chain shows narrowed / exchanged token.

#### 3. Platform-Native — Workload (4 min) — LIVE (costume shell)

**Slide meaning:** Agents in cloud platforms (Microsoft Copilot).

**Do:**

1. Open `https://local.ping-devops.com:4000/demo/vscode-copilot` (signed in).
2. Point at badge: **Simulated shell · Ping demo agent**.
3. In Copilot Chat panel: *"Show me my accounts"* — same agent as dashboard.
4. Optional: transfer to show HITL/MFA still fire inside the costume.

**Say:**

> The chrome looks like VS Code + Copilot. The brain and the controls are ours —
> Ping session, MCP gateway, Authorize, HITL. Platform-native footprint without
> needing Entra wiring for the SE talk.

**Watch for:** Agent portaled into the right chat column; Token Chain still updates.

#### 4. Coding — Personal (3 min)

**Slide meaning:** Code assistants in dev environments (Claude Code, etc.).

**Preferred live-adjacent:**

1. Open **Code Explorer** (RAG / codebase tools).
2. Run a search that hits `code_search` / `get_code` style tooling.
3. Bridge: *developer agents that touch your repos are still agents — inventory them under Personal/Coding; same identity patterns when they call APIs.*

**Note:** The VS Code shell above can also double as a Coding visual if time is short — call out that Coding vs Platform-Native differs by *who owns the agent*, not the IDE chrome.

**Fallback talk-track:** Claude Code / Cursor MCP client + OAuth to Agent Gateway — same control plane as banking MCP, different audience.

**Say:**

> Coding agents are personal footprint. They are not the banking chatbot — but they
> are part of the inventory customers forget.

#### 5. End-Point Native — Personal (3 min) — LIVE (costume shell)

**Slide meaning:** Consumer / device-native AI (ChatGPT, Gemini, OpenClaw).

**Do:**

1. Open `/demo/chatgpt-desktop`.
2. Point at badge: **Simulated shell · Ping demo agent**.
3. Ask for accounts (or a light transfer) in the ChatGPT-shaped window.
4. Say: OTP/HITL stay on Ping — not typed as a long-lived secret into a consumer app.

**Say:**

> Endpoint-native means the agent lives on the user's device or consumer app. Your
> IdP and API still own authorization and step-up. This shell proves the controls
> without a live Custom GPT Actions deployment.

#### 6. SaaS-Embedded — Workload (3 min) — TALK-TRACK until built

**Slide meaning:** Agents inside vendor SaaS (Zendesk, Glean).

**Do:**

1. Point at Zendesk / Glean logos on the slide.
2. Diagram: SaaS agent → Ping-registered OAuth client → same BFF/MCP scopes → HITL when money moves.
3. Label: *you do not own the runtime; you own registration, scopes, and step-up. Stub in Part B P2.*

**Say:**

> Embedded SaaS agents look like product features. Treat them as workload identities
> with a distinct `client_id` in the token chain.

#### 7. Close (3 min)

1. Re-show the six boxes; tick live shells for #4 and #2; #6 still gap unless stub built.
2. Map boxes → Ping: Agent IAM / Agent Gateway / Authorize / Protect / DaVinci MFA / CIAM.
3. Leave-behind: this doc + showcase scenarios.

### Demo-day fallback matrix

| Box | Primary | Fallback |
|-----|---------|----------|
| #5 Self-Managed | Live LangChain agent | Chip-only scripts from showcase scenarios |
| #3 Agentic Customers | Live transfer + HITL + MFA | Read-only accounts if write path broken; narrate consent |
| #4 Platform-Native | `/demo/vscode-copilot` shell | Dashboard agent + “platform chrome” talk-track |
| #1 Coding | Code Explorer | VS Code shell as visual only |
| #2 End-Point Native | `/demo/chatgpt-desktop` shell | ChatGPT plan §3 sequence diagram |
| #6 SaaS-Embedded | Stub panel (when built) | Logo + client_id talk-track |

### Success criteria (runbook)

- [ ] All six boxes named aloud at least once
- [ ] #5 and #3 completed live with Token Chain visible
- [ ] #4 and #2 completed live via costume shells (badge visible)
- [ ] Real `/copilot` Entra path not required for this talk
- [ ] Closing line ties inventory → Ping controls

---

## Part B — Build plan (make all six live)

Goal: each slide box has a **rehearsable live beat** on the same banking backend.

### Decisions (locked)

| # | Choice |
|---|--------|
| Copilot look | VS Code + Copilot Chat sidebar |
| ChatGPT look | Desktop ChatGPT app chrome |
| Backend | Same banking agent + Ping session as Dashboard (`surfaceHostEl` portal) |
| Honesty | Badge: `Simulated shell · Ping demo agent` |
| Real `/copilot` | Leave dark; not part of this SE beat |

### Priority order

| Priority | Box | Status |
|----------|-----|--------|
| **Done** | #5 Self-Managed | Live dashboard agent |
| **Done** | #3 Agentic Customers | Live (same agent, different narrative) |
| **Done** | #4 Platform-Native | `/demo/vscode-copilot` costume shell |
| **Done** | #2 End-Point Native | `/demo/chatgpt-desktop` costume shell |
| **P2** | #6 SaaS-Embedded stub | Distinct client_id + thin panel |
| **P3** | #1 Coding live beat | Optional IDE MCP config against Code Explorer |

### Costume shell implementation notes

| Piece | Location |
|-------|----------|
| VS Code shell | `demo_api_ui/src/pages/VsCodeCopilotShellPage.jsx` |
| ChatGPT shell | `demo_api_ui/src/pages/ChatGptDesktopShellPage.jsx` |
| Host hook | `demo_api_ui/src/hooks/useAgentSurfaceHost.js` |
| Route gate | `isAiFootprintShellRoute` in `embeddedAgentFabVisibility.js` |
| App wiring | `shouldMountSingleAgent` + inline chrome; dock suppressed |

Real Copilot Studio / ChatGPT Actions paths ([COPILOT_PART3_RUNBOOK.md](COPILOT_PART3_RUNBOOK.md), [CHATGPT_INTEGRATION_PLAN.md](CHATGPT_INTEGRATION_PLAN.md)) remain optional later work — **not** required for the 30‑min footprint talk.

### P2 — SaaS-Embedded stub (remaining)

**Done looks like:** In-app panel labeled as vendor-embedded agent; distinct OAuth `client_id`; same MCP tools; Token Chain label makes workload inventory obvious.

| Task | Owner surface | Notes |
|------|---------------|-------|
| P2.1 SaaS demo client in PingOne | PingOne | Separate app from banking UI |
| P2.2 Thin UI panel | `demo_api_ui` | Not a full Zendesk clone |
| P2.3 Token Chain tag | BFF / chain events | e.g. `agent_placement=saas_embedded` |
| P2.4 Optional HITL on write | Existing HITL | Same consent path |

### P3 — Coding live beat (optional polish)

**Done looks like:** Claude Code / Cursor MCP against Code Explorer tools with checked-in config.

### Cross-cutting

- Same banking policy source for all shells (scopes, HITL, MFA).
- Costume shells must keep the honesty badge.
- Tests: unit for route helper + shell smoke render; UI `npm run build` gate.

### Suggested milestone slices

| Milestone | Outcome |
|-----------|---------|
| M0 | #5+#3 live; #4+#2 talk-track |
| **M1 (this branch)** | #4+#2 costume shells live |
| M2 | P2 SaaS stub |
| M3 | P3 Coding MCP |

### Build success criteria

- [x] #4 VS Code Copilot shell portals real agent
- [x] #2 ChatGPT desktop shell portals real agent
- [x] Simulated badge on both
- [x] Real `/copilot` unchanged / unused for this beat
- [ ] #6 SaaS stub
- [ ] Token Chain placement labels (optional polish)

---

## Quick reference — box → repo today

| # | Box | Today | Route / notes |
|---|-----|-------|---------------|
| 1 | Coding | Code Explorer adjacent | Optional P3 MCP |
| 2 | End-Point Native | **Costume shell** | `/demo/chatgpt-desktop` |
| 3 | Agentic Customers | Live banking agent | Dashboard narrative |
| 4 | Platform-Native | **Costume shell** | `/demo/vscode-copilot` |
| 5 | Self-Managed | Live multi-framework | Dashboard |
| 6 | SaaS-Embedded | None | P2 stub |

Real Entra `/copilot` and Custom GPT Actions docs remain for optional later work — not required for the 30‑min footprint talk.
