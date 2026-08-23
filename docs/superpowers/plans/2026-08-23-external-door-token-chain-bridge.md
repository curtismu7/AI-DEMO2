# External-door → Token Chain movie reel bridge — design (not yet built)

> Scoping doc for a fresh session to pick up. No code changes from this doc.
> Companion doc: `2026-08-23-external-door-multi-vertical-tools.md` (separate,
> unrelated scope — don't conflate the two).

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
