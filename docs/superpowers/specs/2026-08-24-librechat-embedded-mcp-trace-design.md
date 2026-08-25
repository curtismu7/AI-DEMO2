# Embedding the MCP Trace ("Movie Reel") in LibreChat

**Date:** 2026-08-24
**Status:** Design approved (including a mockup of the panel), implementation not started
**Related:** `docs/superpowers/plans/2026-08-24-librechat-privilege-mcp-client.md` (the door that first proved `privilege-agentless`), `docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md` (the original dual-door spec), `TECH_DEBT.md`'s resolved 2026-08-24 entry. Mockup: https://claude.ai/code/artifact/e8fe3ab3-57f9-4a04-b429-d75014bef326.

## 1. Why this exists

`librechat/librechat.yaml` now declares four MCP doors (`aidemo-mcp`, `opensearch-direct`, `opensearch-privilege-agent`, `privilege-agentless`). The two direct doors work today with no extra plumbing: LibreChat talks straight to a server that's either unauthenticated (`aidemo-mcp`, `MCP_AUTH_DISABLED=true`) or genuinely device-authenticated by nothing more than TLS (`opensearch-direct`). Nothing needs to change there.

The two gateway doors (`opensearch-privilege-agent`, `privilege-agentless`) are different: they cross a real authorization boundary (Privilege policy, PingOne OAuth) that this repo already knows how to make visible — the MCP Inspector shows a tool's catalog, description, and schema; `/transaction-trace`'s filmstrip shows the hop-by-hop chain of custody behind a call. Neither view sees LibreChat's traffic today, because LibreChat's gateway doors bypass this repo's BFF entirely — they talk straight to the gateway. A LibreChat tool call through `privilege-agentless` shows up as LibreChat's own "Ran get_my_accounts" marker and nothing else; the request never touches the ledger the reel is built from.

This spec adds that visibility, embedded in LibreChat's own UI (approved 2026-08-24 against the mockup above) rather than as a link out to a separate page.

### Non-goals

- Not touching `aidemo-mcp` or `opensearch-direct` — they're direct doors with no gateway hop to record, and CLAUDE.md's "touch only what you must" applies.
- Not a LibreChat fork. Every piece of this ships as config (`librechat.yaml`, an agent's system instructions, an agent's enabled tools) plus new server-side surface in this repo. LibreChat's own Docker image is untouched.
- Not extending to MCP **resources** — the banking `mcp-server`'s `initialize` response declares no `resources` capability today. The embedded panel says so honestly (see the mockup's "Resources — not advertised" note) rather than fabricating a resource list.
- Not modifying `oauth-mcp` (the banking MCP server / `mcp-server`). See §4's Judgment call for why.
- Not guaranteeing the artifact renders on every turn — see §7.

## 2. Architecture overview

```
LibreChat (Agent: gpt-oss-20b, tools = one MCP tool)
   │  streamable-HTTP MCP  (initialize / tools/list / tools/call)
   ▼
NEW: MCP recording façade  ──── posts one ledger hop per phase ────▶  demo_api_server
   │  (per-door: agent-mode relay, or agentless OAuth relay)              /internal/transaction-hop
   ▼                                                                            │
Real gateway (agent: Priv Agent :8643 / agentless: cmuir-agentless-mcpgw)       ▼
   │                                                                    LMDB ledger
   ▼                                                                    (transactionLedger.lmdb)
mcp-server (get_my_accounts, etc.)                                             │
                                                                                 ▼
                                                                    NEW: compact reel view
                                                                    /transaction-trace/embed/:correlationId
                                                                    (reused transactionAssembler + a
                                                                     stripped-down TokenChainFilmstrip)
                                                                                 ▲
                                                                                 │ iframe
                                                          LibreChat's own Artifacts side panel
                                                          (`:::artifact{type="application/vnd.code-html"}`,
                                                           emitted by the agent per its system instructions)
```

Two independent pieces:

1. **The façade** — a new MCP-server surface LibreChat's two gateway doors point at instead of the real gateway. It relays every call to the real gateway (so behavior is unchanged) and records each phase as a ledger hop (so the reel exists).
2. **The embed** — a new, chrome-free reel view the façade's tool response points the agent at, rendered inside LibreChat via its own Artifacts mechanism.

## 3. The façade

### 3.1 Protocol surface (toward LibreChat)

