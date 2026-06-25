# Five-Mode Agent Provider Model — Design

**Date:** 2026-05-18
**Status:** Awaiting approval
**Supersedes/extends:** `2026-05-18-chatgpt-claude-as-agent-design.md` (research + slices A/B3)
**Author:** Curtis Muir (with Claude Code)

---

## 1. Goal

Replace the implicit "heuristic-floor + fallback-provider" model with **five
explicit, user-selectable agent modes**, two of which (ChatGPT, Claude) are
deliberately educational about what is lost when an outside agent is used.

## 2. The Five Modes

| # | Mode | Routing brain | Heuristic floor | LLM |
|---|------|---------------|-----------------|-----|
| 1 | **Heuristics** | Deterministic parser only | ON (is the whole brain) | none |
| 2 | **Helix (Google)** | Helix wrapper, configured to a Google/Gemini model | OFF for routing | Helix→Gemini |
| 3 | **Heuristics + Helix** | Heuristic first, Helix on no-match | ON | Helix |
| 4 | **Just ChatGPT** | OpenAI | OFF for routing | OpenAI |
| 5 | **Just Claude** | Anthropic | OFF for routing | Anthropic |

Mode 3 is today's default behaviour. Mode 1 is the deterministic-only
configuration. Modes 2/4/5 turn the heuristic *routing* fast-path off.

### Helix is model-agnostic

Helix is a wrapper that can front `gpt-4o`, `gemini-1.5-pro`, or
`claude-3-5-sonnet` depending on the configured Helix agent. "Helix (Google)"
= Helix wrapper pointed at a Gemini model. The stale UI label
"Helix (Claude via wrapper)" is corrected to reflect the configured model.

## 3. Architecture Change — ARCHITECTURE-TRUTHS T-3 Amendment

**Current T-3:** the heuristic ALWAYS runs first as a deterministic floor; the
LLM is consulted only on no-match, even in "LLM only" mode.

**Amended T-3:** the heuristic's **routing** fast-path is mode-dependent
(ON for modes 1 & 3, OFF for 2/4/5). **CRITICAL INVARIANT PRESERVED:** the
heuristic floor was conflated two jobs — (a) convenience routing and
(b) the deterministic safety net that the demo *appeared* to rely on for
transfer/HITL. Job (b) does **not** actually live in the heuristic as the
authority — server-side enforcement does (see §4). T-3 is amended only for
job (a). This amendment is recorded in ARCHITECTURE-TRUTHS and
REGRESSION_PLAN §1/§4.

## 4. Safety Is Not in the Heuristic (the load-bearing decision)

Modes 2/4/5 disable the heuristic *routing* fast-path. Transfer-consent /
HITL / step-up safety is **NOT** weakened, because that enforcement is
server-side and independent of routing mode:

- BFF / MCP **Authorize gate** (`mcpToolAuthorizationService`,
  `transactionConsentChallenge`, 428, step-up — REGRESSION_PLAN §1,
  Phase 170) runs on the tool call regardless of which mode selected it.
- The MCP **Gateway** (when in path) still does RFC 8693 + D-05 + PingAuthorize
  `/decision` per tool call.

**Therefore: LLM-only modes lose routing CONVENIENCE, not SAFETY.** The demo
stays honest — it does not perform unconsented transfers — and the
educational claim is precise: *"the agent changed; the policy gate did not."*

## 5. Modes 4 & 5 — Dual Wiring (the core teaching surface)

Each external mode runs in one of two sub-shapes, toggleable so a talk can
flip between them and visibly show the Token Chain panel light up vs go dark:

### 4a/5a — "via BFF" (token chain INTACT) — spec Slice A

ChatGPT/Claude are only the **LLM brain** via direct API. The BFF still does
RFC 8693 → MCP Gateway → Authorize. Already built at the resolver level
(`openai`/`anthropic` pass-through, commit `7bf1595f`).
**Teaching point:** *even with a frontier model, WE keep token custody,
per-tool exchange, the `act` delegation claim, and the full Token Chain.*

### 4b/5b — "platform-driven" (token chain LOST) — spec Slice B

The platform (OpenAI Responses API / Claude `mcp_connector`) drives the tool
loop; we hand it one broad gateway-audience token.
**What is lost (the curriculum):**

- **Per-tool RFC 8693 exchange** — gone; one broad token, not narrowed per tool
- **`act` delegation claim** — gone; the platform is the caller, not the BFF
- **Token Chain UI panel** — goes dark before the gateway (nothing to show)
- **Single-resource audience discipline (T-10)** — not expressible

### What is NOT lost even in 4b/5b (verified true — the honest half)

