# Token Chain — Teach what happened in a flow run

**Date:** 2026-07-22  
**Branch:** `feat/token-chain-teaching-flow`  
**Surface:** `TokenChainTraceRail` / `TraceStepCard` / `buildTraceSteps`

## One Token Chain model

Live evidence lives in `tokenChainTraceStore` + `buildTraceSteps`. **Every demo
surface mounts `TokenChainTraceRail`** (floating panel, agent modal, dashboards,
`/monitoring/token-chain`, DevTools “Token Chain” tab). Do not reintroduce
`TokenChainDisplay` as a second live view.

`TokenChainDisplay.js` remains only as a helper module (`isHaltedAt`,
`resolveStatusVisual`) and legacy card code — not mounted for live teaching.

**Delegation proof taught on-chain is `act` (RFC 8693), not `may_act`.** Token Chain
UI must not surface may_act hints/pills/edu; keep `act` teaching.

## Goal

After every agent/tool run, a non-expert can answer: *what happened, why each hop ran, and what would have failed if X were wrong* — without drowning in raw JSON.

## Progressive disclosure

| Layer | Surface | Content | When |
|-------|---------|---------|------|
| **L0 Story** | TraceRail sticky strip under tabs | 1–2 sentence run narrative + outcome chip (ok / error / mid-flight) | Always when a trace has started |
| **L1 Why** | Expanded step body | Static *what* (`narrative`) + run-specific *why* + kv / decision | Expand step |
| **L2 Evidence** | Collapsed `<details>` under step | Coloured request/response JSON | “Show evidence” |
| **L3 Deep dive** | Pop-out browser window | Full teaching copy + coloured JSON for that hop | “Pop out” / auto-offer when payload is large |

**Rule:** L0–L1 never lead with raw JSON. L2 is optional. L3 is the overflow valve.

## Step teaching template

Every expanded step should read as:

1. **What** — existing `detail.narrative` (static hop purpose).
2. **Why (this run)** — new `detail.why` derived from live evidence (decision, aud, scope, tool).
3. **Proof** — existing kv / decision / scopeDiff.
4. **Evidence** — request/response behind closed details (or pop-out if large).
5. **Learn more** — existing `moreDetail` / Inspect links.

## Pop-out policy

- Add **Pop out full detail** on every step that has request, response, or why.
- Auto-emphasize when combined request+response text length > **1200** chars.
- Reuse JsonHighlight tokenizer colours (`jh-*`) in the pop-out document (same approach as TokenChainDisplay `openInNewWindow`).

## Data-path fixes (teaching needs proof)

1. ✅ 2-exchange `exchangeRequest` preserved on success (#727).
2. Authorize step: if BFF `authorize-decision` / `ingestAuthorize` missing but `gw-authorize` present, treat gateway authorize as the teaching evidence so L1/L2 are not blank.
3. (Follow-up) MCP deny paths should still publish attempted `requestJson` + error body.

## Phases

| Phase | Work | Done when |
|-------|------|-----------|
| **A** | `detail.why` for key steps; authorize←gw-authorize fallback | Vitest asserts `why` + authorize request text from `gw-authorize` | ✅ |
| **B** | TraceStepCard: collapse evidence; pop-out CTA | Unit test: evidence in `<details>`; pop-out button present when evidence exists | ✅ |
| **C** | L0 `buildRunStory(trace, steps)` strip on rail | Vitest for story text; strip visible in TraceRail | ✅ |
| **D** | (Follow-up) MCP evidence on deny; richer why copy per UC | Separate PR |

## Do not break

- TraceRail step ids / `notinpath` semantics / emoji allowlist.
- Existing `NARRATIVES` / RFC pills / Inspect claims.
- Token exchange, session cookie, or auth flows (UI teaching only + authorize evidence alias).

## Verify

```bash
cd demo_api_ui && npm test -- --run \
  src/services/tokenChainTrace/__tests__/buildTraceSteps.test.js \
  src/components/__tests__/TraceStepCard.defaultOpen.test.jsx \
  src/components/__tests__/TraceStepCard.teaching.test.jsx
cd demo_api_ui && npm run build
```

Live: run “show my balance”, expand Exchange / Gateway / Authorize — see why line, collapsed evidence, pop-out works; rail header shows L0 story.