Streamable HTTP MCP server: `initialize` → `notifications/initialized` → `tools/list` / `tools/call`, with `Mcp-Session-Id` issuance and `mcp-protocol-version` enforcement on non-initialize requests — the same contract `aidemo-mcp`'s `mcp-server` already satisfies for LibreChat today, so the target behavior is proven reachable, not speculative.

Two façade endpoints, one per gateway door:

- `POST /mcp-facade/agent/mcp` → relays to the Priv Agent listener (`opensearch.default.applications.procyon.ai:8643`), agent mode: no OAuth, the agent's mTLS identity IS the identity, same as `isProcyonAgentUrl()`'s existing special case in `privilegeMcpClient.js`.
- `POST /mcp-facade/agentless/mcp` → relays to the `external` Privilege application (`cmuir-agentless-mcpgw.ping-devops.com/external/mcp`) with a **façade-owned** OAuth session (§3.3) — never LibreChat's own DCR login, since the façade is the client of record with the gateway.

Each façade `tools/call` response's `content` array gets one extra block appended (not replacing the real tool result): `{"type":"text","text":"reel_url: https://.../transaction-trace/embed/<correlationId>"}`. This is the mechanism §5's fallback link depends on, and it's also what makes the `correlationId` visible to the model for the artifact fence.

### 3.2 Where the façade's protocol code lives — Judgment call

**Considered and rejected: extend `oauth-mcp`.** `oauth-mcp`'s `HttpMCPTransport`/`MCPMessageHandler`/`DemoMCPServer` already implement this exact wire protocol correctly (proven by `aidemo-mcp`), which made "add a provider mode" look appealing. But `BankingToolProvider` is a concrete class, imported directly by all three call sites (`oauth-mcp/src/index.ts`, `DemoMCPServer.ts`, `MCPMessageHandler.ts`) — not an interface. Making it pluggable means refactoring a REGRESSION_PLAN-adjacent, production banking MCP server for one new demo-only caller. That fails "touch only what you must" and adds an abstraction (an interface with two implementations, one of them speculative until this spec) this repo's own CLAUDE.md tells us not to add.

**Recommended: a new, small, standalone service.** A new directory (name TBD in the plan — e.g. `demo_mcp_facade/`), TypeScript, using `@modelcontextprotocol/sdk`'s server transport directly rather than hand-rolling protocol edge cases. It is a genuinely new piece of surface — smaller and more isolated than touching `oauth-mcp`, and it reuses the one integration point that's already a stable, protected contract: `POST /internal/transaction-hop` (`x-internal-gateway-secret`, the same phase vocabulary every other service already emits).

The façade's upstream relay logic (OAuth session management, `tools/list`/`tools/call` against the real gateway) is a new, focused module — **not** a literal reuse of `demo_api_server/routes/privilegeMcpClient.js`, which is tightly coupled to Express `req`/`res`/session. It mirrors that file's proven logic (`ensureMcpSessionInitialized`, `callMcp`, the legacy/modern era handshake) rather than importing it.

### 3.3 The façade's own upstream identity — Judgment call

The façade must be reachable whenever LibreChat is, independent of whether anyone has the AI Gateway client page (`/privilege-mcp-client`) open in a browser — so it cannot piggyback on that page's per-browser-session OAuth token the way today's proof did.

