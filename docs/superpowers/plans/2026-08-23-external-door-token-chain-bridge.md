# External-door → Token Chain movie reel bridge — design (not yet built)

> Scoping doc for a fresh session to pick up. No code changes from this doc.
> Companion doc: `2026-08-23-external-door-multi-vertical-tools.md` (separate,
> unrelated scope — don't conflate the two).

## 2026-08-24 follow-up — investigated live, fixed two real bugs, found the actual blocker

A follow-up session picked this up and tried to run the "suggested first
step" below as a live test via LM Studio. It never got a clean pass, but not
because the movie-reel bridge design was wrong — three *other*, unrelated
live bugs were in the way, two of which are now fixed and deployed. Read
this section first; it changes several of the original doc's assumptions.

**TL;DR outcome:**

- The movie-reel bridge itself (§ "What already exists to build on" /
  "What's missing", items 1-4 below) turned out to need **no new code at
  all** — see "Correction: the BFF-bridge design (items 1-4) isn't needed"
  below. That part of this doc is effectively answered, not just scoped.
- Getting a *successful* external-door tool call to happen at all — the
  prerequisite for there being anything real to bridge — hit three
  unrelated live bugs. Two are fixed and deployed (PRs open, not yet
  merged). The third is a client-side LM Studio behavior this repo can't
  fix, and it's what's actually blocking end-to-end proof tonight.

### Bug 1 (fixed, deployed, PR open): gateway event-loop self-deadlock

`ping-gateway/scripts/groovy/external-door-tools-filter.groovy` called the
blocking `rsp.entity.string` getter synchronously inside `.thenOnResult`,
which runs on the Vert.x event-loop thread — confirmed via a live `jstack`
thread dump (`PromiseImpl.await -> Object.wait`, blocked 198s+ and
climbing). `nginx.ingress.kubernetes.io/proxy-buffering: "off"` on the
external-door ingress plus the large (~18K-token) unfiltered `tools/list`
response means the body isn't fully buffered when the callback fires, so
every `tools/list` call through the external door deadlocked the gateway —
deterministic, not a fluke, and it took the *whole* gateway down for every
route (nginx returned bare 503s cluster-wide for that ingress) each time it
fired. Fixed by switching to `entity.getStringAsync()` + `thenAsync`, off
the event loop. **PR #2292** (open), deployed live to the SE cluster and
verified via direct curl (`tools/list` returns 9 correctly-filtered tools in
~0.76s, no `Thread blocked` warning).

### Bug 2 (fixed, deployed — no new PR needed, already-merged code was just never shipped)

`oauth-mcp/src/tools/TokenResolver.ts`'s `isSelfIssuedToken` guard (PR
`c992fa4f4`, already on `main`) skips Step 9 for a self-issued (embedded-AS)
token instead of presenting it to PingOne's real token-exchange endpoint —
which always rejected it with `Cannot parse token claims for request param
'subject_token'`. That fix was merged to `main` but the running `mcp-server`
image on the SE cluster predated it (confirmed by `grep`-ing the container's
compiled `dist/` for `isSelfIssuedToken` — zero matches). Rebuilt + pushed +
redeployed just the `mcp-server` image from current `main`; confirmed live
(same `tools/call get_my_accounts` now returns `Banking API error:
invalid_token` instead of the parse-error crash — progress, not yet a full
fix, see Bug 3).

