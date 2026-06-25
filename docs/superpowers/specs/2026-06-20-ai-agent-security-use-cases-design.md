# AI-Agent Security Use Cases — Design

**Date:** 2026-06-20
**Status:** Approved in brainstorming. Next step: implementation plan (writing-plans).
**Related (separate effort):** Customer dashboard restyle — see `~/Desktop/customer-dashboard-redesign-HANDOFF.md`. The launcher visual language is shared with that restyle, but the two ship independently.

## Problem

The demo and docs have grown feature-by-feature rather than from a deliberate narrative. The demo already *enforces* ~50 distinct AI-agent security behaviors (delegation, scope, authorize policy, gateway/client-trust), but there is no single artifact that says "here is the set of stories we tell, here is how to run each one, and here is whether it actually works today." Docs drift from the demo because they are maintained separately.

**Fix:** define a catalog of security **use cases** first, and make it the single source of truth that drives the demo *and* the docs.

## Audience

Dual-purpose, every use case serves both:
- **Prospect/customer sales demo** — a Ping SE walks a security/IAM buyer through "here's the AI-agent threat → here's how PingOne solves it."
- **Internal SE enablement** — a scripted, replayable scenario any SE can run without fumbling.

## The Catalog (20 use cases, 3 demo tracks)

Original 7 (user's starting list) marked ★. UC14–UC15 are an explicitly-labeled "advanced" appendix (observation-only / flag-gated today). UC17–UC20 are OWASP-gap additions (see "OWASP ASI alignment" below). 🛡️ = OWASP ASI-aligned; the `owasp` refs that earn the badge are in parentheses *(threat-codes · guide-sections)*.

### Foundations — "how delegated agent access works"
- **UC1 — Delegated access with proof** 🛡️ — RFC 8693 chain (user→agent `act` claim); every agent action traces to a human. *(T8, T9 · §4.1.1, §3.3.3, §8)*
- **UC2 — A2A delegation** ★ 🛡️ — generalist→specialist, nested `act`, scope narrowed. *(T9, T13 · §4.2.3, §4.3)*
- **UC3 — may_act gate** 🛡️ — agent may act only if the user authorized it. *(T3, T13 · §4.1.1)*

### Controls — "policy governs what the agent may do"
- **UC4 — Overscoped agent** ★ 🛡️ — agent holds more scope than the task needs; surfaced/narrowed (hygiene/least-privilege). *(T3 · §5.1)*
- **UC6 — Authz denied** ★ 🛡️ — PingOne Authorize DENY (e.g. amount over limit). *(T6 · §4.2.2 PEP)*
- **UC7 — Step-up required** ★ 🛡️ — high-value action triggers MFA (428 / step-up obligation). *(T10, T3 · §3.1.5, §5.6)*
- **UC8 — HITL consent** ★ 🛡️ — human approval required; verified receipt discharges the gate. *(T10 · §3.1.5, §8)*
- **UC9 — Group / entitlement check** 🛡️ — user not in required group → DENY. *(T3 · §4.1.1)*

### Attacks — "malicious attempt, blocked by PingOne" (framed attempt → blocked → evidence)
- **UC5 — Wrong / insufficient scope** ★ 🛡️ — tool needs a scope the token lacks → DENY. *(T2, T3 · §5.1)*
- **UC10 — Resource-ownership / account takeover** 🛡️ — agent tries to act on another user's resource → DENY (confused-deputy / Meta-chatbot-style attack). *(T3 · §2.2.1, §4.2.2)*
- **UC11 — Bad client → agent gateway** ★ 🛡️ — missing / expired / wrong-aud / malformed token → 401. *(T9 · §8, §4.2.2)*
- **UC12 — Token theft / replay defense** 🛡️ — stolen token unusable: audience-binding anti-bypass (D-05) + DPoP key binding + introspection `active:false`. *(T9 · §3.2.8, §4.2.3)*
- **UC13 — Confused-deputy actor injection** 🛡️ — rogue agent forced into `act` claim → DENY via allowlist. *(T13 · §4.2.2)*
- **UC14 — RAR intent violation** *(advanced)* 🛡️ — agent exceeds granted amount/payee (RFC 9396). *(T6 · RFC 9396, §3.1.7)*
- **UC15 — Intent-token tampering** *(advanced)* 🛡️ — tampered/expired intent token detected. *(T6, T8 · §4.2.2)*
- **UC16 — Impersonation blocked (OBO required)** 🛡️ — agent presents an *impersonation* token (`sub=user`, **no `act` claim**, agent identity erased) instead of acting *on behalf of* the user (`sub=user`, `act={agent}`). Must be rejected: only OBO/delegation is allowed, so every agent action stays attributable. This is the negative of UC1 — it's what makes the delegation proof meaningful. *(T9 · §3.3.6, §4.1.1)*
  - **Maturity: `needs-build`.** Pure impersonation is currently ALLOWED: gateway treats `act` as optional (`demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts:39`), authz permits empty ActClientId as a "simple exchange" (`demo_authz_server/routes/decision.js:315`), and the exchange can mint a no-actor token (`oauthService.js:264` `performTokenExchange`). Enforcement to add: require `act` for agent-context tool calls at `GatewayTokenPolicy.ts:29` and add a deny rule at `decision.js:307–338` (and mirror in `simulatedAuthorizeService.js` for parity).

### OWASP-gap additions — controls OWASP names that PingOne can enforce, not previously catalogued
- **UC17 — JIT / ephemeral credentials** 🛡️ *(track: controls)* — the agent runs on a short-lived token (tight TTL + refresh, not a long-lived static credential); a token captured minutes later is already dead. Splits the credential-lifetime story out of UC12 so least-privilege-in-time is its own narrative. *(T3, T9 · §3.2.8, §4.1.1)*
  - **Maturity: `works`** — exchanged/agent tokens are already short-lived; this UC surfaces TTL + refresh + post-expiry rejection as a deliberate scenario.
- **UC18 — Rate-limit / resource-overload defense** 🛡️ *(track: attacks)* — the agent gateway throttles per-agent / per-tool; a burst of tool calls is rejected (429) instead of overwhelming the backend or running up cost. Answers an OWASP threat (resource exhaustion / DoS / cost-runaway) the catalog addressed nowhere. *(T4 · §4.2.3, §8)*
  - **Maturity: `needs-build`** — confirm/extend gateway rate limiting and expose the 429 as a launchable case.
- **UC19 — Non-human (agent) identity lifecycle** 🛡️ *(track: foundations)* — the agent has its own first-class PingOne identity that is provisioned, credential-rotated, and de-provisioned; calls from a retired/orphaned agent identity fail. Directly answers OWASP's "Managing Non-human Identities". *(T9, T13 · §3.3.6, §8)*
  - **Maturity: `needs-build`** — agent apps exist in PingOne; the lifecycle (rotate/retire → blocked) is the net-new demo.
- **UC20 — Audit trail / traceability** 🛡️ *(track: foundations)* — every agent action is logged with the acting identity, the `act` chain, and a per-run `useCaseId`, reconstructable end-to-end; "who did the agent think it was acting as" is always answerable. Nearly free — the evidence panels already emit this; this UC names it as a control. *(T8 · §3.3.3, §8)*
  - **Maturity: `works`** — `buildTokenEvent` / `appEventService.logEvent` already stamp `useCaseId`; this surfaces the audit/traceability story explicitly.

> **Out of scope for this catalog (not PingOne's lane — stated for honesty, not faked):** memory poisoning (T1), prompt-injection / output guardrails (T2/T6 content-filtering, §3.1.2/§3.3.2), code-execution sandboxing / RCE (T11, §3.2.3), cascading hallucination (T5), human manipulation (T15). These belong to guardrail/sandboxing/content-moderation layers, not the identity/authz controls this demo proves.

## Approved decisions

1. **Catalog-as-data is the single source of truth.** A machine-readable catalog (`demo_api_server/config/useCases.js`, served to the UI). The demo, the audit, and the docs all derive from it. No duplicate lists.
2. **Launcher = Option A (full catalog), in both placements.** A top-level `/use-cases` page (full grouped catalog, big run buttons, room for "what to say") **and** a slim launch drawer on the agent screen for quick re-runs without leaving the conversation.
3. **Attacks use real crafted requests.** An attack-simulator endpoint sends genuinely malformed/crafted requests (expired token, wrong-aud, rogue `act`, over-RAR) at the real gateway, so the 401/DENY is a real enforcement event — not theater.
4. **Audit status is a first-class generated output.** A table of works / flag-gated / needs-console-import, derived from each entry's `maturity` field, so "what runs today" is always honest and visible.
5. **`useCaseId` is the through-line.** Every emitted token-chain event (`buildTokenEvent`) and activity event (`appEventService.logEvent`) is stamped with `useCaseId`, so both evidence panels gain a "filter by use case" control.

## Use-case spec template (per catalog entry)

| Field | Meaning | Example (UC7) |
|---|---|---|
| `id` / `useCaseId` | short id / slug | `UC7` / `step-up-required` |
| `track` | `foundations` \| `controls` \| `attacks` | `controls` |
| `title` | display name | Step-up required |
| `buyerStory` | the threat / why it matters (buyer-facing prose) | "A high-value agent action shouldn't go through on the agent's say-so alone." |
| `pingOneSolution` | the control + capability | PingOne Authorize returns step-up obligation → MFA before PERMIT |
| `trigger` | how the launcher runs it | `{type:'chip', text:'transfer $600 to savings'}` or `{type:'attack', sim:'expired-token'}` |
| `expectedOutcome` | observable result | `STEP_UP` (428) |
| `evidence` | what lights up | tokenChain ids: `authorize-decision`; activity categories: `authorize`, `mcp` |
| `codeRefs` | enforcement location(s) | `simulatedAuthorizeService.js:594`, `authorizeObligations.js:75` |
| `maturity` | honesty field | `works` \| `flag:<name>` \| `needs-console-import` \| `needs-build` (+ `whatToEnable`) |
| `owasp` | OWASP ASI alignment (earns the 🛡️ badge) | `{ threats: ['T10','T3'], sections: ['§3.1.5','§5.6'] }` |
| `whatToSay` | one-line SE caption | "$600 ≥ $500 → MFA required, then it proceeds." |
| `advanced` | appendix flag | `true` for UC14/UC15 |

## OWASP ASI alignment

Maps the catalog to the **OWASP Securing Agentic Applications Guide v1.0** (Gen AI Security Project, Agentic Security Initiative) — its threats `T1–T15` and guide sections. This gives every use case a citable, vendor-neutral backing ("not us inventing controls — OWASP ASI T9 + §4.1.1") and is the source of the 🛡️ badge.

**Badge — data-driven, earned not decorative:** an entry renders 🛡️ **only when `owasp` is non-empty**. The badge's tooltip/expander lists the threats + sections it satisfies. It is **orthogonal to `maturity`**: 🛡️ says "this control is in the OWASP framework"; the maturity emoji says "does it run today." A row can show both, e.g. `UC7 Step-up required ✅ 🛡️`.

**Emoji legend (pin these so rows read consistently):**

| Emoji | Meaning | Driven by |
|---|---|---|
| 🛡️ | OWASP ASI-aligned | `owasp` non-empty |
| ✅ | Works today | `maturity: works` |
| 🚩 | Flag-gated | `maturity: flag:<name>` |
| 📥 | Needs PingOne console import | `maturity: needs-console-import` |
| 🏗️ | Net-new, needs build | `maturity: needs-build` |

**Coverage today:** all 20 use cases are 🛡️ OWASP-aligned. Threats covered: T2, T3, T4, T6, T8, T9, T10, T13. Threats deliberately **out of scope** (guardrail/sandboxing/content-moderation layers, not identity/authz): T1, T5, T7, T11, T12, T14, T15 — listed under the catalog's out-of-scope note so the demo never over-claims OWASP coverage.

**Rendering note (no-emoji UI rule):** the app's hard no-emoji-in-UI rule still applies. In the UI, render 🛡️ as a small "OWASP ASI" shield label/SVG chip (not a literal emoji glyph); the emoji here is the catalog/docs shorthand. The audit-status table and generated docs may use the glyphs directly.

## What derives from the catalog

### 1. Demo (launcher + tagging)
- `/use-cases` page and the agent-screen launch drawer render straight from the catalog, grouped by `track`.
- `trigger.type === 'chip'` → deep-links the existing chip/flow with params pre-filled (reuse the rich flows that already work for Foundations/Controls).
- `trigger.type === 'attack'` → calls the **attack-simulator** endpoint, which crafts the real bad request and shows the live rejection.
- Backend stamps `useCaseId` onto each `buildTokenEvent` / `appEventService.logEvent`. Both panels (Token Chain, What's Happening) get a "filter by use case" control driven by that tag.

### 2. Audit (generated status table)
- A small script reads `maturity` across the catalog and emits a table: works / flag-gated / needs-console-import, plus the `whatToEnable` punch list to make each one live.

### 3. Docs (generated)
- A generator turns each catalog entry into a doc section: buyer story → PingOne solution → how to run it → expected outcome → evidence → code refs. Plus an index grouped by track. Docs cannot drift because they are generated from the same file. Buyer-narrative prose lives inline in `buyerStory` / `whatToSay`.

## Architecture / components

- **`demo_api_server/config/useCases.js`** — the SoT catalog (array of entries per template). Served via a read endpoint to the UI.
- **Attack-simulator** — a self-contained backend module + endpoint that builds crafted requests for the `attacks` track and sends them at the real gateway; returns the rejection plus the events to surface.
- **`useCaseId` tagging** — threaded through the token-event builder (`agentMcpTokenService.js` / `mcpToolPipeline.js`) and `appEventService.logEvent`.
- **UI** — `/use-cases` page + launch drawer (render from catalog); "filter by use case" control added to `TokenChainDisplay` and the activity-log panel.
- **Audit script** — reads catalog, emits status table (Markdown).
- **Docs generator** — reads catalog, emits per-use-case doc sections + index.

## Data flow (one run)
1. SE clicks a use case (page or drawer).
2. Launcher reads the entry's `trigger`; chip → existing flow with params, attack → attack-simulator endpoint.
3. Backend executes the real flow/attack; emits token + activity events stamped with `useCaseId`.
4. Both evidence panels filter to that `useCaseId`; the row shows `expectedOutcome` and `whatToSay`.

## Maturity / honesty
The catalog records the *real* state per the code inventory (e.g., A2A is `flag:ff_a2a_delegation`; live PingOne Authorize paths are `needs-console-import`; many simulated paths are `works`). The audit table is generated from these fields so the demo never over-claims.

## Out of scope (v1)
- Customer dashboard restyle (separate effort; shares visual language only).
- UC14/UC15 deep demo polish — shipped as advanced appendix, observation-only.
- Net-new enforcement controls — this effort mainly catalogs, audits, and surfaces what exists. **Exception: UC16 (impersonation blocked)** is a deliberate net-new control the user requested; its enforcement points are identified and it carries `needs-build` maturity.

## Open items for the implementation plan
- Exact `trigger` mapping for each of the 20 (which existing chip/flow + params, or which attack-sim case). UC17–UC20 triggers TBD (UC17 token-TTL/refresh flow; UC18 attack-sim burst → 429; UC19 agent-identity rotate/retire admin flow; UC20 surfaced via the existing `useCaseId`-tagged evidence panels).
- Attack-simulator: list of crafted-request cases and how each reaches the gateway safely.
- Whether the docs generator writes to `docs/use-cases/` and is wired into a build/CI step.
- Whether the `/use-cases` page is gated by a feature flag.
