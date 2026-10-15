# OBO demo: full request/response/token detail per step

Date: 2026-10-15. Status: draft for review. Branch: `feat/obo-step-detail`. Owner: this session
(the "OBO page" session confirmed it is not working on these files).

## Purpose

`/obo-demo` is used to demo on-behalf-of delegation. Clicking a trace line today shows a short summary
(hashes, claim counts, status codes). Presenters need the real wire detail so an audience can follow the
RFC 8693 exchange: for each hop the exact HTTP request and response, the decoded token (header and full
payload), and, on demand, the raw token.

Decisions already made by the user:
- **Detail level:** full request/response and decoded tokens by default; **raw tokens only behind a Reveal
  button**, per token. Client secrets are always masked.
- **Scope:** the in-app **Run** button only. The Claude Code path (what the model sees, and the
  "Live from Claude" card) is unchanged and stays token-free.

Success criteria:
- S1. Every trace line 1-7 opens a details view with, where the hop has one: a Request block, a Response
  block, and decoded token JSON (header + payload) for each token involved.
- S2. The default `/run` response, the page DOM before any click, and every log line contain **no raw
  token and no client secret**. A raw token reaches the browser only after the user clicks Reveal on it.
- S3. Reveal is limited to the user who ran it (same `sub`), for a short time, and fails closed
  (unknown/expired/other user -> 404).
- S4. The Claude path (MCP tool result, SSE events, evidence) is byte-for-byte unchanged in what it exposes.
- S5. A failed hop shows PingOne's real error response (it contains no token) and the partial trace.

Non-goals: HITL; changing which token gets exchanged; showing detail for the Claude path; persisting runs
beyond the in-memory TTL; multi-replica reveal (single BFF replica, as the page already states).

## Where the data comes from (verified in the code)

| Step | Hop | Real source today | What is missing |
|---|---|---|---|
| 1 | Session token | `req.session.oauthTokens.accessToken` (server-held) | decoded header/payload (derivable) |
| 2 | Actor token (client credentials) | `getAgentCCToken` builds a form body and POSTs to the PingOne token endpoint, returns `{access_token, token_type, expires_in, scope, claims}` | the raw request/response are internal |
| 3 | Token exchange | `oauthService.performTokenExchangeAs` builds the body + headers, POSTs, returns only the access token string | request + response JSON are internal |
| 4 | Delegated token | decoded from step 3's token | decoded header/payload |
| 5, 6 | Downstream accepts / refuses | `verifyDownstream(token)` called in-process, returns `{status, acting_for, acted_by}` or `{status, error}` | presented as an in-process check, not a network call |
| 7 | No token leaked | `hasTokenLeak` on the evidence | wording (see UI) |

## Design

### 1. Capture the real wire (additive, off by default)

Add an optional `onWire(info)` callback to the two PingOne calls, invoked after the HTTP response (and on
the error path) inside a `try/catch` so a hook can never change the call's result:
- `oauthService.performTokenExchangeAs(..., exchangeOptions)`: `exchangeOptions.onWire`.
- `agentCCTokenService.getAgentCCToken(req, options)`: `options.onWire`.

`info` = `{ request: { method, url, headers, body }, response: { status, data } }` with the real values,
including secrets and tokens. **The hook receives raw data; only `oboWire` (below) decides what leaves the
BFF.** With no hook (every existing caller), behavior is identical: this is the only edit to those
regression-protected files and it must carry its own tests proving the no-hook path is unchanged.

### 2. `oboWire.js` (new, pure): redact, mark, decode

`describeHop(info, tokens)` turns raw `info` into a browser-safe hop:
- **Secrets masked, always:** `client_secret`, any `Authorization: Basic ...` credential, any `*_secret`
  key -> `"***"`.
- **Tokens replaced by markers:** any string value equal to a known token (user, actor, delegated) is
  replaced by the ASCII marker `<token:user>`, `<token:actor>`, `<token:delegated>`. Any other JWT-shaped
  string left in the hop is replaced by `<token:unknown>` (belt and braces). Marker text is what the page
  shows by default.
- **Decoded tokens:** `decoded: { user, actor, delegated }`, each `{ header, payload }` from the token
  (claims, not secrets; same data the page already shows partially).
- Result shape per step: `wire: { request:{method,url,headers,body}, response:{status,body} }`, and
  `decoded` on the steps that involve tokens (1, 2, 3/4).