**Lesson for next time:** when a live symptom matches a bug whose fix
description sounds exactly right, check whether the fix is actually
*deployed* (`grep` the running container's `dist/`, or compare the pod's
image digest / start time against the fix commit's date) before assuming
it's a design gap. Two separate bugs tonight (this one and the gateway one)
turned out to be "already fixed on `main`, never shipped" rather than
needing new code — a `kubectl rollout restart` and a scoped image rebuild
solved them, not new design work.

### Bug 3 (fixed, deployed, PR open) — but doesn't help LM Studio; see the real blocker below

Skipping Step 9 (Bug 2) meant the raw self-issued embedded-AS JWT got
forwarded straight to the Banking API instead, which also rejects it
(`invalid_token`) — confirmed live before writing this fix. Root cause:
`OAuthRouter.handleAuthorizeCallback` obtains and JWT-verifies a genuine
PingOne access token during the external door's `authorization_code`
federation (real browser login), pulls the PingOne `sub` out of it for the
issued session token's subject — then **discards the PingOne token itself**.
Only the re-signed embedded-AS JWT survives into the session, so nothing
downstream ever has a token PingOne (or the Banking API) actually
recognizes.

Fix: thread that real PingOne access token through
`TokenStore.AuthorizationCode` → `TokenIssuer.issueAuthorizationCode` →
`TokenStore.IssuedToken` (new optional field, keyed by `jti`).
`TokenResolver`'s self-issued branch now looks it up via the agentToken's
`jti` before falling back to plain passthrough, and uses it for Step 9 when
present and unexpired. `client_credentials` tokens never get one (no real
user to federate) — unchanged, still correctly falls through to the old
passthrough behavior, covered by both an existing and two new regression
tests. **PR #2295** (open): `oauth-mcp` unit 1070/1070, integration 93/93,
both green; deployed live to the SE cluster; confirmed no regression for
`client_credentials` (still gets `invalid_token`, as designed).

### The actual blocker tonight: LM Studio never uses its `authorization_code` token for the live MCP session

This is the one open item worth reading carefully before picking this back
up. Across **two independent LM Studio sessions** tonight (different
DCR-registered `client_id`s each time — `85abea5b-...` and
`1aee74ae-...`/`2bad8691-...`), the pattern was identical:

1. LM Studio shows a real PingOne login page (or silently SSOs through an
   existing PingOne session — both observed).
2. oauth-mcp's `handleAuthorizeCallback` genuinely completes: real PingOne
   token obtained, signature-verified, `sub` extracted. The
   `Authentication Successful` page is not fake.
3. **But the bearer token LM Studio actually sends with live `tools/call`
   requests has `sub == client_id`** (confirmed via the gateway's P1AZ audit
   log, `ClientId` and `UserId` fields identical) — the unmistakable
   signature of a `client_credentials`-issued token, per
   `TokenIssuer.issueClientCredentials`'s `.setSubject(client.client_id)`.
   The `authorization_code` grant's real-`sub` token (Bug 3's fix target)
   is never the one used for the session's actual tool calls.

So Bug 3's fix is real, tested, and deployed — but it can't be proven
end-to-end through LM Studio, because LM Studio's live session token
structurally never qualifies for the branch that fix added. This is an LM
Studio client-side implementation choice (which grant it picks for the
actual MCP connection, independent of what login ceremony it shows the
user), not something fixable in this repo.

