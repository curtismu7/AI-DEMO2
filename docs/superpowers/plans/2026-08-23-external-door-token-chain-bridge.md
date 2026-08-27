# External-door → Token Chain movie reel bridge — design (not yet built)

> Scoping doc for a fresh session to pick up. No code changes from this doc.
> Companion doc: `2026-08-23-external-door-multi-vertical-tools.md` (separate,
> unrelated scope — don't conflate the two).

## 2026-08-24 session 4 — the auth chain is FIXED and live-verified end-to-end; found a NEW, separate bug

Picked up session 3's handoff (deploy the `resource=` fix, retest). The
`resource=` fix alone did not close the loop — three more real bugs were
found and fixed along the way, all now deployed and live-verified together.
**`get_my_accounts` now returns real account data through the external
door**, authenticated as a real PingOne user (`demoUser`), for the first
time this investigation. One new, unrelated bug surfaced immediately after
(tool response schema mismatch — see bottom of this section).

### The four bugs, in the order they were found

1. **Units bug (ms vs s) — `oauth-mcp/src/tools/TokenResolver.ts`,
   `resolveFederatedSubjectToken`.** `TokenIssuer.ts` stores the stashed
   PingOne-token's `expiresAt` as **seconds**-since-epoch (mirrors the JWT
   `exp` claim convention: `Math.floor(Date.now()/1000) + 3600`), but the
   resolver compared it against `Date.now()`, which is **milliseconds**.
   Milliseconds-since-epoch is always numerically larger than
   seconds-since-epoch, so `Date.now() >= issued.expiresAt` was `true` the
   instant the stash was created — every time, for every session, no matter
   which client or grant. This silently defeated PR #2295 (session 3's "Bug
   3" fix) from the moment it shipped: the resolver always fell through to
   forwarding the raw self-issued embedded-AS token, which the Banking API
   correctly rejects (`No matching JWKS key found for kid=...` — that `kid`
   is the embedded issuer's own signing key, not PingOne's). Found by adding
   temporary `[TEMP-DIAG]` logging to the four early-return branches,
   redeploying once, and reading which branch fired live
   (`expired for jti=...`). Fixed the comparison
   (`Date.now() >= issued.expiresAt * 1000`); the three test fixtures that
   had baked in the same ms/s confusion were corrected to seconds
   (`Math.floor(Date.now()/1000)`), matching what `TokenIssuer.ts` actually
   produces. All 1075 unit tests passed before this was even the confirmed
   root cause; the diagnostic logging was removed once it was.

2. **PingOne client had no grant to the Banking API resource.** With bug 1
   fixed, the *real* PingOne-signed token was finally reaching the Banking
   API — but it carried `aud: https://api.pingone.com` (PingOne's own
   default) instead of `enduser.ping.demo`. The PingOne application used for
   oauth-mcp's federation hop (`Demo AI App - MCP External Client`,
   `86f1f88a-cbb2-413b-9798-9324428e77d6`) had exactly one resource grant —
   to the generic `openid` resource — and none to the `Demo API` resource
   (audience `enduser.ping.demo`, id `4a536256-36ad-4887-8e57-bcaa4c4f499e`).
   `resource=` in the `/authorize` redirect has no effect if the client
   isn't authorized for that resource at all. Fixed live via
   `updateApplication` → `createGrant` (scope: `read`).

3. **PingOne also requires a scope from the target resource in the request,
   not just `resource=`.** Even with the grant in place, the same
   `aud: https://api.pingone.com` mismatch persisted. PingOne's resource
   indicator (RFC 8707) support only attaches a resource's audience to the
   token when the `scope=` list includes a scope that resource actually
   owns — `handleAuthorize` was requesting `scope=openid profile email`,
   none of which belong to the Banking API resource, so PingOne had nothing
   to bind `resource=enduser.ping.demo` to and fell back to its default.
   Fixed in `OAuthRouter.ts`'s `handleAuthorize`: when
   `BANKING_API_RESOURCE_URI` is configured, the outbound scope becomes
   `openid profile email read` (`read` is the Banking API resource's
   broadest scope — Step 9 narrows further per-tool downstream, so this only
   needs to get PingOne to pick the right audience, not to authorize
   anything by itself).

4. **The PingOne app also needed `requestScopesForMultipleResourcesEnabled`
   enabled** to allow combining an OIDC scope (`openid`, owned by the
   built-in OIDC resource) with a Banking-API-owned scope (`read`) in one
   `/authorize` request at all. Toggled live via `updateApplication`.

