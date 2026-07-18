# Fix the Wrong-Audience Attack Chip — Design

Date: 2026-07-13

## Problem

The "Wrong Audience" chip in the agent chat panel's Security Showcase (`test_wrong_audience`
case, `demo_api_ui/src/components/AIAgent.js:3007-3076`) is supposed to demonstrate RFC 8693 /
RFC 8707 audience validation by presenting a token minted for the wrong audience to the MCP
gateway. In practice it POSTs to `/api/mcp/tool` with a client-side `_testAudience` field —
which the BFF never reads anywhere (`demo_api_server/server.js`'s route handler only destructures
`tool`, `params`, `flowTraceId`, `useCaseId`; `_testActClientId`, by contrast, genuinely is
consumed downstream in `mcpToolPipeline.js:599`). So this chip silently runs a normal, successful
token exchange and tool call — the "attack" never actually happens, and the outcome message
never shows what audience was tried or what audience is actually expected.

This is the one of the "already-real" attacks from the July 12 audit that turned out, on closer
inspection, to be broken.

## Discovery: a real simulator already exists

`demo_api_server/services/attackSimulatorService.js` implements a full attack-simulation
subsystem (the "Use Cases Launcher", A6.1) exposed via `POST /api/demo/attack-sim/run` with
`{sim: <id>}`, gated by `authenticateToken` + the `ff_use_cases_launcher` feature flag (default
`'true'` — no toggling needed). `_runWrongAud` (lines 452-556) already does the real thing:

1. Exchanges the user's token for a **real, PingOne-issued token** whose `aud` claim is a genuinely
   different, real audience (`_wrongAud()`, sourced from config — not a fabricated string).
2. Presents that token to the real gateway via `callToolViaGateway(...)`, expecting a genuine
   `GATEWAY_AUDIENCE_MISMATCH` (canonicalized to `invalid_aud`).
3. Already computes and narrates (in `tokenChainEvents` and `reason`) exactly the two values this
   fix needs: the audience it tried (`wrongAud`) and the audience the gateway actually expects
   (`gatewayAud`) — currently only embedded in prose strings, not returned as structured fields.

This is real, already-tested backend logic that the AI Attacks chip simply never calls.

## Fix

1. **UI (`AIAgent.js`)**: change `test_wrong_audience` to `POST /api/demo/attack-sim/run` with
   `{sim: 'wrong-aud'}`, replacing the current broken `/api/mcp/tool` + `_testAudience` call.
   Update the outcome `token-event` message to show both values explicitly — "Tried: aud=X" /
   "Allowed (gateway expects): aud=Y" — plus the real `status`/`errorCode`/`reason` from the
   response, instead of the current message which shows neither the tried nor allowed audience.
2. **Backend (`attackSimulatorService.js`)**: `_runWrongAud` already computes `wrongAud` and
   `gatewayAud` internally — add them as explicit structured fields (`triedAudience: wrongAud`,
   `allowedAudience: gatewayAud`) on every return path of this function (the two `503`
   config-error early returns don't have real values for both, so only add the fields on the
   paths where both are known: the exchange-success/gateway-deny path, the exchange-failed path,
   and the unexpected-permit path — use judgment on the two early-return `503` cases, where
   `gatewayAud`/`wrongAud` may be partially unavailable). This is exposing already-real,
   already-computed values as structured data — not adding new attack logic and not fabricating
   anything.
3. Zero changes to the actual attack mechanics (`_runWrongAud`'s token exchange / gateway call
   logic is untouched) — this fix only reuses existing real logic and exposes existing real data.

## Out of scope

- The other 4 attack types from the "tried vs allowed" audit (wrong-scope, confused-deputy,
  HITL-replay, cross-vertical-deny) — separate follow-on work, tracked independently.
- Any change to `_runWrongAud`'s actual token-exchange or gateway-call mechanics.
- The "Use Cases Launcher" page/UI itself (`/use-cases`) — this fix only reuses its backend
  service function, not its own frontend.

## Testing

- Backend: extend `demo_api_server/src/__tests__/attackSimulator.test.js` (existing coverage of
  `runAttackSim('wrong-aud', ...)`) to assert the two new structured fields appear on the
  deny/exchange-failed/unexpected-permit result shapes.
- UI: update/extend whatever test coverage exists for the `test_wrong_audience` action case in
  `AIAgent.js` (search for existing test coverage of this `runAction` case before assuming none
  exists) to assert the new endpoint is called and the outcome message includes both audience
  values.
