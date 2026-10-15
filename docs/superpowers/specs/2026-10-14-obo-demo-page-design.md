# OBO demo page: on-behalf-of delegation, standalone and live from Claude

Date: 2026-10-14. Status: draft for review. Branch: `feat/obo-demo-page`.

## Purpose

Let an SE demo, inside the app and on either `local.ping-devops.com:4000` or the hosted SE site, that
an AI agent acts **on behalf of** the signed-in user (RFC 8693 delegation, not impersonation) and that
the model never sees a token. Two ways to run it on one page:

1. **Run it yourself:** a button on the page runs the exchange for the signed-in user. No Claude needed.
2. **Live from Claude:** Claude Code connects to an MCP endpoint hosted by the app; each tool call
   appears on the page as it happens.

Success criteria (all must hold):
- S1. The 7 checks proven by `scripts/obo-claude-test/verify.mjs` (PR #1315; the `act`-as-object change is on the unmerged branch `test/obo-act-object`, commit 6881bc200) are produced by the
  app and shown as PASS/FAIL chips: `sub` preserved; `act` is an RFC 8693 object naming the agent;
  delegated token differs from the user token; audience differs; downstream accepts the delegated token;
  downstream refuses the user token; no token in anything returned to the model or the browser.
- S2. Works from a clean machine against the hosted site with only `claude mcp add ...` (command shown on the page).
- S3. A call from Claude Code appears in the page's live panel within 2 seconds, for the same signed-in user only.
- S4. No raw access token is ever sent to the browser, logged, or stored. Only hashes and claims.

Non-goals: human approval (HITL); a gateway doing the exchange so the server never sees the user token
(deferred, "Approach B"); multi-replica live events; new IdP configuration beyond one PingOne resource.

## Known limits (stated on the page)

- The BFF, which is the MCP server here, briefly holds the user token to run the exchange. "The agent"
  means the model. A gateway doing the exchange is a later demo.
- Live events work with one BFF replica only (in-memory channel).

## Proven facts this builds on

From the live test (2026-10-14, demo PingOne env):
- Exchange: subject = user token, actor = client-credentials token of the AI Agent app
  (`PINGONE_AI_AGENT_ACTOR_*`, scope `agent:invoke`), exchanging app = Token Exchanger
  (`PINGONE_TOKEN_EXCHANGER_*`), audience = a dedicated resource, scope `obo:invoke`.
- `act` is emitted as an object only by this resource attribute (SpEL map literal):
  `${{'client_id': #root.context.requestData.actorToken.client_id}}`. A bare `${..client_id}` gives a
  string; JSON text containing `${}` is not evaluated; `#{..}` is emitted literally.
- `sub` is reserved on new resources (added automatically); do not create it.
- Claude Code logs in with the public PKCE app "Claude Code - Banking Gateway" (c8392dc4-..., redirect
  `http://localhost:7465/callback`); PingOne issued it a token with the existing MCP gateway audience even
  though Claude sent `resource=<our MCP url>`. The endpoint therefore accepts that audience (see Open questions).
- PingOne resource creation and granting a scope to an app are permission grants: the bootstrap step does
  them, an agent cannot.

## Architecture

### 1. `oboExchangeService` (new, `demo_api_server/services/`)

`runObo({ subjectToken, source })` returns an **evidence** object and never the raw tokens:

```
{ ts, source: 'page' | 'claude', sub,
  inbound:   { aud, scope, client_id, sha },
  delegated: { aud, scope, sub, act, exp, sha },
  downstream:{ delegated: 200|401, userToken: 200|401 },
  checks:    [{ id, label, pass }]   // the 7 checks, same wording as verify.mjs
  leak: false }
```

Steps: (1) get the AI Agent actor token via the existing client-credentials service
(`agentCCTokenService`); (2) exchange with `oauthService.performTokenExchangeAs(subject, actor,
tokenExchangerId, tokenExchangerSecret, OBO_AUDIENCE, 'obo:invoke')`, **not** the admin-client helper
`performTokenExchangeWithActor`, because the proven path used the Token Exchanger app; (3) call
`GET /api/obo/downstream` twice, once with the delegated token and once with the subject token, to get the
accept/refuse results; (4) build the evidence and scan the *entire serialized evidence* for JWT-shaped
strings (`eyJ...`) and for the raw tokens themselves, setting `leak` and failing the leak check if found.
The scan is the guarantee for S4; tests prove it fires.

Configuration (all via existing config/env patterns): `OBO_AUDIENCE` (default `obo-demo.ping.demo`),
`OBO_SCOPE` (`obo:invoke`).

### 2. Routes (new `demo_api_server/routes/obo.js`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/obo/run` | session (cookie) | Page button. Uses the session's user access token as subject. Returns evidence. |
| `POST /api/obo/mcp` | Bearer (Claude's token) | Minimal MCP JSON-RPC: `initialize`, `tools/list`, `tools/call`, `ping`. One tool `act_on_my_behalf`, no params. Returns a text result built from evidence (claims and status codes only). Publishes evidence to the live channel. |
| `GET /api/obo/mcp/oauth-protected-resource` | none | RFC 9728 metadata so Claude can find PingOne (the `/.well-known/...` form is also served for direct-BFF clients). |
| `GET /api/obo/downstream` | Bearer | Accepts a token only if `aud` = `OBO_AUDIENCE` **and** `act` is an object with `client_id`. Else 401. Verifies signature and expiry against PingOne JWKS. |
| `GET /api/obo/events` | session (cookie) | SSE for the page's live panel; delivers only events whose `sub` equals the signed-in user's. |

`/api/obo/mcp` verifies Claude's token (signature via JWKS, `iss`, `exp`, accepted audiences) and returns
401 with `WWW-Authenticate: Bearer resource_metadata=...` when absent or invalid. This is the same shape
as the proven `server.mjs`.

### 3. Live channel

The existing `mcpFlowSseHub` is keyed to a cookie session (`claimTrace` / `isValidTraceForSession`), and
Claude has no cookie session, so it does not fit directly. Add a small `oboEventHub` in-memory pub/sub
keyed by user `sub`: `publish(sub, evidence)` and `subscribe(sub, res)`, with a short replay buffer (last
5 events) so a page opened after the call still shows it. Reuse the hub's SSE write/heartbeat helpers if
they are separable; otherwise copy the ~20 lines (decided during the plan, not here). Single process by
design (see Known limits).

### 4. Page `/obo-demo` (new `demo_api_ui/src/pages/OboDemoPage.jsx`)

Follows `PrivilegeA2aPage.jsx` conventions and THEMING.md (theme tokens, no inline colour/font-size,
10px floor, emoji allowlist). Signed-in users only.
- **Run it yourself:** button -> `POST /api/obo/run` -> renders evidence.
- **Live from Claude:** shows the exact `claude mcp add ...` command for the current origin (localhost or
  hosted) and the client id; subscribes to `/api/obo/events`; renders each event as it arrives.
- One shared `OboEvidence` component renders both: user token on the left, delegated token on the right,
  with `sub`, the `act` object, `aud`, `scope` highlighted, and the 7 check chips. Limits are listed in a
  short footnote.
- A ReactFlow diagram of the token swap (per the repo rule that diagrams are ReactFlow, not mermaid) and
  a Learning Hub entry ship in the same change, because the demo, diagram and Learning Hub are one synced
  set.

### 5. PingOne bootstrap

Add to `pingoneProvisionService` an idempotent step "OBO Demo resource": create the resource server
(audience `obo-demo.ping.demo`), scope `obo:invoke`, the `act` attribute above, and grant the scope to
the Token Exchanger app. It must tolerate re-runs (find by name; update the attribute value). A bootstrap
failure here must not abort the rest of bootstrap (log a warning step, as the `mayAct-schema` step does).

### 6. New-route checklist (from this repo's notes)

`/obo-demo` needs: an entry in `demo_api_server/config/auth-requirements.json`; the oauth-bypass ingress
rule for the **unauthenticated** MCP discovery and 401-challenge paths on the hosted site; and the
Playwright `storageState` seed. The hosted wall already lets Bearer-bearing requests through to token
validation; the metadata path and the initial no-Bearer request (which must return the 401 challenge, not
the wall's own response) need explicit bypass entries. These are verified in the probe (rollout step 1).

## Error handling

- Exchange fails at PingOne (400/401): return evidence-less error with PingOne's `error_description` and
  correlation ID only; page shows it; MCP tool returns `isError: true` with the same text. No token in errors.
- Missing config (no Token Exchanger or Agent secrets): `/api/obo/run` returns 503 "OBO demo not configured",
  page shows a setup hint. The rest of the app is unaffected.
- Leak detected: result replaced with "withheld", event published with `leak: true`, chip fails visibly.

## Testing

- Jest, `oboExchangeService`: mocked token endpoint; success evidence has all 7 checks passing; missing `act`
  fails check 2; downstream accepting the user token fails check 6; a JWT planted in evidence is detected
  and withheld.
- Jest + supertest, routes: `/api/obo/mcp` 401 with challenge when unauthenticated, tools/list, tools/call
  publishes to the hub; `/api/obo/downstream` accept/refuse matrix; `/api/obo/events` scoped to `sub`.
  Loopback suites need `ALLOW_TEST_NETWORK=1` (repo network guard).
- Vitest: `OboDemoPage` renders both panels, shows the copy command for the current origin, renders chips.
- Live verification (not in CI): run Claude Code against local, then against the hosted site, and confirm S1-S3
  by content, not by status code.

## Rollout

1. **Probe PR (gate):** ship only `/api/obo/mcp` + metadata + `/api/obo/downstream` + bootstrap resource
   (no UI) and prove, on the **hosted** site, that Claude Code can log in and call the tool. If this fails,
   stop and revisit (Approach B) before building any UI.
2. Service, `/api/obo/run`, and the page (viewer half).
3. Live channel and panel, diagram, Learning Hub entry.
Deploy is a focused deploy of the BFF then the frontend, each followed by `kubectl set image` and a
by-content verification, per this repo's deploy notes.

## Open questions (resolve in the plan, with evidence)

- Which audiences must `/api/obo/mcp` accept? Local test saw `mcpgateway.ping.demo` on Claude's token even
  though Claude requested a different `resource`. Confirm on the hosted URL; do not accept `*`.
- Whether `mcpFlowSseHub`'s SSE helpers are cleanly reusable (S3 mechanics only; no behaviour impact).
- Whether `agentCCTokenService` can mint the actor token with scope `agent:invoke` for this audience, or
  needs a new call (the test used a direct client-credentials request).
