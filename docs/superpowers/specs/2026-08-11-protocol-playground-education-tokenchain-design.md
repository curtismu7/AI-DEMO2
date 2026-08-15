# Protocol Playground — Token-Chain Activity, Education, Step Cards

**Date:** 2026-08-11
**Author:** Claude Code
**Status:** Approved

## Overview

Follow-up to the Protocol Playground extension (PR #1636, #1640). Three
enhancements, all driven by live feedback against the deployed
`/protocol-playground` page and a screenshot of the reference BX Developer
Protocol Playground:

1. Fix remaining display-name casing (`txn-tokens` → "TXN Tokens").
2. Replace the Activity panel's raw JSON dump with a Token-Chain-styled
   event view, consistent across all 10 flows.
3. Populate the already-built (but never fed) `ProtocolExplainer` component
   with a real RFC citation + "what it solves" prose per flow.
4. Add per-step cards (numbered circle, title, description, actor chips,
   own Execute button) matching the reference design, additive to the
   existing Execute All / Next Step / Reset controls.

**Why:** The playground currently under-communicates what's happening.
Raw JSON dumps require reading to understand; a Token-Chain-styled view is
scannable. The flow-level "why does this protocol exist" context is fully
built (`ProtocolExplainer.jsx` + `.pp-explainer*` CSS) but silently renders
nothing because no flow ever populates `spec`. Step-level titles and
descriptions make the sequence diagram's terse `POST /path` labels legible
to someone unfamiliar with the protocol — the explicit goal of this tool.

## 1. Casing fix

`txn-tokens` flow's `@name` tag changes from `Txn-Tokens` to `TXN Tokens`
in `demo_api_server/routes/txnTokenDemo.js`, matching the acronym-styled
casing already applied to the other 9 flows in PR #1640 (RAR, PAR, SPIFFE,
XAA / ID-JAG, PKCE, DPoP, CIBA / HITL, RFC 8693 Token Exchange, Resource
Metadata).

## 2. Token-Chain-styled Activity panel

### Why not reuse `TokenChainDisplay.jsx` directly

`TokenChainDisplay` (5,363 lines) takes only `{ idTokenMode, hideHeader }`
as props — all of its data comes from `TokenChainContext`, the app's
global session-scoped token chain state (driven by SSE / the user's actual
live session). `TokenChainNodeRail` / `TokenChainPresenter` take a `steps`
prop, but shaped for the banking demo's fixed gateway/exchange/mcp/api
pipeline, not an arbitrary event array. None of these are safe to embed
inside a one-off protocol-playground execution result — they'd either show
the wrong (global session) data or require force-feeding data into global
state, which risks corrupting whatever the user's real session is doing
elsewhere in the app.

### What's built instead

`TokenChainEventCard.jsx` — new, small, purely presentational. Reuses the
Token Chain visual language (status colors, monospace claim rows) via
shared class names / a scoped CSS import from the existing
`TokenChainDisplay.css` tokens where they exist as reusable custom
properties, otherwise a short new stylesheet matching them by eye.

Per executed step, `ActivityPanel.jsx` renders:

- **If** `result.response.body.tokenChainEvents` is a non-empty array
  (true today only for RAR, which hits the real `attackSimulatorService`
  path) → one `TokenChainEventCard` per real event, using its actual
  `label` / `status` / `explanation` / `claims` fields verbatim.
- **Else** → exactly one `TokenChainEventCard` synthesized from data the
  step result already has: method + endpoint, HTTP status, and the
  decoded JWT claims if `decodedToken.isValid`. No invented narrative
  text, no fabricated "PingOne Authorize" steps for flows that never
  touched PingOne (SPIFFE, XAA, PKCE, Txn-Tokens, Resource Metadata).

This gives all 10 flows the same visual treatment. The *content* differs
only in how much real structure is available — which is honest, not an
inconsistency to hide.

The existing raw JSON view does not disappear entirely: keep a
collapsed/secondary "Raw response" disclosure under the cards, since the
existing behavior (showing the literal wire response) has standalone value
for someone debugging or verifying the tool's "read the real request and
response" promise from the page's own intro copy.

## 3. Educational description per protocol

`ProtocolExplainer.jsx` (already built, already rendered in
`ProtocolViewer.jsx` at the top, right after the heading) expects
`flowSpec.spec = { url, label, title, why, ai? }` and currently always
receives `undefined` — `generateProtocolFlows.js` never sets `.spec` on
any flow, for any of the 10.

### Generator changes

- **`@rfc <url> <label>` tag** (new, mirrors the existing `@name`/`@body`
  pattern): sets `spec.url` / `spec.label` for the citation badge, e.g.
  `@rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396`.