**Next step, if this is picked back up:** re-run the same live test through
a client that *does* carry its `authorization_code` token into the live
session — the MCP Inspector is already a registered demo client
(`mcp-inspector`, `authorization_code` only, in
`oauth-mcp/src/oauth/ClientRegistry.ts`'s defaults) and would be the
fastest way to prove Bug 3's fix actually closes the loop, or Claude
Desktop if it behaves differently from LM Studio here. Until then, Bug 3 is
"correct by code review and unit/integration tests, deployed, not yet
proven live."

### Correction: the BFF-bridge design (items 1-4 below) isn't needed

The original "What's missing / needs investigation" section (items 1-4)
proposed a new BFF endpoint, a new groovy push step, and event-shape
mapping to get external-door tool calls into the movie reel. Investigation
this session found that mechanism **already exists and needs no new code**:

- `demo_api_server/services/tokenChainService.js`'s `getMCPToolCalls(userId,
  req)` already fetches `GET /audit?eventType=token_chain` from the *same*
  `mcp-server` pod (confirmed via `k8s/30-mcp-server-deployment.yaml` /
  `k8s/aws/se-ingress.yaml` — external door and internal MCP traffic hit the
  literal same Deployment/Service, just different ingress hosts) and filters
  for `event.details.userToken.sub === userId`.
- `oauth-mcp/src/tools/TokenChainAuditor.ts` logs **every** tool execution
  to that same audit store, entry-point-agnostic — external-door calls go
  through the identical `BankingToolProvider` dispatch path as internal
  ones.
- `demo_api_server/middleware/auth.js:913` sets `req.user.id = decoded.sub`
  — literally the PingOne `sub`.

So: any browser logged into Personal Agent Studio as PingOne user X, on its
next 15s poll of `/api/token-chain` (not SSE — see correction below), would
already see an external-door tool call by that same user X, with zero new
BFF/gateway code. **This was never empirically proven live** (blocked by
Bugs 1-3, then by the LM Studio client-token issue above) — the code-level
mechanism is confirmed, the live end-to-end proof still isn't.

Also corrects the original doc's "suggested first step": the movie reel is
**polling** (`TokenChainContext.js`, `GET /api/token-chain`, ~15s interval,
`credentials: "include"`), not SSE — the "SSE" mentioned in the original
doc is a different thing (the demo agent's own per-turn chat streaming, an
unrelated mechanism in the same file).

## Context

This session built and verified, end-to-end and live, an "external door" MCP
integration: real external agents (LM Studio, Claude Desktop, ...)
self-register via DCR against `ping-gateway`'s `00-mcp-external-door.json`
route and call the banking MCP server (`mcp-server:8080`) directly, entirely
bypassing the BFF (`demo_api_server`). Confirmed working with a real LM
Studio session (tool discovery, `PERMIT` from real PingOne Authorize, actual
tool calls).

**Gap**: the demo's "movie reel" (`TokenChainFilmstrip`, on Personal Agent
Studio at `/personal-agent`) shows nothing about this traffic. It's fed
entirely by `demo_api_server`'s own event pipeline
(`TokenChainContext.js` → `tokenChainTraceStore`), which only the BFF ever
writes to. External-door calls never touch the BFF, so there's no event to
show.

## The core open question: whose reel?

Two different OAuth grants happen on the external door, and only one of them
has an answer to "whose token chain is this":

- **`client_credentials`** (used by this session's scripted verification
  curls) — token `sub` is the DCR client's own randomly-generated UUID. No
  link to a PingOne user, no link to a browser session. Nothing to attach the
  event to.
- **`authorization_code`** (what LM Studio's real flow does — the actual
  PingOne login popup) — token `sub` **is** a real PingOne user id. This is
  the one worth bridging: it can plausibly map to "whoever is currently
  logged into Personal Agent Studio in their browser," which is the entire
  premise of the demo's "personal agent acting on your behalf" narrative.

**Decide this first** before building anything: is "PingOne user id from the
external token" → "any of that user's active BFF sessions" the intended
model? (Almost certainly yes, but confirm — it's the one architectural
assumption everything below depends on.)

## What already exists to build on

- `ping-gateway/scripts/groovy/p1az-decision.groovy` already builds a rich
  `auditTrail` object per request — `introspection` (sub, scope, client_id,
  iss), `authorize` (decision, url, parameters incl. `TokenIss`,
  `TokenAudActual`, tool, method), `mcpAudit` (who/what/when/where/how),
  `filterChain`. Today this is **only** exposed as the `X-Gw-Audit-Trail`
  response header — nothing consumes it. This is 90% of the payload a bridge
  would need; no new data collection required, just a new destination for
  data already being built.
- `McpAuditFilter` (used on every MCP route) already writes structured events
  to `audit/mcp.audit.json` on the gateway pod — a second, file-based copy of
  similar data, in case the response-header route turns out to be the wrong
  integration point.
- `BFF_INTERNAL_SECRET` is already shared across BFF + gateway + agent +
  langchain + ping-gateway + mcp-resource-server (see
  `k8s/create-secrets.sh` / `se-update-config.sh` output: "BFF_INTERNAL_SECRET
  aligned across...") — the trust mechanism for a gateway→BFF push already
  exists, no new secret needed.
- `demo_api_ui/src/context/TokenChainContext.js` — `ingestTokenEvents`/
  `ingestTokenEvent` is the client-side entry point the movie reel already
  consumes. A new server-side event source just needs to reach whatever
  feeds this (SSE stream / polling — check which one `TokenChainContext.js`
  actually uses before designing the push mechanism).

## What's missing / needs investigation

1. **Session lookup by PingOne user id.** Sessions are normally found by
   cookie (`req.session`). Is there already a way to look up "all active BFF
   sessions for PingOne user X"? If not, this is the biggest unknown —
   whether it's a quick LMDB scan or needs new indexing determines how big
   this task really is. Check `demo_api_server`'s session store
   implementation (`express-session` + `connect-redis` per the BFF's
   `CLAUDE.md`) before estimating further.
2. **A new BFF endpoint** (e.g. `POST /api/token-chain/external-event`) that:
   - Authenticates the caller via `BFF_INTERNAL_SECRET` (mirror whatever
     existing internal-service-to-BFF endpoints already do for this — there
     should be a precedent elsewhere in `demo_api_server/routes/`).
   - Accepts the gateway's audit-trail-shaped payload.
   - Resolves PingOne `sub` → session(s) (item 1).
   - Pushes into `tokenChainTraceStore`-equivalent server-side state for each
     matching session, using whatever mechanism already delivers BFF-internal
     events to the browser (SSE push, most likely).
3. **A new groovy step** on `00-mcp-external-door.json`'s chain (after
   `P1AZDecision`, alongside where `external-door-tools-filter.groovy`
   already runs) that POSTs the audit trail to the new BFF endpoint. Should
   be fire-and-forget / best-effort — a failure to push a UI event must never
   affect the actual MCP response to the external agent.
4. **Event shape mapping** — the existing `buildTokenEvent(...)` helper
   (`demo_api_server/services/agentMcpTokenService.js`) is what internal flows
   use to shape events for the store. The new endpoint likely needs to
   produce events in that same shape from the gateway's differently-shaped
   audit trail, so `TokenChainFilmstrip`/`StepDetailPanel` render it without
   UI changes.

## Suggested first step (when picked back up)

Before writing any code: trace `TokenChainContext.js` to confirm exactly
*how* an event reaches a browser today (SSE endpoint name, or polling
interval) — that answer plus the session-lookup-by-PingOne-user question
(open item 1) together determine whether this is a half-day task or needs
its own bigger design pass.

## Related work from this session (for context, all merged + deployed live)

- `00-mcp-external-door.json` — the external-door route itself.
- `external-door-401-metadata.groovy` — RFC 9728 `resource_metadata` on 401s.
- `p1az-decision.groovy` — D-05 exemption (`IsExternalDoorIssuer`) +
  `external-door-tools-filter.groovy` — curated 9-tool `tools/list` for
  external clients (banking only; see the companion multi-vertical doc).
- `p1az-import.snapshot` — live PingOne Authorize policy: `HasValidMcpAudience`
  (+`mcpserver.ping.demo`), actor-chain rule gated on `ActChainDepth > 0`,
  `TokenAudTargetsUpstream` exempted via new `IsExternalDoorIssuer` condition.
- Verified live end-to-end with a real LM Studio session: DCR → OAuth →
  `tools/list` (9 tools) → real PingOne Authorize `PERMIT` → tool call.

**2026-08-24 follow-up session — PRs open, not yet merged (deployed live to
the SE cluster directly, ahead of merge):**

- **#2292** — `external-door-tools-filter.groovy` event-loop deadlock fix.
- **#2295** — Step 9 federated-token propagation (`TokenStore` /
  `TokenIssuer` / `OAuthRouter` / `TokenResolver` / `BankingToolProvider`).
- Both need merging soon — the live cluster is currently running ahead of
  `main` for these two files, and a `create-secrets.sh` re-run or a routine
  main-checkout sync could silently revert the gateway groovy fix (it's a
  ConfigMap, not a build) if #2292 isn't merged first.
