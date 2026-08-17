# Tech Debt

Known gaps and architectural smells found while fixing something else —
correct enough to ship, not worth blocking the fix that found them. Not a bug
log (`REGRESSION_PLAN.md` §4 is that); this is "should fix properly later."

Reverse-chronological, newest first. Each entry: what's wrong, why it wasn't
fixed now, what the real fix looks like.

### 2026-08-17 — `davinciFlowClient._getApiToken()` is a placeholder, not a real token fetch

**Where:** `demo_api_server/services/davinciFlowClient.js` (`_getApiToken()`).

**What's wrong:** returns `` `${apiClientId}:${apiClientSecret}` `` and sends it
as a `Bearer` token to PingOne's orchestrate API. PingOne expects a real OAuth
access token (client_credentials grant) or `Basic base64(id:secret)` at the
token endpoint itself — a raw colon-joined pair as a bearer token will 401
against a live environment. Every consumer of `invokeFlow()` currently runs
against mocked HTTP in tests, so this has never been exercised live.

**Why not fixed now:** scoped out of the plan's Task 3 (`docs/superpowers/plans/2026-08-17-davinci-orchestration-showcase.md`)
on purpose — building a full client_credentials grant + token cache wasn't
needed to land the mockable client shape, and DaVinci console setup (that
plan's Task 1) hasn't happened yet, so there's no live environment to test
against regardless.

**Real fix:** implement a real client_credentials token fetch (mirror
`services/mfaService.js`'s `_getWorkerToken()` pattern) with expiry-aware
caching, before this client is ever pointed at a live PingOne environment.

### 2026-08-16 — `MCP_SERVER_RESOURCE_URI` means two different things across services

**Where:** `demo_api_server/scripts/refresh-service-envs.js` (shared default
`'mcpserver.ping.demo,mcpgateway.ping.demo'` fanned out to every service env),
`demo_mcp_resource_server/src/index.ts` / `src/server/acceptedAudiences.ts`.

**What's wrong:** everywhere else `MCP_SERVER_RESOURCE_URI` is "the banking MCP
server's accepted-audience list", but inside demo_mcp_resource_server it means
"THIS server's accepted list". Only a per-service override in the env writer
keeps the invest server from inheriting the banking value; a container created
before the override (or a K8s pod on the shared configmap) rejected every
gateway exchange-#3 token with `Audience mismatch: got [mcp-invest.ping.demo]`.
Patched defensively: `resolveAcceptedAudiences()` now always unions the
server's own canonical audience, so a stale env can no longer break tool calls
— but the name collision remains.

**Why not fixed now:** renaming the env var touches compose, K8s manifests,
refresh-service-envs, and docs in one sweep — out of scope for the audience
fix.

**Real fix:** give the invest server its own env name (e.g.
`MCP_RESOURCE_SERVER_RESOURCE_URI`), source it from
`scope-topology.json resources["Super Banking MCP Invest"].uri`, and extend
`npm run topology:verify` to diff every surface that sets it (compose, K8s,
env writer) against the topology.

### 2026-08-16 — Node MCP Gateway's HITL retry path never consumes the receipt

**Where:** `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (~L611-654,
the `_hitl_challenge_id` retry branch) and `demo_mcp_gateway/src/hitlClient.ts`
(`getHitlChallengeStatus` + `verifyHitlReceipt`).

**What's wrong:** BUGS.md #35 fixed HITL receipt replay by having
`demo_hitl_service`'s `POST /challenges/:id/verify` transition the challenge
to a terminal `consumed` status on its first successful call
(`demo_hitl_service/src/routes/challenges.js`, `store.consume()` in
`demo_hitl_service/src/store/challengeStore.js`). That closes the replay gap
for `ping-gateway/scripts/groovy/p1az-decision.groovy`, the only caller of
`/verify`. The Node MCP Gateway (`demo_mcp_gateway`) never calls `/verify` —
it calls `GET /challenges/:id` and re-implements the same binding checks
locally in `hitlClient.ts#verifyHitlReceipt`, with no call that mutates
challenge state. So a replayed retry against the same `_hitl_challenge_id`
through the Node gateway still succeeds every time until the 10-minute TTL,
identical to the bug BUGS.md #35 describes. Per `ping-gateway/README.md:32-34`,
`ff_mcp_gateway_pinggateway` **OFF (the default)** routes MCP traffic through
this unfixed Node gateway path — the fixed PingGateway/Groovy path is opt-in.

**Why not fixed now:** the task scoped the fix to `demo_hitl_service` only
(minimum diff, don't touch the two consumer services). Closing this gap
requires either (a) adding a consuming call from `hitlClient.ts` at its one
use site and a way for `demo_hitl_service`'s `GET /challenges/:id` to
distinguish that consuming read from the read-only polling done by
`demo_api_server/services/hitlServiceClient.js` (BFF dashboard) and
`demo_authz_server/routes/decision.js` (own PDP flow) — both of which also
call plain `GET /challenges/:id` and must not be treated as consuming — or
(b) a new dedicated consuming endpoint the Node gateway calls instead of GET.
Either touches 2-3 more services and needs its own regression pass; out of
scope for a targeted HITL-service fix in a protected area.

**Real fix:** give the Node gateway path a consuming step equivalent to
`/verify`'s, without breaking the other `GET /challenges/:id` pollers — e.g.
a `?consume=true` flag (or dedicated `POST /challenges/:id/consume`) that
only `hitlClient.ts`'s retry-time call sends, verified against a test that
replays the Node gateway's retry twice and asserts the second is rejected.

### 2026-08-15 — mastra_agent: `req.on('close')` fires before the client actually disconnects

**Where:** `mastra_agent/src/runHandler.ts` — `req.on('close', () => abortController.abort())`.

**What's wrong:** Node's `IncomingMessage` is a Readable stream with
`autoDestroy` on, so it emits `'close'` once its own body has been fully
read — not when the underlying connection/client actually goes away. For a
small JSON POST body (this endpoint's whole payload), that happens almost
immediately after Express's body parser finishes, often before
`agent.stream()` even starts consuming `fullStream`. Confirmed live:
instrumenting the handler showed `abortController.signal.aborted` already
`true` by the time the `for await` loop began, in every request. Effect:
`tests/runHandler.test.ts`'s three streaming-event assertions (`RUN_FINISHED`,
`TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`/`END`) fail — the loop `break`s on
its first `abortController.signal.aborted` check before processing any part,
so `onRunEnd()` falls back to the "model didn't return a usable response"
error path. Reproduced identically on an unmodified `main` checkout (no code
change involved) via `cd mastra_agent && npx jest tests/runHandler.test.ts`,
so it predates and is unrelated to any recent change in this file.

**Why not fixed now:** found while fixing the missing `'tool-error'` branch
in the same file (BUGS.md #14) — a distinct, unrelated code path. The real
fix (switching the disconnect signal from `req` to `res`) touches request
lifecycle handling for every run, which is out of scope for a targeted
tool-error fix and risks the exact abort/stream-teardown behavior this repo
is careful about.

**Real fix:** listen on `res.on('close')` (or `res.on('finish')` paired with
a separate disconnect check) instead of `req.on('close')` — the response
stays open for the SSE duration, so its `'close'` reflects the actual
client/connection state rather than "the request body has been read." Needs
a scoped repro against a real (non-supertest) client to confirm the new
listener still aborts on a genuine client disconnect before landing.

### 2026-08-12 — oauth-mcp encrypted-storage CBC mode has no integrity check

**Where:** `oauth-mcp/src/utils/encryption.ts` — uses `aes-256-cbc`.

**What's wrong:** CBC is unauthenticated. Decrypting with the wrong key
doesn't reliably fail — it produces garbage that happens to pass PKCS#7
padding validation roughly 1 run in 256, so `decipher.final()` succeeds and
returns corrupted plaintext instead of throwing. Surfaced as an
intermittent failure in `tests/utils/encryption.test.ts` ("should fail to
decrypt with wrong password") while reviewing an unrelated branch —
untouched by that branch's actual changes.

**Why not fixed now:** found while verifying oauth-mcp's DCR work
(`docs/superpowers/plans/2026-08-12-oauth-mcp-dcr.md`), which never touches
this file. A migration to an authenticated mode changes the on-disk/at-rest
ciphertext format, which is a real migration concern (existing encrypted
data, if any persists across restarts) — bigger than a drive-by fix
belongs in.

**Real fix:** migrate to `aes-256-gcm` (or another AEAD mode), which
fails deterministically — and cryptographically meaningfully — on a wrong
key/tampered ciphertext instead of a ~1-in-256 chance of silent corruption.
Needs a decision on migrating already-encrypted data vs. accepting a
one-time invalidation.

### 2026-08-12 — oauth-mcp DCR: two follow-ups from the final review

**Where:** `oauth-mcp/src/oauth/OAuthRouter.ts`, `oauth-mcp/src/oauth/TokenIssuer.ts`.

**What's wrong:**
1. `resolveOwnAudience()` (`TokenIssuer.ts`) takes the first entry of
   `MCP_SERVER_RESOURCE_URI` positionally to decide this AS's own audience.
   Every other resolver answering "what is MY resource URI" in this service
   (`lastHopAuthorization.ts`, `JwtClaimVerifier.ts`) instead prefers a
   dedicated `PINGONE_RESOURCE_MCP_SERVER_URI`-shaped var first, specifically
   so a stale/reordered `MCP_SERVER_RESOURCE_URI` can't silently shadow the
   real audience. Correct in every shipped config today (`mcpserver.ping.demo`
   is always first in `docker-compose.yml`/`k8s/02-configmap.yaml`), but the
   positional dependency is fragile if that list is ever reordered.
2. `POST /register`'s new `DCR_INITIAL_ACCESS_TOKEN` gate (added closing a
   Critical finding — unauthenticated DCR with unbounded scope) isn't wired
   into any deployment yet: not in `docker-compose.yml`'s `environment:`
   block, not in `k8s/02-configmap.yaml`. `/register` therefore 503s
   everywhere until an operator sets it, which is the safe default but means
   DCR is not actually reachable outside unit tests yet.

**Why not fixed now:** (1) is correct behavior today, just a fragility
worth naming, not a bug to chase without a live misconfiguration to fix
against. (2) is deployment/config wiring, not application code, and doing
it blind (no PingOne app exists yet for Part B's redirect-federation half
either — see the design spec's explicit "out of scope for this
implementation pass") risks wiring a secret nobody's ready to rotate.

**Real fix:** (1) switch `resolveOwnAudience()` to prefer a dedicated env
var (e.g. `PINGONE_RESOURCE_MCP_SERVER_URI`, matching sibling resolvers'
precedence) before falling back to `MCP_SERVER_RESOURCE_URI[0]`. (2) once
DCR is meant to be exercised for real, set `DCR_INITIAL_ACCESS_TOKEN` in
the deployment's env and document the value's provenance/rotation.

### 2026-08-11 — gw-authorize fallback duplicated across two client consumers

**Where:** `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`
(around line 594) and `demo_api_ui/src/context/ProofOfEnforcementContext.js`
(`gwAuthorizeEvent()`).

**What's wrong:** on a gateway-authoritative run (`useGateway: true`), the BFF
skips its own Authorize gate — `mcpAuthorizeEvaluationThisRequest` stays a
skip-shaped object with no `.decision` (this is intentional, see Contract C4
comment at `mcpToolPipeline.js:456` — it's how a caller tells "BFF's gate
didn't run" apart from "it ran and permitted"). On PERMIT, the real decision
only ever arrives client-side as a `gw-authorize` token event
(`mcpToolPipeline.js:956-977`), never merged into `trace.authorize`.

This "authorize decision may only be visible as a `gw-authorize` event, not
`trace.authorize` / `body.authorize`" fact is independently reimplemented in
**four** places, not two:

1. `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:594` — Token
   Chain rail (had it first).
2. `demo_api_ui/src/context/ProofOfEnforcementContext.js`
   (`gwAuthorizeEvent()`) — ProofStrip verdict, added in #1635 because
   nobody had touched it and it silently read "Run failed before
   authorize-decision" on a run that had, in fact, been permitted.
3. `demo_api_server/services/stepVerificationExpectations.js:341-345`
   (`hasAuthorize` in `scoreDelegatedAccessInvoke`) — server-side chip
   prerequisite scorer, same fallback, third independent implementation.
4. `demo_api_server/services/attackSimulatorService.js:295-316`
   (`_authorizeFromPipelineOutcome` → `_normalizeAuthorizeDecision`) — attack
   sim outcome scoring, fourth implementation. Well-documented (docstring at
   282-294 explains the two-source fallback explicitly) so less of a silent
   trap than #2, but still separate logic reimplementing the same fact.

**Why not fixed now:** the fix that found this (#1635) was scoped to the one
broken consumer (#2). Fixing the duplication means normalizing the fallback
in one place per side — client (`tokenChainTraceStore.js`, where
`trace.authorize` gets set, covers #1 and #2) and server (wherever
`stepVerificationExpectations.js` and `attackSimulatorService.js` could share
a helper, covers #3 and #4) — since #3 reads a raw HTTP response body, not
`trace.tokenEvents`, it can't share the client-side store fix directly.
Either normalization touches shared/cross-cutting code used by more than the
one reported bug — bigger surface than a bug fix warrants.

**Real fix:** two separate normalizations, not one:

- Client: merge `gw-authorize` into `trace.authorize` once during ingestion
  (`tokenChainTraceStore.js`), keeping BFF-native vs gateway-native
  provenance distinguishable (e.g. a `source: 'gw-authorize'` field, which
  `buildTraceSteps.js` already stamps) so nothing downstream loses the "who
  actually decided" signal Contract C4 cares about. Fixes #1 and #2.
- Server: extract the `gw-authorize`-token-event fallback shared by #3 and #4
  into one helper (`attackSimulatorService.js`'s `_normalizeAuthorizeDecision`
  is the closer-to-reusable of the two) so both consumers call it instead of
  hand-rolling the `seenIds.has('gw-authorize')` / `events.find(...)` check.

**Do not break:** whatever the fix, `mcpAuthorizeEvaluationThisRequest`
itself must stay skip-shaped on the BFF side for gateway-authoritative
requests — see `mcpToolPipeline.js:456`. Client-side normalization must not
try to make the server stop being honest about that.
