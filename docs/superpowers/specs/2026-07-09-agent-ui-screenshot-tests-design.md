# Agent UI Screenshot Tests — Design

**Date:** 2026-07-09
**Branch:** `feat/agent-ui-screenshot-tests`
**Status:** Design approved, ready for implementation planning

## Purpose

Produce reviewable **screenshot documentation of the Agent UI response** across
multiple LLM providers, so we can see — side by side — how each provider answers
the same use-case chip in the same vertical. Tests drive the **real UI against a
live BFF session (no mocks)** and validate both visual appearance and response
content.

This is both a **regression artifact** (golden screenshots catch UI drift) and a
**demo/teaching artifact** (a markdown doc showing "llama.cpp vs Claude vs Helix
vs Google, answering the same question").

## Scope

### In scope

- **4 LLM modes:** llama.cpp, Claude (Anthropic), Helix, **Google API (new — built
  in Phase 1)**. Heuristics is intentionally excluded as a mode under test.
- **4 core verticals:** banking, retail, healthcare, investment.
- **2–3 representative chips per vertical.**
- **Real UI** (Playwright driving the actual React app against a live BFF
  session). No mocked API responses.
- **Output format:** one markdown row per chip, showing the 4 mode screenshots
  side by side (a comparison grid). The screenshot PNGs, per-vertical
  `manifest.json`, and the master `README.md` are **generated at live-capture
  time**, not committed — a capture run requires a stack that runs this branch
  with the providers configured (see Implementation status below).
- **Validation:** content correctness (in-domain keyword assertions) as the
  enforced gate, plus the captured PNGs as a visual record. The primary
  deliverable is the side-by-side comparison doc so a reader can *see* each
  provider's response; pixel-diff golden regression (`toHaveScreenshot`) was
  dropped in favor of the raw comparison artifact, which better matches the
  goal of showing results.

### Out of scope

- Heuristics mode (deterministic, already covered by unit tests).
- Non-customer verticals: admin, admin-console, pingone-admin, a2a,
  oauth-teaching.
- Secondary domain verticals (government, manufacturing, university, workforce,
  sporting-goods) — deferred; the harness is built to extend to them later.
- Stitched-PNG composites (using markdown rows of separate PNGs instead).

## Key finding that shaped this design

**Google is not currently a working provider.** The agent reasoning engine
`reasonOnce` in `demo_agent_service/src/reasoningGraph.ts` only has provider
branches for `anthropic`/LM Studio (L138), `helix` (L236), and `llamacpp`
(L264). Any other provider falls through to the "unknown provider → reasoning
unavailable" path (L316). The `// groq/google exist server-side` comment in
`demo_api_ui/src/hooks/useLangchainProvider.js` is aspirational — there is no
`google` branch and no Google SDK dependency in `demo_agent_service`.

Therefore **adding "Google API" is a real feature build, not a config toggle.**
Phase 1 implements it in full before any screenshot testing begins.

## Architecture

### Component 1 — Google/Gemini provider (Phase 1 build)

Mirrors the existing three providers. The `@langchain/google-genai`
`ChatGoogleGenerativeAI` class exposes the same `.bindTools()` / `.invoke()`
interface already used for llama.cpp (`ChatOpenAI`), so the new branch is nearly
a copy of the llamacpp block.

| Task | File | Change |
|------|------|--------|
| Add dependency | `demo_agent_service/package.json` | `@langchain/google-genai` |
| Provider branch | `demo_agent_service/src/reasoningGraph.ts` | new `req.provider === 'google'` block in `reasonOnce`: bind tools, invoke, extract text + tool_calls, return the standard `ReasonResponse` |
| Env config | `.env` + `demo_agent_service/src/config.ts` | `GOOGLE_API_KEY`, optional `GOOGLE_MODEL` (default `gemini-2.0-flash`) |
| Config validation | `demo_api_server/services/llmProviderStatus.js` | `provider === 'google'` requires `google_api_key` → drives "greyed out if unconfigured" UX |
| UI mode | `demo_api_ui/src/config/agentModes.js` | `{ id: "google", label: "Google API", provider: "google", pure: true }` |
| Server mode | `demo_api_server/services/agentModeResolver.js` | `{ id: 'google', provider: 'google', heuristicRouting: false, external: true }` |

Note: `agentModes.js` and `agentModeResolver.js` have a drift guard
(`__tests__/agentModes.test.js`) — both must be updated together or the build
fails. This is a feature, not an obstacle.

**Phase 1 success criteria:**
- All 4 LLM modes are selectable in the UI mode picker.
- Selecting Google + sending one message returns a real Gemini response (not
  "reasoning unavailable").
- A unit test confirms the Google branch produces a `tool_call` for a
  tool-worthy prompt and prose for a non-tool prompt.

### Component 2 — Screenshot test harness (Phase 2 build)

A reusable Playwright helper. Built once against Banking, then reused verbatim
for the other three verticals.

Per-chip flow, run **once per LLM mode** (4×):

```
1. Set agent mode:  POST /api/langchain/config  { agent_mode: <mode> }
   (same endpoint the UI mode picker uses — no feature-flag file edits)
2. Guard: GET /api/langchain/provider/<provider>/status — if `configured` is
   false, SKIP this mode and record the skip loudly in the doc (never omit
   silently). (Note: /config/status is NOT used for this — its key_set never
   emits google/llamacpp flags, which would falsely skip both.)
3. Open the vertical's dashboard (real UI, real BFF session cookie).
4. Click the chip.
5. Wait for the agent response to settle.
6. Screenshot the full agent panel → save as
   <vertical>/<chip>/<mode>.png
7. After all 4 modes for a chip: assemble a markdown row with the 4 images
   side by side.
8. Assert content: in-domain keywords present, cross-domain keywords absent
   (e.g., a banking chip response contains account/balance terms and no
   retail/loyalty terms).
```

Reuses the live-session pattern from
`demo_api_ui/tests/e2e/banking-agent.real.spec.js`.

### Component 3 — Documentation assembly (Phase 6)

A master markdown doc that indexes every composite row, grouped by vertical then
chip, with a legend and a "skipped modes" section listing any provider that was
unconfigured at capture time.

## Data flow

```
Playwright test
  → POST /api/langchain/config {agent_mode}      (BFF session config)
  → GET  /api/langchain/config/status            (availability guard)
  → navigate to vertical dashboard (real UI)
  → click chip → BFF → demo_agent_service.reasonOnce(provider)
                       → real LLM call (llama.cpp / Anthropic / Helix / Gemini)
  → agent response renders in panel
  → screenshot panel PNG
  → (×4 modes) → markdown comparison row
  → content assertions (in-domain / cross-domain keywords)
```

## Error handling

- **Provider unconfigured** (`key_set` false): skip that single mode, record it
  in the doc's "skipped modes" section. Other modes still run. No silent gaps.
- **Provider reachable but errors** (e.g. Helix transport error): the agent
  returns "reasoning unavailable" — the screenshot captures that real state and
  the content assertion for that mode is relaxed to "unavailable message shown".
- **Chip surface missing for a vertical**: fail the phase loudly — a core
  vertical must have a customer chip surface.

## Testing strategy

- **Visual record:** each capture writes a PNG of the agent panel per (vertical ×
  chip × mode), assembled into the side-by-side comparison doc. This is a visual
  record for review, not a pixel-diff regression gate (`toHaveScreenshot` was
  dropped — see Scope).
- **Content correctness (enforced gate):** keyword assertions per response — the
  domain's own vocabulary present, other domains' vocabulary absent.
- **Isolation:** each phase (vertical) is independently runnable and shippable.

## Phasing

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **1** | Build Google/Gemini provider + validate all 4 modes | 4 modes selectable & responding; Google unit test |
| **2** | Screenshot harness + Banking | Reusable harness + banking composites + golden baselines |
| **3** | Retail | Retail composites (reuses harness) |
| **4** | Healthcare | Healthcare composites |
| **5** | Investment | Investment composites |
| **6** | Doc assembly | Master markdown doc indexing every composite |

Each of phases 2–5 yields only 2–3 composite rows (one per chip) — small,
reviewable batches, addressing the "don't overwhelm with 30–70 tests at once"
constraint.

## File locations

- **This spec:** `docs/superpowers/specs/2026-07-09-agent-ui-screenshot-tests-design.md`
- **Harness + specs:** `demo_api_ui/tests/e2e/agent-screenshots/`
- **Screenshots (golden + captured):** `demo_api_ui/tests/e2e/agent-screenshots/__screenshots__/<vertical>/<chip>/<mode>.png`
- **Master doc:** `demo_api_ui/tests/e2e/agent-screenshots/README.md`

## Open items to resolve during implementation

- Exact chip selection (2–3) per vertical — pick from each vertical's manifest
  during that vertical's phase.
- Gemini default model id (`gemini-2.0-flash` proposed; confirm against the
  available API key's access at build time).

## Implementation status (2026-07-10)

- **Phase 1 (Google/Gemini provider): complete and merge-ready.** Dependency,
  contract, `reasonOnce` branch, wiring, config + both mode tables; unit-tested,
  full agent suite green, drift guard green.
- **Screenshot suite (harness + 4 vertical specs + doc builder): code complete;
  live captures deferred.** A live run against the AWS deployment
  (`ai-demo.ping-devops.com`) confirmed that environment does **not** run this
  branch (its agent-mode list still exposes the retired `ollama` mode and has no
  `google` mode). Provider availability there, via
  `GET /api/langchain/provider/<name>/status`: **helix, llamacpp, and google are
  all `configured`/`available`; only anthropic (Claude cloud) is unconfigured.**
  So once this branch is deployed to that stack, 3 of the 4 columns
  (llama.cpp, Helix, Google) capture immediately and Claude records a skip until
  its key is set. The harness records unavailable modes as skips with a reason.
- **To capture live:** `E2E_BASE_URL=<url> E2E_CUSTOMER_USERNAME=<user>
  E2E_CUSTOMER_PASSWORD=<pass> npx playwright test tests/e2e/agent-screenshots/
  --config=playwright.real.config.js`, then
  `node tests/e2e/agent-screenshots/build-doc.js`.
