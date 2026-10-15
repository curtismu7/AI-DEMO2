# OBO demo: real request/response/token detail per step

Date: 2026-10-15. Status: draft for review (rev 2). Branch: `feat/obo-step-detail`. Owner: this session
(the "OBO page" session confirmed it is not working on these files).

## Purpose

`/obo-demo` is a demo and training page for on-behalf-of delegation. Clicking a trace line today shows a short
summary (hashes, claim counts, status codes). The audience needs to see what really happened: for each hop the
**real** HTTP request and response, the **real tokens** (raw JWT, plus decoded header and full payload), so a
trainer can walk through the RFC 8693 exchange and paste a token into jwt.io.

Decisions from the user:
- **Real, not reconstructed.** Capture the actual request/response of each PingOne call.
- **Show the tokens.** This is a demo and training environment; tokens are shown inline, by default. (An earlier
  draft hid raw tokens behind a Reveal button; the user declined that friction.)
- **Scope:** the in-app **Run** button only. The Claude Code path (the model's tool result, the SSE events,
  the "Live from Claude" card) stays token-free; the demo's claim "the model never sees a token" stays true.

Success criteria:
- S1. Every trace line 1-7 opens a details view with, where the hop has one: the **Request**, the **Response**,
  and for each token involved the **raw token** (copyable) and its **decoded header and payload**.
- S2. The data is captured from the real calls, not rebuilt from config. A failed hop shows PingOne's real error
  response and the partial trace.
- S3. `client_secret` (and any Basic credential) is **never** shown or sent to the browser; it appears masked.
- S4. The Claude path is unchanged in what it exposes: MCP tool result, evidence, SSE events and the live card
  contain no raw token and no wire data (a test asserts it).
- S5. Raw tokens go only to the signed-in user who ran it (cookie session), with `Cache-Control: no-store`, and
  are not logged.

Non-goals: HITL; changing which token is exchanged; wire detail for the Claude path; persistence of runs.

## Where the data comes from (verified in the code)

| Step | Hop | Real source today | Gap |
|---|---|---|---|
| 1 | Session token | `req.session.oauthTokens.accessToken` | decode header/payload |
| 2 | Actor token (client credentials) | `getAgentCCToken` builds a form body, POSTs to PingOne, gets `{access_token, token_type, expires_in, scope, ...}` | raw request/response internal |
| 3 | Token exchange | `oauthService.performTokenExchangeAs` builds body+headers, POSTs, returns only the token string | request + response JSON internal |
| 4 | Delegated token | step 3's token | decode header/payload |
| 5, 6 | Downstream accepts / refuses | `verifyDownstream(token)` called in-process: `{status, acting_for, acted_by}` / `{status, error}` | in-process check, no real HTTP |
| 7 | No token leaked | `hasTokenLeak` on the evidence | wording |

## Design

### 1. Capture the real wire (additive, off by default)

Add an optional `onWire(info)` callback to the two PingOne calls, called after the HTTP response and on the error
path, inside a `try/catch` so a hook can never change the result:
- `oauthService.performTokenExchangeAs(..., exchangeOptions)`: `exchangeOptions.onWire`.
- `agentCCTokenService.getAgentCCToken(req, options)`: `options.onWire`.

`info` = `{ request: { method, url, headers, body }, response: { status, data } }`, real values. With no hook
(every existing caller) behavior is identical. These two files are in the regression-protected area
(REGRESSION_PLAN.md section 1), so this is the only edit to them, it is purely additive, and it must carry tests
proving the no-hook path is unchanged. The implementer must follow `.claude/skills/regression-guard`.

### 2. `oboWire.js` (new, pure): browser-safe hop

`describeHop(info)` returns what the browser may see:
- **Secrets masked, always:** `client_secret`, `Authorization: Basic ...`, any `*_secret` key -> `"***"`.
  (Client secrets are long-lived credentials, unlike minutes-lived access tokens, so they stay masked even in a
  demo; this is the one place the page does not show the real value.)
