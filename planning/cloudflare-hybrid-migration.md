# Cloudflare hybrid migration — compatibility sweep + plan

Status: DRAFT 2026-10-19. Scope chosen: **hybrid** (web + MCP on Workers, agents on Containers, LLM / Ping stack / observability stay in k8s behind a Tunnel). No code changed.

Evidence below is from grepping the repo (non-test source only). Cloudflare product limits are from memory and **must be re-verified before committing** (Containers instance sizes, disk, Workers AI model list, Workers `nodejs_compat` coverage).

## 1. What the sweep found

| Service | Lang | Blockers for Workers | Verdict |
|---|---|---|---|
| `demo_api_ui` | React/Vite + nginx | none — static. nginx `try_files` SPA fallback, per-location security headers, and 6 `proxy_pass` prefixes to the BFF (`/api/`, `/api/codegraph/`, `/a2a/`, `/mcp-facade/`, `/webhook/`, `/health`) | **Workers static assets** (`not_found_handling: single-page-application`, `_headers` file, Worker routes for the proxy prefixes) |
| `demo_api_server` (BFF) | Node/Express | `child_process` in 24 files (routes: pingcli, devTools, setupWizard, secretRotation, promptfoo, diagrams, codegraphProxy; services: containerDriftCheck, llamacppModelsService, pingoneProvisionService…); `/var/run/docker.sock` 11 refs; sqlite in 8 files (configStore, bankingDb…) + LMDB at `/app/data/persistent/lmdb`; `http2` bridge (`http2McpBridge.js`); WebSocket upgrade in `server.js`; `express-session` + `connect-redis`; own HTTPS listener | **Not Workers.** Containers at best — and several routes are k8s/Docker admin features that cannot work off-cluster. See §3. |
| `demo_api_resource_server` | Node/Express | none (express, prom-client) | **Workers** (small port) |
| `demo_mcp_proxy`, `demo_mcp_code_search`, `demo_hitl_service` | Node | no sqlite/ws/cp. code_search needs Weaviate (stays in k8s → Tunnel); hitl has a PVC (state to check) | **Workers** probably; per-service check |
| `demo_mcp_weather`, `demo_mcp_brave` | Node | each has 1 `child_process` use (likely stdio wrapper) | **Containers** until checked |
| `demo_mcp_resource_server` | Node | sqlite in 14 files + PVC, `ws` | Containers, or D1/DO-SQLite rewrite |
| `demo_mcp_gateway` | Node | `ws` in 15 files | Containers |
| `oauth-mcp` (verify it is the `mcp-server` image) | Node/TS | MCP SDK, `jose`, `@upstash/redis` (HTTP, Workers-friendly); `selfsigned`, `ws`, oauth-state PVC need checking | Best Workers candidate for MCP hosting; **verify build context first** |
| `demo_agent_service`, `demo_llm_proxy` | Node | agent: `ws`, SSE; llm_proxy: `child_process` ×4, SSE | Containers (llm_proxy could become Workers + AI Gateway later) |
| `langchain_agent`, `llamaindex_agent`, `demo_mcp_jwt_verifier`, `demo_mcp_promptguard` | Python | not Workers-runnable | Containers |

## 2. Stays in k8s (reached via Cloudflare Tunnel)

llama.cpp tiers + tier-manager + llamacpp-models (no GPU / multi-GB volumes), PingFederate, ping-gateway, ping-mcpgw, demo-mcpgw (vendor/JVM, PVCs), Weaviate/Tika/embeddings, Prometheus/Grafana/Loki/Alloy/Jaeger/Alertmanager, Procyon node sensor (needs a k8s node), NetworkPolicies, sealed-secrets, crash-loop CronJobs.

## 3. The BFF is the crux — revised recommendation

Earlier I suggested trying the BFF on Workers. The sweep says no. It is also the hub every other service calls over in-cluster TLS names (`https://demo-api-server:3001`, agent-service, hitl, mcpgw, PingFederate). Moving it away from the services it talks to puts every hop through a Tunnel.

Recommended order:
1. **Phase 1 — edge only.** UI on Workers static assets; Worker proxies `/api`, `/a2a`, `/mcp-facade`, `/webhook`, `/health` to the BFF **still in k8s** via Tunnel. Wins: global edge, atomic deploys, ends the ai-demo-ui crash-loop / "Server is restarting" class of problem for the UI.
2. **Phase 2 — MCP servers.** `oauth-mcp` / stateless Node MCP servers to Workers; stdio / sqlite / ws ones to Containers.
3. **Phase 3 — agents** to Containers.
4. **Phase 4 (decision, not default) — BFF.** Only after splitting out the Docker/k8s admin routes (they have no Cloudflare equivalent) and replacing sqlite/LMDB + Redis sessions with D1 / Durable Objects. This is a refactor, not a port.

## 4. Open questions (need the owner)

- Is `ping-devops.com` DNS on Cloudflare? If not, `ai-demo.ping-devops.com` cutover needs a delegated zone or a new hostname.
- Tunnel to which private names? In-cluster services use TLS with internal certs; hostnames must match or the Worker must skip verification.
- Auth coupling to re-test after the edge moves: hosted-access wall + Bearer-pass, pi.flow login (no redirect logins), CORS for `xaa.dev`, PingOne redirect URIs, the `oauth-bypass` ingress routes, e2e `storageState` seeding.
- Long-lived connections: ingress today allows 3600s read/send timeouts (SSE / WS). Confirm Worker/Tunnel behaviour for the same flows.
- Cost: Containers and Tunnel are metered; get a number before Phase 2.

## 5. Success criteria (Phase 1)

- UI served from Workers at a preview hostname; every route in `auth-requirements.json` loads; SPA deep links work; security headers match `nginx.conf`.
- Each of the 6 proxied prefixes returns the same status/body through Worker → Tunnel → BFF as through the current ingress (curl diff).
- Login, a streamed agent run (SSE) and a WebSocket connect work end to end on the preview hostname.
- k8s deploy path (`run-pingaws.sh`, `se-update-*.sh`) still works for the services that remain.

## 6. Not yet verified

`oauth-mcp` vs `mcp-server` build context; hitl-service PVC contents; weather/brave `child_process` purpose; Workers `nodejs_compat` coverage of `express` + `jose` + `jsonwebtoken`; every Cloudflare product limit quoted anywhere above.

## 7. Resume here (when picking this up)

State: sweep + plan only. Nothing built, no Cloudflare account/zone touched, no branch or PR.

First steps, in order:
1. Answer the §4 DNS question (is `ping-devops.com` on Cloudflare?) — it decides the Phase 1 hostname.
2. Close the §6 unverified items (cheap greps: `oauth-mcp` build context, hitl PVC, weather/brave `child_process`).
3. Re-verify Cloudflare limits against current docs (Containers, Workers `nodejs_compat`, Tunnel timeouts).
4. Phase 1 spike on a **preview** hostname only: `wrangler.toml` with static assets from `demo_api_ui/dist` + a Worker routing the six prefixes to the BFF over a Tunnel. Do it in a worktree (shared main checkout gets clobbered by concurrent sessions).
5. Run the §5 success checks before touching the live SE host.

Non-goals until Phase 1 passes: moving the BFF, agents, or anything in §2.
