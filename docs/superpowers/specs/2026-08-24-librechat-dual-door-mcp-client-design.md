# LibreChat as a Dual-Front-Door MCP Client

**Date:** 2026-08-24
**Status:** Design approved, implementation not started
**Related:** `docs/mcp/MAC_MCP_CLIENTS_EXTERNAL_DOOR_REPORT.md` (PR #2330) — the survey that motivated this. `docs/superpowers/specs/2026-08-24-external-agent-mcp-client-design.md` — the parallel, complementary track extending `langchain_agent`'s own client.

## 1. Why this exists

A follow-up spike on the client report found that LibreChat (open-source, self-hosted chat app) supports MCP over `websocket` as a native transport — the only client in the entire survey that does — and its OAuth client implements RFC 9728 (Protected Resource Metadata discovery) and forwards `resource` per RFC 8707. That combination means LibreChat can reach:

- The **Agent Gateway path**'s *default* WebSocket transport directly, with no server-side transport switch (every other surveyed client needed the gateway moved to HTTP mode first).
- The **Privilege path (agentless)** via standard OAuth Authorization Code + PKCE, same as most modern clients.

This is a genuinely different value proposition than the `langchain_agent` external-client work: that spec produces a thin CLI proof harness; this produces a real chat UI where a live LLM drives tool calls through both doors. The two are complementary, not competing.

### Non-goals

- Not replacing `docs/superpowers/specs/2026-08-24-external-agent-mcp-client-design.md`. Both ship.
- Not Privilege *agent-mode* — same reasoning as the other spec: that's a machine-level prerequisite (installed macOS Privilege Agent), not something a chat client configures.
- Not enabling LibreChat's RAG/vector-DB/meilisearch features unless implementation finds they're required just to boot MCP support — verify, don't assume, and drop what's unused.
- Not committing any secrets — LibreChat's own JWT/session signing keys, the eventual Privilege OAuth client secret, and any bearer token used in phase 1 all stay in a gitignored `librechat/.env`.
- Not part of the always-running `ai-demo-*` docker-compose stack — see §2.

## 2. Deployment scope

A standalone, opt-in stack under `librechat/`:

- `librechat/docker-compose.yml` — the LibreChat app container plus MongoDB (LibreChat's required datastore), pinned to a MongoDB image that runs on Apple Silicon — the default image LibreChat ships requires AVX instructions that M-series Macs don't support and will crash on startup; this needs an explicit override, not the vendor default.
- `librechat/librechat.yaml` — endpoints and `mcpServers` config (see §3, §4).
- `librechat/.env` (gitignored) — Mongo URI, LibreChat's session/JWT secrets, and (from phase 2 onward) the Privilege OAuth client secret.

Kept deliberately outside `run-docker.sh`'s primary stack: this is exploratory client tooling, not a demo-facing service, and shouldn't become something every session's deploy/sync/restart has to account for (per this repo's existing "one stack, one owner" convention for the main compose).

## 3. LLM backend

LibreChat's custom OpenAI-compatible endpoint support, pointed at the repo's existing local LLM proxy on `:8090` (the same `demo_llm_proxy/` used elsewhere in this repo — oMLX/llama.cpp backend, frozen settings, tiers 8091+). No new API keys, no new cost. Reachability from inside LibreChat's Docker network to `:8090` on the host needs a quick check during implementation (likely `host.docker.internal`, consistent with how other containerized services in this repo reach host-run processes) — not assumed here.

## 4. Phase 1 — Agent Gateway (WebSocket), no new PingOne app

- `librechat.yaml` → `mcpServers.agent_gateway`: `type: websocket`, URL pointing at `demo_mcp_gateway`'s WS port (3005). Whether LibreChat's container reaches that port directly or needs a host-network/`host.docker.internal` route depends on how the gateway itself is currently run (native `./run.sh` vs. Dockerized) — confirm during implementation.
- Auth: a static bearer header (LibreChat's "User provides key" / custom-header MCP server auth) carrying an already-issued PingOne access token scoped to the gateway's audience — reusing whatever mechanism `langchain_agent`'s `MCPConnection` already uses to obtain one, not a new OAuth client registration. This is explicitly a short-lived proof step: the token needs manual refresh and is not the intended steady-state auth story. A real OAuth flow for this door (via LibreChat's RFC 9728 discovery, if the Agent Gateway exposes protected-resource metadata) is a natural phase-3 candidate, not required for this design.
- **Done when:** from LibreChat's chat UI, asking the model to call a real banking tool (`get_my_accounts`, Super Sports vertical) returns real data — proving the WS + RFC 8707 audience-bound path works through an off-the-shelf client with zero Agent Gateway server-side changes.

## 5. Phase 2 — Privilege (agentless), new PingOne app

- Only starts once phase 1 is proven.
- A new PingOne OAuth client gets registered for LibreChat specifically (client_id/secret, redirect_uri) — LibreChat expects a fixed, discoverable callback path under its own base URL; the exact value gets handed over once phase 1 is done, not guessed now.
- `librechat.yaml` → `mcpServers.privilege`: `type: streamable-http`, Privilege's agentless URL (`https://cmuir-agentless-mcpgw.ping-devops.com/<app>/mcp`), using LibreChat's native OAuth — RFC 9728 discovery if the Privilege gateway advertises protected-resource metadata, otherwise manual OAuth config with the registered client.
- **Done when:** the same tool call succeeds through the Privilege door, authenticated via LibreChat's built-in browser-based OAuth flow (not a static token).

## 6. Error handling

- MongoDB startup crash on Apple Silicon (AVX): addressed up front via the pinned/override image in §2, not discovered mid-implementation.
- WS connection failure from LibreChat's container to the gateway: verify host/network reachability before assuming the transport itself is broken — this is a known trap (Docker networking, not MCP protocol) per this repo's existing worktree/Docker hazards.
- Phase 1's static bearer token expiring mid-session: expected and acceptable for a proof step; not engineered around (that's what phase-3 OAuth-for-Agent-Gateway would fix, out of scope here).
- Privilege OAuth failures (wrong redirect_uri, bad client secret): surfaced from LibreChat's own OAuth error handling — no custom handling needed on our side.

## 7. Testing

Manual only, matching this repo's default-vertical convention (Super Sports):

1. Phase 1: LibreChat chat UI → ask for account data → confirm real data returned via the Agent Gateway WS path.
2. Phase 2: same prompt, second `mcpServers` entry active → confirm real data returned via Privilege-agentless, with the OAuth browser flow completing.

No unit tests — this is deployment/config of a third-party open-source app, not new code we own.

## 8. Open questions for the implementation plan

- Exact LibreChat services required to boot MCP support (can meilisearch/rag-api/vector-DB be omitted, or does LibreChat's compose assume them present even if unused features aren't invoked?).
- Concrete host/network path from LibreChat's container to `demo_mcp_gateway`'s WS port and to the `:8090` LLM proxy — depends on how the gateway is currently run in this environment.
- Whether LibreChat's RFC 9728 discovery actually fires against the Agent Gateway's resource metadata (if the gateway exposes it) — if so, phase 1's static-token stopgap might be skippable entirely in favor of real OAuth from the start; worth a quick check before committing to the static-token approach in the plan.
