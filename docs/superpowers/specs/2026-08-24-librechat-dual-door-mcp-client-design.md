# LibreChat as a Dual-Front-Door MCP Client

**Date:** 2026-08-24
**Revised:** 2026-08-24 — see §9. Phase 1 (Agent Gateway via WebSocket) is **not currently feasible**; this design is now Privilege-only. Original phase-1 text preserved in git history. A second-pass correction (also §9) fixes an inaccurate claim about *why* Agent Gateway was left out of scope — it's an untested opportunity, not a blocked one — without changing the scope itself.
**Status:** Design approved (Privilege scope only), implementation not started
**Related:** `docs/mcp/MAC_MCP_CLIENTS_EXTERNAL_DOOR_REPORT.md` (PR #2330) — the survey that motivated this. `docs/superpowers/specs/2026-08-24-external-agent-mcp-client-design.md` — the `langchain_agent` external CLI, which remains the **only** client that reaches the Agent Gateway's WebSocket transport (see §9).

## 1. Why this exists

A follow-up spike on the client report found LibreChat (open-source, self-hosted chat app) has real, mature OAuth support for remote MCP servers — RFC 9728 Protected Resource Metadata discovery and RFC 8707 `resource`-parameter forwarding, verified directly against `packages/api/src/mcp/oauth/` in `github.com/danny-avila/LibreChat`. Combined with a real chat UI (not just a proof-harness CLI), that makes LibreChat a strong candidate for the **Privilege path (agentless)**, which is standard OAuth Authorization Code + PKCE — exactly what this OAuth stack is built for.

A second finding, verified in the same pass, corrected an earlier claim: LibreChat's MCP client *does* implement a `websocket` transport (`packages/api/src/mcp/connection.ts`, via the MCP SDK's `WebSocketClientTransport`) — but that transport branch does not attach any bearer token, static header, or OAuth credential; every auth mechanism in the codebase is wired only into the SSE and Streamable-HTTP branches. So LibreChat **cannot currently authenticate a WebSocket MCP connection at all**, which rules it out for the Agent Gateway's default transport (see §9 for the full finding and its implications).

This design therefore covers **the Privilege path only**. The `langchain_agent` external CLI (sibling spec) remains the sole client that reaches the Agent Gateway.

### Non-goals