- **Reuse existing JSDoc prose.** Every route's doc comment already opens
  with 1-2 sentences of human-written description above the `@flow` tag
  (e.g. RAR's "Execute a transfer whose intent is declared via RAR
  authorization_details (RFC 9396) — PingOne Authorize evaluates the
  requested amount against the agent's declared $100 intent cap..."). The
  parser currently extracts only `@`-tag lines and discards this prose.
  Capture it and set it as `spec.why` — replacing the current placeholder
  `description: "Protocol flow: <id>"` on the flow object with this real
  text. Zero new content authoring for this field; it already exists in
  every route file already touched by this feature (and the 4 pre-existing
  ones from PR #1636/#1640).
- `spec.title` = the flow's already-resolved display `name`.
- `spec.ai` is left unset for every flow — out of scope; the page-level
  "Why it matters for AI" intro block already covers this at the top of
  `ProtocolPlayground.jsx` and a per-protocol AI angle risks restating it.

Only the *first* annotation per flow needs `@rfc`; like `@name`, first
value wins.

## 4. Per-step cards

New `StepCard.jsx`, rendered as a list between the sequence diagram and
the existing `ExecutionControls` (Execute All / Next Step / Reset) row —
additive, per explicit decision, not a replacement.

Per step:
- Numbered circle (step order, reusing the same number the diagram's
  `autonumber` already shows).
- Short title — **new** `@title <2-4 words>` tag (e.g. "Obtain Subject
  Token", "Push Authorization Request", "Mint ID-JAG Assertion"). The
  existing auto-derived label (`POST /api/oauth/token/token`) is accurate
  but not legible as a card heading; titles are authored per step to
  describe what actually happens, matching the reference design's style.
  ~19 steps across the 9 already-annotated route files need one line
  each.
- Description — reuses the same JSDoc prose captured for section 3,
  but at **step** granularity: each `@step`-tagged route already has its
  own 1-2 sentence doc comment; that becomes the card's description text
  (distinct from the flow-level `spec.why`, which uses only the first
  step's prose).
- Actor chips with an arrow — from the existing `fromActor` / `toActor` +
  `ACTOR_LABELS` mapping already in `protocolMermaid.js`; no new data.
- Own Execute button — calls `engine.executeStep(step.id)` directly (the
  engine already supports single-step execution; `ExecutionControls`'s
  "Next Step" already does exactly this). Disabled until the previous
  step has a result in `executionState.results` (or step 1, always
  enabled). On completion, shows a status badge (✓ 200 / ✕ 4xx) next to
  the button, mirroring the diagram's per-step status suffix.

### Generator changes

- **`@title` tag** (new): sets `step.title`. Falls back to the existing
  auto-derived `label` if absent (never blocks rendering for a step
  someone forgets to annotate — the card just shows the raw method+path
  as its title, same as today).
- Step description: capture the same per-route leading JSDoc prose already
  captured for `@flow`-level `spec.why`, but scoped to the individual
  `@step`'s own comment block (each step already has its own doc comment
  today — see `routes/parRequest.js`'s two separate JSDoc blocks for step
  1 and step 2). Store as `step.description`.

## Testing

- Unit: `TokenChainEventCard.test.jsx` — renders a real `tokenChainEvents`
  array correctly; renders the synthesized single-card fallback correctly
  when absent; never throws on a step with no response yet.
- Unit: `StepCard.test.jsx` — disabled/enabled state transitions correctly
  as `results` grows; calls `onExecute(step.id)` with the right id.
- Unit: `generateProtocolFlows.test.js` (new or extended) — `@rfc` sets
  `spec.url`/`spec.label`; `@title` sets `step.title`; leading JSDoc prose
  is captured as `spec.why` / `step.description`; a flow/step missing
  these tags still generates without throwing (backward compatible with
  any future annotation someone forgets).
- `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
- `cd demo_api_ui && npm run test:unit && npm run build`
- Manual: regenerate `protocolFlows.json`, load `/protocol-playground` for
  all 10 flows, confirm description renders, step cards render with
  correct enable/disable sequencing, Activity panel shows token-chain-
  styled cards for both the RAR (real-event) and a mock (synthesized)
  flow.

## Out of scope (this pass)

- Fabricated/narrative token-chain events for flows that never produced
  real ones (explicitly rejected — see design discussion; honesty over
  visual sameness).
- Replacing Execute All / Next Step / Reset (kept, per explicit decision).
- A per-protocol "why it matters for AI" blurb (`spec.ai`) — the page-level
  intro already covers this; redundant per-protocol restatement is scope
  creep.
- RAR/Full-XAA composite flow work, SPIFFE/XAA/Txn-Tokens backend realism
  — unrelated to this pass, already shipped as mocks in prior PRs.

## References

- Prior PRs: #1636 (10-flow extension), #1640 (casing + mermaid wrap fix,
  in flight).
- `demo_api_ui/src/components/ProtocolPlayground/ProtocolExplainer.jsx` —
  existing, unused-until-now component this design feeds.
- `demo_api_ui/src/components/TokenChainDisplay.jsx` — reference for visual
  language only, not reused directly (see §2).
- `demo_api_server/scripts/generateProtocolFlows.js` — introspector this
  design extends (`@rfc`, `@title`, prose capture).
