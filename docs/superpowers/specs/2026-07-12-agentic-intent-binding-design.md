# Agentic Transaction Intent Binding — Design

**Date:** 2026-07-12
**Status:** Approved (brainstorming), pending spec review
**Research:** [docs/reports/ai-transaction-intent-drift-2026-07-12/report.md](../../reports/ai-transaction-intent-drift-2026-07-12/report.md)
**Scope (indicative — confirmed at plan time):** `demo_api_server/routes/devTools.js`, `demo_api_server/services/` (new intent-artifact + verification service), `demo_api_server/config/useCases.js`, `demo_api_ui/src/pages/UseCaseLauncherPage.js`, a new learning-page component + route, the token-chain/flow-status renderers, `demo_api_server/services/a2aOrchestratorService.js` (for the txn-token use case).

## Problem

AI-DEMO2 already has an **Intent Bypass** attack demo: it shows what happens when an agent's requested action (`create_transfer`) doesn't match its declared intent (`view_balance`) — the gateway denies with `error:intent_mismatch_demo`. What's missing is the *legitimate* counterpart: a demonstration of how an agent's declared intent gets **bound to a transaction up front** and **verified at execution time**, grounded in how the industry (and Ping's own product) actually does this — not just "the deny path exists."

Research (linked above) surfaced four distinct, well-documented models for binding/verifying agent intent:

1. **AP2** (Google) — a signed Intent Mandate → Cart Mandate → Payment Mandate chain. Real open-source reference implementation.
2. **RFC 9396** (Rich Authorization Requests) — structured `authorization_details` (e.g. a `payment_initiation` object) checked at the resource server.
3. **OAuth Transaction Tokens draft** — a JWS-signed `tctx` claim that must propagate unmodified across a multi-hop call chain. Unratified draft, no reference implementation.
4. **Ping's own current model** — OAuth 2.0 Token Exchange (RFC 8693): a delegation token carrying `sub`/`act.sub`/`scope`/`aud`, validated at an agent gateway per call. This is close to what AI-DEMO2's token chain already represents.

Goal: teach all four, each as its own use case, each showing the MCP gateway and P1AZ doing the actual enforcement — visible in the agent's own response, in the token chain, and on a new learning page.

## Non-goals (YAGNI)

- No real calls to Google/Coinbase/Visa/Mastercard services — all four formats are **simulated** artifact construction; only the P1AZ policy decision and/or MCP gateway call get a **Live** toggle (matching the existing P1AZ Learning Page pattern).
- Not modifying the existing Progressive Trust Demo track/strip.
- Not re-litigating or removing the existing Intent Bypass attack demo — this work extends it with the PERMIT-side counterpart and reuses its DENY plumbing (`error:intent_mismatch_demo`, `gw-intent-deny`), generalized across formats.
- Not building real cryptographic signing (no actual asymmetric key infra) — mandates/tokens are simulated-signed (opaque signature stand-ins) for teaching purposes, consistent with how the rest of the demo already simulates trust artifacts.
- Not covering Visa TAP, Mastercard Agent Pay, x402, or GNAP as full use cases — they're context/comparison material on the learning page only (per research: identity-only, closed-spec, or draft-only respectively).

## Design

### 1. Shared core: Intent Artifact + `verifyIntentBinding`

One new BFF concept, an **Intent Artifact**, built when a demo transaction starts. Tagged by `format`:

| `format` | Payload | Constructed by |
| --- | --- | --- |
| `ap2-mandate` | `{ intentMandate, cartMandate, paymentMandate }` — cart/payment simulated-signed and hash-chained back to the intent mandate | new service |
| `rar-9396` | `{ authorization_details: [{ type: 'payment_initiation', actions, amount, currency, creditor_name }] }` | new service |
| `txn-token` | `{ tctx }` — simulated JWS-signed transaction-context claim | new service, threaded through `a2aOrchestratorService.js`'s existing orchestrator→specialist hop |
| `token-exchange` | `{ sub, act: { sub: agentId }, scope, aud }` | mostly narration over the existing token-chain delegation shape — minimal new construction |

One new gateway-side check, `verifyIntentBinding(artifact, requestedAction)`, generalizing Intent Bypass's existing mismatch logic across all four formats. One PERMIT/DENY outcome shape; format-specific comparison logic and DENY reason.

### 2. Five use cases (four formats, AP2 gets two paths)

One canonical banking scenario — the agent pays a bill / makes a transfer on the customer's behalf — reused across formats so they read as one coherent "intent binding" story, not four unrelated builds. Each path has a PERMIT branch (declared intent matches requested action) and a DRIFT branch (declared intent doesn't match — wrong payee or over the declared cap — DENY via `verifyIntentBinding`):

