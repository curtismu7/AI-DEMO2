# Progressive Trust Demo — Implementation Plan

**Status:** Draft  
**Date:** 2026-07-08  
**Reference:** [Securing ChatGPT apps with OAuth 2.0 and CIBA](https://developer.pingidentity.com/blog/securing-chatgpt-apps/) (Ping Identity, June 2026)  
**Goal:** Reproduce the MyHotels progressive-trust security story using the existing AI-DEMO2 agent stack — **without ChatGPT, Claude.ai connectors, or the OpenAI Apps SDK**.

**LLM providers for this demo:** **Helix** (Ping AI), **llama.cpp** (local via `demo_llm_proxy` `:8090`), or **Google Gemini** — selected from the agent mode picker in the UI. No ChatGPT or external agent-host integration is in scope.

---

## Summary

The Ping blog describes **MyHotels**: a personal-agent demo that moves across four trust levels — public access, authenticated access, policy-driven step-up, and out-of-band (CIBA) approval — secured by PingOne OAuth, PingOne Authorize, RFC 8693 token exchange, and CIBA.

This repo already implements that security stack. The work is **curating a narrated banking demo** on top of existing services, not building a new platform or third-party agent connector.

**Important distinction:** the blog uses ChatGPT as the *orchestrator host*. We use our own BFF + `langchain_agent` tool loop with a swappable **LLM brain** (Helix / llama.cpp / Google). Identity, Authorize, token exchange, and CIBA are unchanged regardless of which LLM routes tool calls.

Our stack is a **stronger teaching path** than the blog because the BFF retains full RFC 8693 delegation and the Token Chain panel stays visible — capabilities third-party agent hosts deliberately forfeit.

---

## Architecture Mapping

| Blog (MyHotels + ChatGPT) | AI-DEMO2 equivalent |
|---|---|
| ChatGPT orchestrator (blog only) | BFF + `langchain_agent` tool loop; LLM brain via agent mode picker (`agentModeResolver.js`) |
| ChatGPT OAuth (blog only) | User login in `demo_api_ui` → BFF session (PingOne OIDC) |
| Widget UI (`window.openai`, blog only) | React UI — chat, chip prompts, Token Chain panel, CIBA panel |
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
  → langchain_agent (:8889 WS)       [tool loop — LLM brain is separate, see below]
  → demo_mcp_gateway (:3005)         [Authorize + D-05 + re-exchange]
  → demo_mcp_server (:8080)
  → demo_api_server banking API

PingOne ← BFF, gateway, MCP (auth, Authorize, exchange, CIBA)
```

### LLM brain (swappable — security boundary does not move)

The **reasoning engine** picks which MCP tool to call. It never holds or mints tokens. Select via the agent mode picker (`demo_api_server/services/agentModeResolver.js`):

| Mode ID | Label | Provider | Demo use |
|---|---|---|---|
| `helix_google` | Helix only | Ping AI / Helix | **Default for talks** — Ping-native LLM routing |
| `llamacpp` | llama.cpp only | Local `:8090` proxy | Offline / no cloud API keys |
| `gemini` | Google Gemini only | Google | Cloud alternative |
| `heuristics` | Heuristics only | None (regex) | Deterministic chip routing, zero LLM latency |

`claude` and `mlx` are also available but not required for this demo.

**Recommended demo path:** `helix_google` for Acts 2–5 (natural language), optionally `heuristics` to show chip-driven routing with zero LLM dependency, then rerun one act under `llamacpp` or `gemini` to prove the LLM swap is cosmetic to the security pipeline.

### What we do not need to build

- ChatGPT Apps SDK / `window.openai` widget bridge
- MCP `ui://widget/...` resources or `openai/outputTemplate`
- PingOne OAuth app for OpenAI connector (Option B2 in `docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md`)
- Public ngrok tunnel for ChatGPT
- Separate hotel backend API (`demo_hotel_api`)
- MCP-initiated CIBA refactor (blog moved CIBA to MCP because ChatGPT cannot; our BFF+MCP path already achieves the same user outcome)

---

## Progressive Trust Journey

| UC ID | useCaseId | Act |
|---|---|---|
| UC23 | `progressive-trust-demo` | Presenter guide (link) |
| UC24 | `progressive-trust-public-access` | Act 1 — public catalog |
| UC25 | `progressive-trust-authenticated-access` | Act 2 — authenticated balances |
| UC26 | `progressive-trust-hitl-consent` | Act 3 — in-app HITL |
| UC27 | `progressive-trust-ciba-approval` | Act 4 — CIBA OOB |
| UC28 | `progressive-trust-policy-deny` | Act 5 — policy DENY |

Launch from **Use Cases → Progressive Trust Demo** in the UI (`/use-cases`).

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

- [x] `docs/use-cases/progressive-trust-*.md` — six catalog entries (UC23–UC28) generated from `useCases.js`
- [ ] Cross-links from `docs/use-cases/README.md` (regenerate via `npm run use-cases:docs:gen` after catalog edits)

**No code changes required.**

---

### Phase 2 — One public read-only tool (~1 day)

**Status:** Done — `get_branch_hours` tool + heuristic `branch_hours` action (no token exchange).

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

### Phase 3 — Guided demo mode in UI — **Done**

Add a **Progressive Trust Demo** chip strip (or extend existing chip infrastructure) with five preset prompts in order:

1. `What branches are near me?`
2. `Show my account balances`
3. `Transfer $300 to savings`
4. `Transfer $600 to savings`
5. `Transfer $2500 to savings`

**Requirements:**

- Each chip links to the relevant use-case doc for the presenter
- Optional banner: "Progressive Trust Demo — Ping MyHotels pattern on banking agents"
- No LLM provider or agent framework changes required

**Files touched:**

- `demo_api_ui/src/pages/UseCaseLauncherPage.js` — `ProgressiveTrustDemoStrip` (Acts 1–5, Run + Explain, flag gate for UC27)
- `demo_api_ui/src/pages/UseCaseLauncherPage.css` — strip layout
- UC24–UC28 hidden from demo track grid (shown only in strip); UC23 presenter card remains

**Regression guard:** Read REGRESSION_PLAN §0 (emoji rule) and §1 before touching auth/UI surfaces.

---

### Phase 4 — Policy threshold alignment (optional, PingOne config)

**Option A (recommended):** Keep banking amounts ($300 / $600 / $2500) and explain domain mapping in the talk.

**Option B:** Add Authorize rules at blog-equivalent thresholds for conference parity with the Ping post.

This is PingOne policy configuration only — no application code unless policy input attributes need extending (e.g. `TransactionAmount` is already sent by the gateway).

---

### Phase 5 — Multi-LLM showcase (optional, ~half day)

Run the same five-act script across LLM providers to prove security is provider-agnostic.

| Agent mode | Provider | Config / env |
|---|---|---|
| `helix_google` | Ping AI / Helix | `HELIX_*` env vars or `/setup` |
| `llamacpp` | llama.cpp local | `demo_llm_proxy` on `:8090`; `./run.sh` |
| `gemini` | Google Gemini | `GOOGLE_API_KEY` or configStore |

**Talking point:** Swap Helix for llama.cpp or Google — PingOne Authorize, D-05 anti-bypass, and token exchange do not move. The LLM is a router; the BFF is the token custodian.

---

## Demo Script (~12 minutes)

### Setup

1. `./run.sh` (or `./run-docker.sh start`)
2. Log in as demo user in `demo_api_ui` (`:4000`)
3. Enable feature flag: `ff_ciba`
4. Open **Token Chain** and **Activity** panels
5. Set agent mode to **Helix only** (`helix_google`) in the agent picker — or `llamacpp` / `gemini` per Phase 5

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
| **P2** | One public read-only tool (Phase 2) | Done | Completes Act 1 |
| **P3** | UI chip strip / demo mode (Phase 3) | Done | Smoother presenter flow |
| **P4** | Multi-LLM rerun — Helix → llama → Google (Phase 5) | ~half day | Provider-agnostic proof |
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
| Agent mode picker (Helix / llama / Google) | `demo_api_server/services/agentModeResolver.js` |
| LLM provider resolution | `demo_api_server/services/llmProviderResolver.js` |
| Local llama.cpp proxy | `demo_llm_proxy/` (`:8090`) |
| ChatGPT-as-agent design (contrast only — not in scope) | `docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent-design.md` |
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