### Live verification

MCP Inspector, fresh incognito-equivalent state each time (see "the
reconnect trap" below), real `demouser` PingOne login, `get_my_accounts`:
went from `invalid_token` (wrong signer) → `invalid_token` (wrong audience,
after fix 1) → `invalid_token` (still wrong audience, after fixes 1+2) →
**real account data, schema-validation error only** (after fixes 1+2+3+4).
The schema error is a new, unrelated bug — see below.

### The reconnect trap — read this before redeploying mid-test again

Every one of the four fixes above needed its own redeploy, and **every
redeploy silently invalidated the previous test's login** without any
visible symptom pointing at "stale client state":

- `TokenStore` (the in-memory map holding the stashed real PingOne token
  against a session's `jti`) is **in-memory only** — a `kubectl rollout
  restart` wipes it, but the *client's* self-issued bearer token stays
  valid (same signing key persists across restarts) for its full 1-hour
  life. The client has no reason to re-authenticate, so it just keeps
  presenting the same now-orphaned token forever.
- MCP Inspector's OAuth state lives in **two places that don't clear
  together**: the browser's own `localStorage` (per-origin, survives new
  tabs and even incognito if the same long-running Node backend process is
  still serving `127.0.0.1:6274`) and the Node backend process itself
  (`~/.mcp-inspector/storage/`, holds its own in-memory + on-disk cache
  independent of the browser). A new tab or incognito window only clears
  the browser half — the Node process, if still running from an earlier
  point in the session, keeps serving the same cached token regardless.
  **The only reliable way to force a genuinely fresh login**: kill the
  Node process (`pgrep -f mcp-inspector`, `kill <pid>`), delete
  `~/.mcp-inspector/storage/oauth.json` and
  `~/.mcp-inspector/storage/inspector-session-*.json`, and restart
  (`nohup npx -y @modelcontextprotocol/inspector &`) — it prints a fresh
  `MCP_INSPECTOR_API_TOKEN` URL each time.
- Confirmed live twice: a token minted at one point kept getting replayed
  across two subsequent `mcp-server` redeploys and multiple "fresh" browser
  reconnects, identified by its `jti` and `iat` staying byte-for-byte
  identical across attempts that should have been independent.

If you redeploy `mcp-server` again and don't see the fix take effect,
suspect this before suspecting the code — decode the bearer token's `jti`
and compare it against the previous attempt's before concluding the fix
didn't work.

### Found AND fixed, same session: `get_my_accounts` response schema mismatch

Once the auth chain actually worked, `get_my_accounts` returned real
account data but MCP Inspector rejected the tool result with `-32602
Invalid params`:

```
data/accounts/0 must have required property 'accountNumber'
data/accounts/0/swiftCode must be string
data/accounts/0/iban must be string
data/accounts/0/branchName must be string
data/accounts/0/branchCode must be string
data/accounts/0/openedDate must be string
data/accounts/0/notes must be string
... (repeated per account, 4 accounts total; accounts 2-3 already had accountNumber)
```

Traced with a read-only exploration agent rather than guessing. Two
compounding causes, both in `oauth-mcp/src/tools/handlers/accountHandlers.ts`'s
`executeGetMyAccounts` — not in `demo_api_server` as this doc originally
guessed: `accountNumber` was mapped with no fallback, so an `undefined`
upstream value (demoUser's checking/savings accounts, seeded via the
minimal path in `demo_api_server/data/store.js`, never set it) got dropped
by `JSON.stringify` entirely; every other optional field was mapped with
`|| null`, but the declared output schema types them as plain `string` with
no `null` in the union. Fixed by falling back to `''` instead of
`null`/omission for every optional field including `accountNumber`,
matching the file's own existing convention
(`formatAccountNickname`'s `(account.accountNumber || '')`).

A second, related bug was found in the same pass: `account_type` filtering
(e.g. `account_type: "checking"`) used a case-sensitive compare against
real `accountType` values that are inconsistently cased/named across two
seed-generation paths (`'CHECKING'`/`'SAVINGS'` uppercase vs lowercase
`'loan'`/`'credit_card'`), while the tool's enum advertises lowercase
`'checking'`/`'savings'`/`'credit'` — every filtered call silently returned
zero accounts. Fixed with case-insensitive matching plus a `'credit'` →
`'credit_card'` mapping, same pattern `pickAccountForNickname` (same file)
already used for this exact class of mismatch.

Full writeup, including which specific fields/lines and why, in
`TECH_DEBT.md`'s matching entry (now marked resolved). Live-verified via
MCP Inspector as `demoUser`: unfiltered `get_my_accounts` returns all 4 real
accounts cleanly, and `account_type: "checking"` correctly returns the one
matching account. New unit tests in
`oauth-mcp/src/tools/handlers/__tests__/accountNickname.test.ts`; full
suite green (1079/1079) before each deploy.

### Exact next steps (in order)

1. Confirm the original investigation goal: does a `get_my_accounts` call
   through the external door show up in Personal Agent Studio's token-chain
   movie reel (`TokenChainFilmstrip`, ~15s poll) for a browser logged in as
   the same PingOne user (`demoUser`)? That closes the loop this whole doc
   was written for — not yet checked this session.
2. Merge PR #2296, plus every commit this session added on the same branch
   (units fix, PingOne resource=/scope fix, response-schema fix). Note the
   PingOne app grant and `requestScopesForMultipleResourcesEnabled` toggle
   are **live tenant config changes, not code** — nothing to merge for
   those, but worth a line in the PR description so a fresh
   environment/tenant doesn't silently miss them:
   - Grant application `86f1f88a-cbb2-413b-9798-9324428e77d6`
     ("Demo AI App - MCP External Client") access to the `Demo API` resource
     (`enduser.ping.demo`, resource id `4a536256-36ad-4887-8e57-bcaa4c4f499e`),
     scope `read`.
   - Enable `requestScopesForMultipleResourcesEnabled` on that same
     application.
3. `./run-pingaws.sh undeploy` when the SE cluster session is genuinely done.

## 2026-08-24 session 3 — switched to MCP Inspector, found + fixed 2 more bugs, ONE fix not yet deployed

Picked up the previous session's own recommendation ("retest via MCP
Inspector or Claude Desktop instead of LM Studio") and did exactly that.
Found two more real bugs in the process — one fully fixed, deployed, and
live-verified; one fixed in code but **not yet built/deployed**. This
section is written so a fresh agent can resume in under a minute.

### Where things actually stand right now

| Fix | Code | Deployed to SE cluster | Live-verified | Merged |
|---|---|---|---|---|
| Gateway event-loop deadlock | done | yes | yes | **yes** (#2292) |
| Step 9 skip for self-issued tokens | already on `main`, just needed deploying | yes | yes | already on `main` |
| Step 9 federated-token propagation | done | yes | yes (found the token, correctly) | **yes** (#2295) |
| RFC 9728 suffix routing (ingress + 2 server gates) | done | yes | **yes** — MCP Inspector completed a full real login | open PR **#2296** (commit 1) |
| PingOne `resource=` audience federation | done | **NO — not built/pushed/deployed** | **NO** | open PR **#2296** (commit 2, same branch) |

**PR #2296 has two commits on one branch** (`worktree-external-door-well-known-suffix-routing`) — the routing fix (deployed, verified) and the `resource=` fix (not yet deployed). They're related but distinct; feel free to split into two PRs when merging if that reads cleaner, but don't lose the "not yet deployed" distinction when you do.

### Exact next steps (in order)

1. **Deploy the `resource=` fix** — from `worktree-external-door-well-known-suffix-routing` (or after merge, from `main`):
   ```
   cd oauth-mcp && npm run build   # already passes, just confirming
   cd .. && COMPOSE_PARALLEL_LIMIT=1 docker compose -p ai-demo-k8 -f docker-compose.yml build mcp-server
   docker tag ai-demo-k8-mcp-server:latest ghcr.io/curtismu7/ai-demo-mcp-server:latest
   docker push ghcr.io/curtismu7/ai-demo-mcp-server:latest
   kubectl rollout restart deployment/mcp-server -n ping-devops-cmuir
   kubectl rollout status deployment/mcp-server -n ping-devops-cmuir --timeout=120s
   ```
2. **Retest via MCP Inspector.** It should already be running locally on `http://127.0.0.1:6274` (background process from this session — check `lsof -i :6274`; if it's gone, `nohup npx -y @modelcontextprotocol/inspector &` restarts it and prints a fresh `MCP_INSPECTOR_API_TOKEN` URL). The server entry `personal-agent-external-door` (streamable-http, `https://cmuir-mcp.ping-devops.com/mcp`) should still be in its catalog (`~/.mcp-inspector/mcp.json`).
   - **If reconnecting reuses a stale/failed state** (it will, from before this deploy): MCP Inspector caches OAuth discovery + tokens in `~/.mcp-inspector/storage/oauth.json`, keyed by server URL, and does NOT invalidate it on reconnect. Clear that file's `servers` key (or the whole file) and **reload the Inspector page** (editing the file alone isn't enough — the running tab has it in memory) before retrying, or you'll be debugging a cache, not the fix.
   - Toggle the server's connect switch, complete a real PingOne login (this session used `demouser` — ask the user for credentials, don't assume you have them), confirm "Connected".
   - Switch to the Tools tab, run `get_my_accounts`. **This is the actual test** — does real account data come back, or still `invalid_token`?