- **UC-Intent-AP2-Present** — human-present: customer approves a specific transfer now; approval signs the Cart Mandate at that moment. (Banking translation of Google's own "find me running shoes" worked example.)
- **UC-Intent-AP2-Delegated** — human-not-present: customer pre-signs an Intent Mandate with constraints ("pay Acme Utilities up to $250, within 7 days"); the agent then executes unattended in a second demo step (no real time delay — simulated as an immediate "later" trigger, consistent with how other timed/unattended scenarios in the demo are already fast-forwarded), only within those signed constraints. This is the strongest structural drift-prevention story of the five — intent binding happens *before* execution.
- **UC-Intent-RAR** — `authorization_details` (`payment_initiation`) checked at the MCP gateway / P1AZ.
- **UC-Intent-TxnToken** — the `tctx` claim must survive unmodified across the existing A2A orchestrator→specialist delegation hop.
- **UC-Intent-TokenExchange** — the baseline: narrates the token chain's existing `sub`/`act.sub`/`scope`/`aud` delegation pattern, explicitly labeled "this is Ping's real production pattern."

Each becomes a card in `UseCaseLauncherPage.js` / `demo_api_server/config/useCases.js`, and an embedded runnable demo on the new learning page.

### 3. Token-chain / flow-status visibility + agent response

A new trace-step type (e.g. `intent-binding`) must appear in every place flow status renders. Per prior project memory there are at least four independent renderers with their own status-bucket mapping (`TokenChainDisplay.js`, `TokenChainTraceRail.jsx`/`buildTraceSteps.js`, `SimpleStepperPanel.js`, `agent-clinical/TokenAuditTimeline.jsx`) — that list will be re-verified against current code at plan/implementation time rather than assumed. The agent's own chat response also narrates the check in plain language (e.g. "Verified against your Cart Mandate via P1AZ" / "Blocked — exceeds your authorized amount").

### 4. Learning page

New standalone "Intent Binding" page with its own nav entry, following the P1AZ Learning Page pattern: one section per demo path (5 total), each with a concept explainer, an interactive Simulated + Live demo, and an explicit "here's what the MCP gateway / P1AZ did" callout. Opens with the confused-deputy framing (why this matters) and includes the comparison table from the research report.

### 5. Error handling

Live-mode failures (P1AZ / gateway unreachable) fall back to Simulated with a visible banner, matching existing demo convention. DENY responses carry a format-specific reason surfaced in the UI and in the agent's response text.

### 6. Testing

- Per-format unit tests for Intent Artifact construction and `verifyIntentBinding` match/mismatch.
- A regression test, in the spirit of the existing tool-authz-chain-drift-hardening gate, asserting every known flow-status renderer surfaces the new `intent-binding` step type — specifically to prevent the kind of gap noted in prior project memory (a prior "not in path" sweep missed `TokenChainTraceRail`) from recurring here.

## Open caveats carried from research

- A claim that RFC 9396 requires the authorization server to cryptographically echo back the exact granted `authorization_details` was explicitly **refuted** during research verification — the learning page must not assert that as a hard spec guarantee without re-checking the RFC text directly.
- Visa TAP, Mastercard Agent Pay, x402, and GNAP claims were either unverified in this research pass or confirmed to be identity-only / draft-only / weak on drift prevention — keep them as labeled comparison context, not equivalent peers to the four full use cases.