- Steps 5 and 6 get a synthetic, clearly labelled hop (`"in-process check, same logic as GET /api/obo/downstream"`,
  `Authorization: Bearer <token:delegated>` or `<token:user>`; response = the verifier's JSON).

### 3. Run store and Reveal route

`oboRunStore` (in-memory): `put(sub, tokens) -> runId`, `get(runId, sub) -> tokens|null`.
- TTL 10 minutes; at most 20 runs total, oldest evicted; expired entries purged on every access.
- Keyed by `runId` (random 128-bit, URL-safe) AND checked against the requesting session's `sub`.
- `POST /api/obo/run` (existing) now also returns `runId` and, per step, `wire`/`decoded`. It never returns
  a raw token. The existing `evidence` and `checks` fields are unchanged.
- `GET /api/obo/run/:runId/tokens` (new, cookie-session, same `sessionSub` helper as `/events`) returns
  `{ user, actor, delegated }` raw, `Cache-Control: no-store`, or 404 for unknown/expired/other-user runs.
  No logging of the response body. Not mounted on the hosted-wall bypass list (cookie session only).

### 4. Capture only for the page

`runObo(...)` gains an options flag `capture` (default false). Only `POST /run` passes `capture: true`.
The MCP route and the SSE event path call it without capture, so no wire data and no raw tokens are ever
collected, stored, or published for the Claude path (S4). When `capture` is true, `runObo` returns the
raw tokens to its caller (`/run`) out-of-band (not inside `steps`), and `/run` stores them in `oboRunStore`.

### 5. UI (Step details column, additive to the existing page)

For the selected step, below the existing summary and table, render:
- **Request** and **Response** blocks (monospace, pretty-printed JSON/form, copy button), showing markers
  such as `<token:delegated>` in place of tokens.
- **Decoded** blocks: header and payload JSON for each token in the step, with the key claims (`sub`,
  `act`, `aud`, `scope`, `exp`) visually emphasised.
- A **Reveal** button per token. First click fetches `GET /api/obo/run/:runId/tokens` once, caches it in
  component state only (never localStorage), and swaps the marker for the raw token in the blocks; a
  second click hides it again. A 404 shows "This run has expired. Run it again to reveal tokens."
- Failed hop: the Response block shows PingOne's real error JSON.
- Page copy updated to match reality: remove "Tokens appear only as short hashes and claims" and the
  lede's claim that no token reaches the page; say "Tokens are hidden until you click Reveal; the model
  never receives them." Step 7 is reworded to "No token reached the model" and explains what was scanned
  (the MCP result text and the Claude live event), because the page itself can now show tokens on request.

## Security notes

- Tokens are user/agent access tokens, short-lived (minutes). Revealing exposes the signed-in user's own
  token and the demo agent's token to that user's browser. This is a demo-page feature for the owner of the
  session and is why Reveal is explicit, per token, same-sub, and time-limited.
- Hosted site: the same rules hold behind the hosted wall. The run store makes raw tokens leave the BFF only
  on an explicit authenticated GET.
- Secrets (`client_secret`) never leave the BFF in any form; `oboWire` tests prove masking with planted values.

## Error handling

- `onWire` hook errors are swallowed (never change the exchange).
- Hop with no capture (hook not reached): the step simply has no `wire`; the page shows the existing summary.
- Reveal after expiry/restart: 404 with a plain message; the page keeps working.
- `oboRunStore` full: oldest run evicted; revealing an evicted run 404s.

## Testing

- `oboWire`: planted `client_secret`, Basic header, user/actor/delegated tokens and an unknown JWT are all
  masked/marked; decoded header/payload correct; nothing JWT-shaped survives in the browser-safe hop (property
  test over the output string).
- `oboRunStore`: TTL, eviction, same-sub check, random ids.
- `performTokenExchangeAs` / `getAgentCCToken`: hook receives the request/response on success and error;
  a throwing hook does not change the result; **no-hook path identical** (existing suites must pass unchanged).
- `runObo`: with `capture:false` produces no wire and no raw token anywhere in the return value (S4); with
  `capture:true` returns raw tokens only out-of-band.
- Routes: `/run` response contains no JWT-shaped string and no `client_secret`; `/run/:id/tokens` 200 for the
  same session, 404 for another sub, expired, unknown; no body in logs (spy on console).
- UI (vitest): details render Request/Response/Decoded; default DOM has no `eyJ`; Reveal fetches once and
  shows the token; hide again; 404 message; failed hop shows PingOne error; existing page tests untouched.
- Live check (person): run it, click through all 7 lines, Reveal each token and paste one into jwt.io,
  confirm a second signed-in user cannot reveal your run.

## Open questions (resolve in the plan with evidence)

- The exact URL/headers PingOne receives for the exchange (`Authorization` vs form `client_secret`; the
  Token Exchanger is `CLIENT_SECRET_POST`): capture shows the truth, so the UI never invents it.
- Whether `agentCCTokenService`'s axios call exposes request headers cleanly for the hook, or the hook should
  receive the request it already assembled (`body`, `headers`) before sending.
- Whether to show `expires_in`/`issued_token_type` from the exchange response verbatim (yes, from capture).