- Not replacing `docs/superpowers/specs/2026-08-24-external-agent-mcp-client-design.md`. Both ship; the CLI is now the only path to the Agent Gateway door, not one of two.
- **Not the Agent Gateway door.** See §9 — LibreChat's WS transport has no auth wiring in the current source, which rules out the gateway's *default* transport. The gateway separately already serves an authenticated Streamable HTTP `/mcp` endpoint on the same port as its WS listener (`demo_mcp_gateway/src/server/GatewayServer.ts:352`, sharing `index.ts:1150`'s `httpServer`) — no server-side change needed to reach it, and LibreChat's Streamable-HTTP branch *does* have auth wiring. That combination is unverified and deliberately left out of this spec's scope (see §9) rather than assumed to work; if it's wanted, it's a new decision point, not a blocked one.
- Not Privilege *agent-mode* — that's a machine-level prerequisite (installed macOS Privilege Agent), not something a chat client configures.
- Not enabling LibreChat's RAG/vector-DB/meilisearch features unless implementation finds they're required just to boot MCP support — verify, don't assume, and drop what's unused.
- Not committing any secrets — LibreChat's own JWT/session signing keys and the Privilege OAuth client secret stay in a gitignored `librechat/.env`.
- Not part of the always-running `ai-demo-*` docker-compose stack — see §2.

## 2. Deployment scope

A standalone, opt-in stack under `librechat/`:

- `librechat/docker-compose.yml` — the LibreChat app container plus MongoDB (LibreChat's required datastore), pinned to a MongoDB image that runs on Apple Silicon — the default image LibreChat ships requires AVX instructions that M-series Macs don't support and will crash on startup; this needs an explicit override, not the vendor default.
- `librechat/librechat.yaml` — endpoints and `mcpServers` config (see §3, §4).
- `librechat/.env` (gitignored) — Mongo URI, LibreChat's session/JWT secrets, and the Privilege OAuth client secret.

Kept deliberately outside `run-docker.sh`'s primary stack: this is exploratory client tooling, not a demo-facing service, and shouldn't become something every session's deploy/sync/restart has to account for (per this repo's existing "one stack, one owner" convention for the main compose).

## 3. LLM backend

LibreChat's custom OpenAI-compatible endpoint support, pointed at the repo's existing local LLM proxy on `:8090` (the same `demo_llm_proxy/` used elsewhere in this repo — oMLX/llama.cpp backend, frozen settings, tiers 8091+). No new API keys, no new cost. Reachability from inside LibreChat's Docker network to `:8090` on the host needs a quick check during implementation (likely `host.docker.internal`, consistent with how other containerized services in this repo reach host-run processes) — not assumed here.

## 4. Privilege (agentless) — the only door in scope

- A new PingOne OAuth client gets registered for LibreChat specifically (client_id/secret, redirect_uri) — LibreChat expects a fixed, discoverable callback path under its own base URL; the exact value gets handed over once implementation starts, not guessed now.
- `librechat.yaml` → `mcpServers.privilege`: `type: streamable-http`, Privilege's agentless URL (`https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp`) — `external` is the required application, matching the `get_my_accounts` acceptance criterion in §4; `cmuir` routes to a different server (`pingone-mcp-server-2`) and would authenticate but not serve banking tools — using LibreChat's native OAuth — RFC 9728 discovery if the Privilege gateway advertises protected-resource metadata, otherwise manual OAuth config with the registered client.
- **Done when:** from LibreChat's chat UI, asking the model to call a real banking tool (`get_my_accounts`, Super Sports vertical) returns real data, authenticated via LibreChat's built-in browser-based OAuth flow.

## 5. Error handling

- MongoDB startup crash on Apple Silicon (AVX): addressed up front via the pinned/override image in §2, not discovered mid-implementation.
- Privilege OAuth failures (wrong redirect_uri, bad client secret): surfaced from LibreChat's own OAuth error handling — no custom handling needed on our side.

## 6. Testing

Manual only, matching this repo's default-vertical convention (Super Sports): LibreChat chat UI → ask for account data → confirm real data returned via Privilege-agentless, with the OAuth browser flow completing.

No unit tests — this is deployment/config of a third-party open-source app, not new code we own.

## 7. Open questions for the implementation plan

- Exact LibreChat services required to boot MCP support (can meilisearch/rag-api/vector-DB be omitted, or does LibreChat's compose assume them present even if unused features aren't invoked?).
- Concrete host/network path from LibreChat's container to the `:8090` LLM proxy.
- LibreChat is pinned to `@modelcontextprotocol/sdk ^1.30.0`; the SDK removed `WebSocketClientTransport` entirely in v2 (not a spec-defined transport). Not a blocker for this Privilege-only scope, but worth knowing before any future attempt to revisit the Agent Gateway door through LibreChat — that capability is shrinking upstream, not growing.

## 8. Alternate client: LM Studio (Privilege-only, zero code)

Also verified in the same research pass, worth recording since it's a real option at zero engineering cost: LM Studio's desktop app is closed-source (only its CLI/SDKs are public under `github.com/lmstudio-ai` — nothing to patch), but it already ships **native OAuth 2.1** for remote MCP servers — a config-only `auth: {CLIENT_ID, CLIENT_SECRET}` block with a browser-based flow and a fixed local redirect (`http://127.0.0.1:33389/mcp-oauth-callback`). Registering that redirect URI as a PingOne client makes LM Studio a working Privilege-path client with no code at all. Its docs show no evidence of WebSocket support, so it shares LibreChat's Agent Gateway blind spot. Not part of this implementation — noted here as a low-effort fallback/comparison point if LibreChat's deployment overhead (Docker + MongoDB) turns out not to be worth it for a Privilege-only client.

## 9. Revision notes (2026-08-24)

The original version of this spec claimed LibreChat could reach the Agent Gateway's default WebSocket transport "with zero server-side changes," using a static bearer header as a phase-1 stopgap. A follow-up research pass against the actual LibreChat source (not docs/blog posts) found this to be wrong:

- The WebSocket connection logic (`packages/api/src/mcp/connection.ts`) is real and does construct a `WebSocketClientTransport` — that much was correctly identified.
- But that code path never attaches `oauthTokens`, configured `headers`, or any bearer token. Every auth mechanism LibreChat has — static headers, OAuth, RFC 9728 discovery — is wired only into the SSE and Streamable-HTTP branches, per the MCP config schema's own documentation comment scoping OAuth to those two transports.
- This means the static-token approach the original phase 1 specified would not have worked either — not just real OAuth. There was no mechanism in the actual code for any credential to reach a WebSocket-transport MCP connection.

This is exactly the kind of gap the spec self-review step is meant to catch, and would have if the source had been checked at spec-writing time instead of relying on docs/blog summaries. It wasn't caught until implementation planning began on the sibling CLI spec and the user asked for the claim to be checked against the real repo. The correction: this spec is now scoped to the Privilege path only (§4), and the Agent Gateway door remains exclusively the `langchain_agent` external CLI's responsibility.

### Follow-up correction (2026-08-24, second pass)

The first correction above (WS transport has no auth wiring) is confirmed accurate. But this revision's own reasoning for leaving the Agent Gateway out — treating Streamable HTTP as something the gateway would need to "move to," and framing that as a server-side change that "defeats the zero server changes rationale" — was itself wrong. The gateway's `GatewayServer` already serves an authenticated `/mcp` (POST/GET/DELETE, PingOne bearer + RFC 7662 introspection) on the **same port** as the WS listener, unconditionally, today (`demo_mcp_gateway/src/server/GatewayServer.ts:352`, sharing the `httpServer` from `index.ts:1150`). No flag, no mode switch. Since LibreChat's auth wiring lives in exactly the Streamable-HTTP branch (per the first correction, §9 above), a Streamable-HTTP `mcpServers` entry pointed at the gateway's `/mcp` is technically unblocked with zero server-side changes — the original "zero server changes" premise for LibreChat actually still holds for this path, it just hasn't been tried.

This spec stays Privilege-only (§4) rather than expanding scope on the strength of an unverified claim — that would repeat the same mistake this section exists to document. Recorded here as an accurate open question instead: **Agent Gateway via LibreChat's Streamable-HTTP branch is untested, not blocked.** Anyone revisiting this should verify it directly (point a `streamable-http` `mcpServers` entry at the gateway's `/mcp` with a PingOne bearer + `MCP_GW_RESOURCE_URI` audience) rather than assuming either the old "impossible" framing or the new "unblocked" one.
