# Progressive Trust Demo — Implementation Plan

**Status:** Draft  
**Date:** 2026-07-08  
**Reference:** [Securing ChatGPT apps with OAuth 2.0 and CIBA](https://developer.pingidentity.com/blog/securing-chatgpt-apps/) (Ping Identity, June 2026)  
**Goal:** Reproduce the MyHotels progressive-trust security story using the existing AI-DEMO2 agent stack — **without ChatGPT or the OpenAI Apps SDK**.

---

## Summary

The Ping blog describes **MyHotels**: a personal-agent demo that moves across four trust levels — public access, authenticated access, policy-driven step-up, and out-of-band (CIBA) approval — secured by PingOne OAuth, PingOne Authorize, RFC 8693 token exchange, and CIBA.

This repo already implements that security stack. The work is **curating a narrated banking demo** on top of existing services, not building a new platform or ChatGPT connector.

Our stack is a **stronger teaching path** than the blog because the BFF retains full RFC 8693 delegation and the Token Chain panel stays visible — capabilities ChatGPT apps deliberately forfeit.

---

## Architecture Mapping

| Blog (MyHotels + ChatGPT) | AI-DEMO2 equivalent |
|---|---|
| ChatGPT orchestrator | `langchain_agent` (default) or `openai_agent` / `pydantic_agent` / `mastra_agent` via `configStore.llm_framework` |
| ChatGPT OAuth | User login in `demo_api_ui` → BFF session (PingOne OIDC) |
| Widget UI (`window.openai`) | React UI — chat, chip prompts, Token Chain panel, CIBA panel |
| MCP server (policy + exchange) | `demo_mcp_gateway` → `demo_mcp_server` |
| Backend hotel API | `demo_api_server` banking routes |
| PingOne Authorize per tool | Gateway `PingOneAuthorizeClient.ts` |
| RFC 8693 MCP → API | BFF per-tool exchange + gateway re-exchange upstream |
| CIBA at control point | UC22 — `cibaService.js` + MCP CIBA store; enable `ff_ciba` |

### Runtime topology

```
User
  → demo_api_ui (:4000)
  → demo_api_server (:3001)          [token custodian, RFC 8693 per tool]
  → langchain_agent (:8889 WS)       [or OASDK :8891 / Mastra :8892 / Pydantic :8893]
  → demo_mcp_gateway (:3005)         [Authorize + D-05 + re-exchange]
  → demo_mcp_server (:8080)
  → demo_api_server banking API

PingOne ← BFF, gateway, MCP (auth, Authorize, exchange, CIBA)
```

### What we do not need to build

- ChatGPT Apps SDK / `window.openai` widget bridge
- MCP `ui://widget/...` resources or `openai/outputTemplate`
- PingOne OAuth app for OpenAI connector (Option B2 in `docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md`)
- Public ngrok tunnel for ChatGPT
- Separate hotel backend API (`demo_hotel_api`)
- MCP-initiated CIBA refactor (blog moved CIBA to MCP because ChatGPT cannot; our BFF+MCP path already achieves the same user outcome)

---

## Progressive Trust Journey

Map the blog's four acts to banking use cases already in the repo.

| Act | Blog tool / action | Banking demo | Existing UC / doc | Token Chain |
|---|---|---|---|---|
| 1 — Public | `search_hotels` | Branch/product FAQ (no PII) | **New** thin read-only tool (optional) | Minimal / none |
| 2 — Authenticated | `search_hotels_member_rates` | "Show my account balances" | UC1 — `delegated-access-with-proof.md` | Full chain: subject → actor → narrowed aud → act |
| 3 — In-app step-up | `prepare_booking` (< threshold) | "Transfer $300 to savings" | HITL — `hitl-consent.md` | authorize-decision → HITL |
| 4 — OOB approval | `finalize_booking` + CIBA | "Transfer $600 to savings" | UC22 — `ciba-out-of-band-approval.md` | authorize-decision → ciba-poll → tool-dispatched |
| 5 — Hard deny | Booking > €1000 | "Transfer $2500 to savings" | UC6 — `authz-denied.md` | authorize-decision → DENY |

### Policy threshold mapping

| Blog (MyHotels) | Banking demo (current) | Notes |
|---|---|---|
| ≤ €200 — permit immediately | ≤ $300 — HITL in-app | Different amounts; same pattern (policy-driven step-up) |
| €200–€1000 — CIBA required | $600 — CIBA OOB | Enable `ff_ciba` |
| > €1000 — DENY | $2500 — DENY | Authorize blocks before execution |

Threshold alignment in PingOne Authorize is optional config work (Phase 4). The demo works with existing banking amounts by explaining the domain mapping.

---

## Implementation Phases

### Phase 1 — Documentation and journey definition (~half day)

**Deliverables:**

- [ ] `docs/use-cases/progressive-trust-demo.md` — presenter script, chip text, expected outcomes, Token Chain evidence
- [ ] Cross-links from `docs/use-cases/README.md` (regenerate via `npm run use-cases:docs:gen` if needed)

**No code changes required.**

---

### Phase 2 — One public read-only tool (~1 day)

The blog's Act 1 requires a tool that works without authentication. Most banking tools set `requiresUserAuth: true`.

**Add one intentionally public MCP tool**, for example:

- `get_branch_hours` — returns static branch/ATM catalog
- or `list_public_products` — marketing rate sheet, no account data

**Requirements:**

| Layer | Behavior |
|---|---|
| MCP tool registry | `requiresUserAuth: false`, read-only annotation |
| PingOne Authorize | PERMIT without bearer token (or anonymous subject) |
| Token exchange | Skipped — no backend API token needed |
| Gateway | Allow unauthenticated `tools/call` for this tool only (fail-closed elsewhere) |

**Files likely touched:**

- `demo_mcp_server/src/tools/` — new handler + registry entry
- PingOne Authorize policy — new rule for public tool
- Optional: `demo_api_server/config/useCases.js` — register as UC if promoted to catalog

---

### Phase 3 — Guided demo mode in UI (~1–2 days)

Add a **Progressive Trust Demo** chip strip (or extend existing chip infrastructure) with five preset prompts in order:

1. `What branches are near me?`
2. `Show my account balances`
3. `Transfer $300 to savings`
4. `Transfer $600 to savings`
5. `Transfer $2500 to savings`

**Requirements:**

- Each chip links to the relevant use-case doc for the presenter
- Optional banner: "Progressive Trust Demo — Ping MyHotels pattern on banking agents"
- No agent framework changes required

**Files likely touched:**

- `demo_api_ui/src/` — chip definitions or demo-mode panel
- `demo_api_server/config/useCases.js` — chip metadata if centralized

**Regression guard:** Read REGRESSION_PLAN §0 (emoji rule) and §1 before touching auth/UI surfaces.

---

### Phase 4 — Policy threshold alignment (optional, PingOne config)

**Option A (recommended):** Keep banking amounts ($300 / $600 / $2500) and explain domain mapping in the talk.

**Option B:** Add Authorize rules at blog-equivalent thresholds for conference parity with the Ping post.

This is PingOne policy configuration only — no application code unless policy input attributes need extending (e.g. `TransactionAmount` is already sent by the gateway).

---

### Phase 5 — Multi-agent showcase (optional, ~half day)

Run the same five-act script across agent framework pickers to prove security is agent-agnostic.

| Agent | Port | Config key |
|---|---|---|
| LangChain (default) | `:8889` (WS), `:8881` (health) | `llm_framework=langchain` |
| OpenAI Agents SDK | `:8891` | `llm_framework=openai` |
| Pydantic AI | `:8893` | `llm_framework=pydantic` |
| Mastra | `:8892` | `llm_framework=mastra` |

**Talking point:** Swap the reasoning engine; PingOne Authorize, D-05 anti-bypass, and token exchange do not move.

---

## Demo Script (~12 minutes)

### Setup

1. `./run.sh` (or `./run-docker.sh start`)
2. Log in as demo user in `demo_api_ui` (`:4000`)
3. Enable feature flag: `ff_ciba`
4. Open **Token Chain** and **Activity** panels
5. Confirm LangChain agent selected (or chosen framework from Phase 5)

### Act 1 — Public (no sensitive data)

**Chip:** `What branches are near me?`

**Expected:** Agent returns branch catalog. Token Chain minimal or empty.

**Say:** "Low-friction first — no token exchange for public catalog data."

---

### Act 2 — Authenticated access

**Chip:** `Show my account balances`

**Expected:** Token Chain lights up: `subject_token → actor_token → narrowed aud → act claim`. Authorize PERMIT. Balances returned.

**Say:** "Same progressive pattern as member rates in the Ping blog — authenticate only when value is clear. We also keep full delegation visibility, which third-party agent hosts lose."

---

### Act 3 — In-app HITL

**Chip:** `Transfer $300 to savings`

**Expected:** Authorize returns step-up obligation. Agent pauses. User approves in UI. Transfer completes.

**Say:** "Policy evaluated the amount server-side — not hard-coded in the agent."

---

### Act 4 — CIBA (out-of-band)

**Chip:** `Transfer $600 to savings`

**Expected:** CIBA panel activates. User approves on phone/separate device. Poll succeeds. Token Chain: `authorize-decision → ciba-poll → tool-dispatched`.

**Say:** "Higher risk triggers decoupled approval on a separate device — same pattern as booking approval in the Ping MyHotels demo."

---

### Act 5 — Hard deny

**Chip:** `Transfer $2500 to savings`

**Expected:** Authorize DENY before any transfer executes.

**Say:** "Policy ceiling — blocked before CIBA even starts."

---

### Close

> "Personal agents need progressive trust: public → authenticated → step-up → out-of-band → deny. PingOne provides authentication, Authorize, token exchange, and CIBA. Our BFF keeps delegation legible; the gateway keeps policy enforcement agent-independent."

---

## Priority Matrix

| Priority | Work | Effort | Demo value |
|---|---|---|---|
| **P0** | Presenter doc + five chip prompts (Phase 1) | Hours | Run demo today with existing UCs (Acts 2–5) |
| **P1** | Live demo with existing stack, no new code | Zero | Validates narrative |
| **P2** | One public read-only tool (Phase 2) | ~1 day | Completes Act 1 |
| **P3** | UI chip strip / demo mode (Phase 3) | ~1–2 days | Smoother presenter flow |
| **P4** | Multi-agent rerun (Phase 5) | ~half day | Framework-agnostic proof |
| **P5** | PingOne threshold tuning (Phase 4) | Config | Blog amount parity (optional) |

---

## Code References

| Concern | Location |
|---|---|
| Gateway Authorize + exchange | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`, `demo_mcp_gateway/src/server/GatewayServer.ts` |
| RFC 8693 / token config | `demo_api_server/services/configStore.js` |
| CIBA service | `demo_api_server/services/cibaService.js`, `demo_api_server/routes/ciba.js` |
| MCP CIBA store | `demo_mcp_server/src/storage/BankingSessionManager.ts` |
| Use case catalog | `demo_api_server/config/useCases.js` |
| ChatGPT-as-agent design (contrast) | `docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md` |
| Dev gateway token (B3 stage prop) | `demo_api_server/scripts/mint-gateway-token.js` |

---

## Constraints

- **Worktree required** for all code edits (see CLAUDE.md).
- **REGRESSION_PLAN §1** — pre-read before changing auth flows, token exchange, BFF session layer, or UI surfaces.
- **Minimal diff** — name the component, change only what the phase requires.
- **Emoji rule** — only ⚠️ ✅ ❌ 🔐 ✕ ✓ in code and UI text.
- **No commits** unless explicitly requested.

---

## Related Documents

- [UC1 — Delegated access with proof](../use-cases/delegated-access-with-proof.md)
- [UC6 — Authz denied](../use-cases/authz-denied.md)
- [UC22 — CIBA out-of-band approval](../use-cases/ciba-out-of-band-approval.md)
- [HITL consent](../use-cases/hitl-consent.md)
- [ChatGPT / Claude as the Agent — Design](../superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md)