- **Tokens left real:** `subject_token`, `actor_token`, `access_token` etc. appear as sent/received.
- Output per hop: `{ request:{method,url,headers,body}, response:{status,body} }`.
- Steps 5 and 6 get a labelled synthetic hop: `"in-process check (same logic as GET /api/obo/downstream)"`,
  `Authorization: Bearer <the real token>`; response = the verifier's JSON.
- **Decoded tokens:** `decodeToken(jwt) -> { header, payload }` (no signature check; display only).

### 3. `runObo` and `/run`

- `runObo(...)` gains `capture` (default false). Only `POST /api/obo/run` passes `capture: true`; the MCP route
  and the SSE publish path call it without capture, so no wire data or raw tokens are collected for the Claude
  path (S4).
- With `capture:true`, each step gets `wire` (from `oboWire.describeHop`) and, for token steps, `tokens`
  (`{ raw, header, payload }`): step 1 the user token, step 2 the actor token, steps 3-4 the delegated token
  (and the subject/actor appear in step 3's request body as sent). `evidence` and `checks` are unchanged and
  stay token-free (they feed the Claude path and the leak scan).
- `/run` responds with `Cache-Control: no-store`; no body logging (the existing failure log stays token-free).

### 4. UI (Step details column, additive to the existing page)

For the selected step, below the existing summary and table:
- **Request** and **Response** blocks (monospace, pretty-printed, copy button).
- **Token** blocks: the raw JWT (copy button, wrapped), then **Decoded** header and payload JSON with the key
  claims (`sub`, `act`, `aud`, `scope`, `exp`) emphasised.
- A failed hop: the Response block shows PingOne's real error JSON.
- Page copy corrected to the new reality: remove "Tokens appear only as short hashes and claims" and the lede's
  "never sees either token" (keep "the model never sees them": true for the Claude path). Step 7 is reworded to
  "No token reached the model" and states what was scanned (the MCP result text and the Claude live event).
- No new route, no run store, no Reveal button.

## Security notes

- Raw tokens are access tokens of the signed-in user and of the demo AI Agent app, minutes-to-an-hour lived,
  shown to the signed-in user who ran the exchange. The user accepts this for a demo/training page.
- They are sent over the existing authenticated cookie session, never to the SSE stream, MCP result, logs, or
  other users. On the hosted site the same applies.
- `client_secret` is the exception and stays masked (S3). If the owner wants it shown too, that is a separate
  decision (it is a long-lived credential; recommended: no).

## Error handling

- `onWire` hook errors are swallowed.
- A hop with no capture shows the existing summary only.
- Failed exchange: the step carries PingOne's real error response, and `err.trace` keeps the partial steps
  (existing behavior), now including the wire for the failed hop.

## Testing

- `oboWire`: planted `client_secret` / Basic header / `*_secret` are masked in nested bodies; tokens are
  preserved; `decodeToken` correct and tolerant of malformed input.
- `performTokenExchangeAs` / `getAgentCCToken`: hook receives request/response on success and on error; a throwing
  hook changes nothing; no-hook path identical (existing suites pass unchanged).
- `runObo`: `capture:false` returns no `wire` and no raw token anywhere (S4); `capture:true` returns wire + tokens
  and still never a `client_secret` (property check over the serialized result).
- Routes: `/run` includes wire and tokens, no `client_secret`, `Cache-Control: no-store`; the MCP route and the
  SSE publish still emit token-free evidence (regression test on the existing suites).
- UI (vitest): details render Request/Response/Token/Decoded for each step; copy buttons; failed hop shows the
  PingOne error; existing page tests untouched; no `client_secret` text anywhere in the DOM.
- Live check (person): run it, click all 7 lines, paste the delegated token into jwt.io, compare the `act` claim.

## Open questions (resolve in the plan with evidence)

- Whether `getAgentCCToken` exposes request headers cleanly for the hook, or the hook should receive the body and
  headers it already assembled before sending.
- Whether any caller of the two edited functions passes an `onWire`-named option today (grep; must be none).