3. **If real data comes back:** check the original goal — open Personal Agent Studio (`https://ai-demo.ping-devops.com/personal-agent`) in a browser logged in as the *same* PingOne user, and see if the tool call shows up in the movie reel (`TokenChainFilmstrip`) within ~15s (it polls, doesn't push — see below). That's the whole investigation, closed, for real, end to end.
4. **If it still fails:** get the exact error and check `kubectl logs -n ping-devops-cmuir -l app=ai-demo,component=mcp-server --tail=100` around the failing call's timestamp — the pattern all session has been "the error text alone undersells it, the logs show the real mechanism." Don't guess from the error string alone.
5. Merge PR #2296 once verified. Update `TECH_DEBT.md` or this doc if a *fifth* layer turns up — at this rate, mildly plausible.
6. `./run-pingaws.sh undeploy` when the SE cluster session is genuinely done (not yet done as of this handoff — still live, still serving this test).

### How the RFC 9728 suffix bug was found (context for the table above)

MCP Inspector's own network log showed it requesting
`/.well-known/oauth-protected-resource/mcp` (RFC 9728 §3.1's actual
convention — the well-known path with the resource path appended), not the
bare path every routing layer in this repo matched. Three places needed the
same fix: `k8s/aws/se-ingress.yaml` (`pathType: Exact` → `Prefix`),
`oauth-mcp/src/server/DemoMCPServer.ts`'s `handleHttpRequest` (the outer
dispatch gate — fixing only `HttpMCPTransport.ts` alone did NOT work, this
gate 404'd the request before ever reaching it), and
`HttpMCPTransport.ts`'s own handler. All three are in PR #2296's first
commit, deployed and live-verified (`curl` of the suffixed path went from
wrong-data → 404 → correct data across the three iterations).

This bug plausibly explains why **every LM Studio session tonight** ended
up using a `client_credentials` token instead of carrying its real
`authorization_code` one into the live MCP session — if LM Studio made the
same suffixed discovery request, pre-fix, it would have been told to
register at PingOne directly (which has no DCR) and had no correct way to
get a real-user-scoped token, plausibly explaining the fallback. Not
independently confirmed against LM Studio specifically — MCP Inspector was
the client that got fixed and verified.

### How the `resource=` bug was found

With RFC 9728 routing fixed, MCP Inspector completed a genuine
`authorization_code` login as `demouser` (fresh DCR client, real PingOne
login page, "Authorization complete" toast, real `sub` in the resulting
token — none of this was faked or SSO'd). Calling `get_my_accounts` still
returned `Error: Banking API error: invalid_token`, but this time server
logs showed **no** Step 9 crash — meaning the earlier fix (PR #2295) worked
correctly and forwarded demouser's real federated PingOne token. The
Banking API (which is just `demo_api_server`, reached over Bearer instead
of a session cookie) rejected it anyway, in ~120ms — too fast to be
anything but a straightforward audience check failing.

Traced to `handleAuthorize`'s outbound redirect to PingOne
(`OAuthRouter.ts`): it only ever requested `scope: openid profile email`,
no `resource`/`audience` parameter, so PingOne minted a generic identity
token — never scoped to `enduser.ping.demo`. Fixed by adding `resource=`
(RFC 8707) to both the outbound `/authorize` redirect and the
`/authorize/callback` token exchange — `resource=`, not `audience=`,
matching a trap already documented elsewhere in this codebase
(`TokenResolver.ts`'s Step 9 exchange comment: PingOne honors `resource=`
and silently ignores `audience=`).

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