The **MCP Gateway still enforces**, because enforcement is bound to the
inbound request, not the caller:

- inbound `aud` check (`tokenValidator.ts`)
- **D-05 anti-bypass** (`GatewayTokenPolicy.ts`)
- **PingAuthorize `/decision` per `tools/call`** (`PingOneAuthorizeClient.ts`)
- RFC 8693 re-exchange to the backend (`credentialSwap.ts`)

So the gateway claim in the user's question — *"MCP Gateway (if it's true)"* —
**is true:** the gateway and its Authorize engine survive the agent swap.
What you lose is everything *upstream* of the gateway.

## 6. UX

A single explicit **mode selector** (the 5 modes) on the three surfaces
already wired for provider selection: `/config`, BankingAgent header, and
(deferred, §1-protected) UserDashboard toolbar — via the existing shared
`useLangchainProvider` SSOT hook, extended to a 5-mode model.

- Modes whose credentials are absent are **disabled** (honest `key_set` —
  already implemented for openai/anthropic/helix).
- Modes 4 & 5 expose a secondary **"via BFF (safe) ▸ / platform-driven
  (lossy) ▸"** toggle.
- Selecting 4b/5b renders an explicit **degraded-mode banner** in the Token
  Chain area: *"Delegation lost here — a third party holds a broad token.
  Gateway policy still enforced."*

## 7. Mapping to Existing Resolver

`llmProviderResolver.js` already returns `helix|ollama|openai|anthropic`.
The 5-mode model maps on top (resolver stays the single resolution point,
T-3-amended):

| Mode | resolver `provider` | `ff_heuristic_enabled` (routing) |
|------|--------------------|-----------------------------------|
| 1 Heuristics | (none consulted) | true, no LLM configured |
| 2 Helix (Google) | `helix` (Gemini model) | false |
| 3 Heur + Helix | `helix` | true |
| 4 ChatGPT | `openai` | false |
| 5 Claude | `anthropic` | false |

`ollama` is retained internally (not surfaced as a mode — out of scope).

## 8. Scope / Non-Goals

- **In:** resolver mapping, 5-mode UI selector + 4b/5b sub-toggle + degraded
  banner, T-3 amendment in ARCHITECTURE-TRUTHS + REGRESSION_PLAN, Config.js +
  BankingAgent header surfaces, Mode-1 no-match catalog message, **live
  4b/5b platform-driven runtime** (OpenAI Responses API / Claude
  `mcp_connector` loop against the gateway).
- **Out (this pass):** UserDashboard §1-protected surface (deferred per prior
  decision).
- **Non-goal:** weakening any server-side transfer/HITL/Authorize enforcement.

## 9. Constraints

- ARCHITECTURE-TRUTHS T-3 amended (documented, not silently broken);
  T-4 (PingOne mints), T-10 (single-resource) unchanged.
- REGRESSION_PLAN §1 server-side HITL/transfer enforcement rows: **must not
  be touched** — §4 entry will explicitly assert they are unchanged.
- Single resolver point preserved (no inline provider defaults).
- UI build exit 0; no emojis except ⚠️ ✅ ❌; minimal diff.
- Concurrency guard (commit `c2c1b5f6`) now protects commits.

## 10. Resolved Decisions

1. **Mode 1 ("Heuristics"), no LLM, unrecognised query → polite catalog
   message.** When the heuristic returns no-match in mode 1, the agent replies
   with a deterministic "I can help with: <capability list>" message rather
   than silently doing nothing or erroring. The capability list is derived
   from the heuristic's known intents (single source — no hand-maintained
   second list). It must NOT fall through to any LLM (mode 1 = no LLM).
2. **4b/5b live platform runtime is built in this same pass** (not deferred).
   Modes 4 & 5 ship with both sub-shapes functional: via-BFF (Slice A, exists)
   and platform-driven (Slice B, the OpenAI Responses API / Claude
   `mcp_connector` loop against the gateway) plus the degraded-mode banner.
   §8 "Out" line for the live 4b/5b runtime is hereby removed from scope-out.

---

## Sources / Cross-refs

- `2026-05-18-chatgpt-claude-as-agent-design.md` (§4a/4b/4c research, slices A/B3)
- ARCHITECTURE-TRUTHS T-3, T-4, T-10
- REGRESSION_PLAN §1 (HITL/transfer enforcement), Phase 170
- Gateway: `banking_mcp_gateway/src/{tokenValidator,auth/GatewayTokenPolicy,auth/PingOneAuthorizeClient,credentialSwap}.ts`
- `banking_api_server/services/llmProviderResolver.js`,
  `banking_api_ui/src/hooks/useLangchainProvider.js`