- **Agent-mode door:** no identity to manage — the Priv Agent's mTLS listener IS the identity, same as today.
- **Agentless door:** the façade owns a **persisted, server-side Privilege OAuth session**, established by a one-time interactive admin login (mirroring this repo's existing pattern of "log in once, tokens persisted server-side, refreshed automatically" rather than inventing a new auth model) and refreshed on its own. This is new code, but a small, well-understood shape — not a new *kind* of thing in this repo.

### 3.4 Ledger hops emitted per call (agentless example)

| phase | service | what |
|---|---|---|
| `ui.request` | `librechat-facade` | LibreChat's `tools/call` arrived |
| `token.exchange` | `agentless-mcpgw` | the façade's persisted OAuth session was used (or refreshed) |
| `gateway.authorize` | `agentless-mcpgw` | the gateway's policy decision |
| `mcp.tool` | `mcp-server` | the actual tool execution — real request/response |
| `response` | `librechat-facade` | relayed back to LibreChat, `reel_url` attached |

Agent-mode drops the `token.exchange` hop (no OAuth) but keeps the other four.

## 4. The compact reel view

`GET /transaction-trace/embed/:correlationId` — a new, minimal UI route (no `TopNav`, no admin chrome, sized to fit an iframe), built on infrastructure that already exists:

- Data: the existing `transactionAssembler.assemble(correlationId)` → `{ correlationId, startedAt, endedAt, hops }`. No new backend read path.
- Rendering: a stripped-down variant of the existing filmstrip (`TokenChainFilmstrip.jsx` / `TraceStepCard.jsx`) — reuse the phase→label/status mapping that component already has rather than reinvent it, drop the parts that don't fit an embedded panel (page chrome, the "Replay in …" button, which targets an internal admin tool LibreChat's viewer can't use).
- Live updates: hops arrive over a short window (the mockup's proven case: ~3.2s across 5 hops). The plan phase decides polling vs. reusing an existing SSE mechanism if one already fits `transactionTrace.js`'s data shape — this is small either way given the low hop count and short window.
- No auth gate: this route is reached from inside a sandboxed LibreChat artifact iframe with no ambient session, so it can't require the admin cookie the rest of `/transaction-trace` uses. It exposes only what a single known `correlationId` already reveals (mirrors this repo's existing view of a trace as non-sensitive once you already hold its id — same trust level as `/transaction-trace/:correlationId`'s current JSON API).

## 5. LibreChat-side wiring

1. **`librechat.yaml`:** `opensearch-privilege-agent`'s `url` repoints at `http://host.docker.internal:<facade-port>/mcp-facade/agent/mcp`; `privilege-agentless`'s `url` repoints at `http://host.docker.internal:<facade-port>/mcp-facade/agentless/mcp` (exact port decided in the plan, §8). `mcpSettings.allowedAddresses` gets the façade's host:port. `aidemo-mcp` and `opensearch-direct` are untouched.
2. **Agent system instructions**, for any agent whose tools include one of the two gateway-door tools: an instruction to render the tool response's `reel_url` as an artifact —

   ```
   :::artifact{identifier="reel-<correlationId>" type="application/vnd.code-html" title="Live trace"}
   <iframe src="<reel_url>" style="width:100%;height:100%;border:0"></iframe>
   :::
   ```

   (`application/vnd.code-html` is LibreChat's raw-HTML artifact type — confirmed present in the shipped client bundle, distinct from its React/Sandpack type, and it's what the approved mockup represents.)
3. **Artifacts capability enabled per agent** (LibreChat's own "Artifacts" native tool, toggled the same way `get_my_accounts` was toggled on in the proven agents) — required for the fence to render at all.
4. **Fallback:** the raw `reel_url` text block (§3.1) is already visible in LibreChat's "View details" on the tool call regardless of whether the artifact rendered, so a turn where the model skips the fence still leaves a working link. No extra plumbing beyond what §3.1 already does.

## 6. Error handling

- **Façade unreachable / gateway down:** LibreChat sees the same connection failure it would talking to the real gateway directly — no new failure mode, the façade is a thin relay.
- **Gateway denies the call (policy lapsed, as currently observed on the Priv Agent door):** the façade still emits `gateway.authorize` with `decision: deny` and passes the real 403 through unchanged; the reel shows exactly where it stopped, same as the AI Gateway client page does today.
- **Artifact fence not emitted:** not an error — §5.4's fallback link covers it. Measured, not silently assumed (§7).
- **`reel_url` requested for a correlationId with no ledger record yet** (a race right after the call): the embed view shows a "waiting for the first hop" state rather than a 404, since the façade's `response` hop can lag the artifact rendering by a beat.

## 7. Testing

Extends `demo_api_ui/tests/e2e/librechat-mcp-servers.real.spec.js` (already covers all four doors) with, per gateway door:

- the façade's `tools/call` produces a ledger record reachable at `/transaction-trace/embed/:correlationId` with the expected hop count and `mcp.tool` phase present;
- **measure artifact-fence compliance empirically** — run the same prompt N times, record how often the `:::artifact` fence actually renders vs. how often only the fallback `reel_url` link is present. This number is the open risk in §8, not a pass/fail gate — the fallback link makes the feature work either way, but the number decides whether the system instruction needs tightening.
- the embed view itself: given a known correlationId, the reel renders the expected phases in order.

## 8. Open questions for the implementation plan

- Exact name/location for the new façade service, and whether it's Dockerized standalone or run alongside `librechat/docker-compose.yml`.
- Polling interval vs. SSE for the embed view's live updates (§4).
- The façade's one-time admin-login UX for its persisted agentless OAuth session (§3.3) — likely a small addition to the existing AI Gateway client page rather than a new page.
- Measured artifact-fence compliance rate (§7) and whether the system instruction needs iteration once real numbers exist.
