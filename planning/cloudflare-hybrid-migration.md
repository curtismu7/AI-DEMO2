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
| `demo_mcp_weather`, `demo_mcp_brave` | Node | weather: 1 `child_process` use (stdio bridge). brave: **none** (corrected, see §6.3) | weather **Containers**; brave **Workers + DO for SSE, or Container** (§6.3) |
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
- Long-lived connections: ingress today allows 300s read/send timeouts on the app host and 3600s on the MCP host (`k8s/aws/se-ingress.yaml:82-83`, `:436-437`). Confirm Worker/Tunnel behaviour for the same flows.
- Cost: Containers and Tunnel are metered; get a number before Phase 2.

## 5. Success criteria (Phase 1)

- UI served from Workers at a preview hostname; every route in `auth-requirements.json` loads; SPA deep links work; security headers match `nginx.conf`.
- Each of the 6 proxied prefixes returns the same status/body through Worker → Tunnel → BFF as through the current ingress (curl diff).
- Login, a streamed agent run (SSE) and a WebSocket connect work end to end on the preview hostname.
- k8s deploy path (`run-pingaws.sh`, `se-update-*.sh`) still works for the services that remain.

## 6. Research (done 2026-10-20)

Repo evidence is cited `file:line` at commit `f14c7560` (origin/main) plus this branch. Cloudflare facts carry a doc URL.

**How Cloudflare facts were sourced.** The research sandbox's proxy returned 403 for every direct fetch of `developers.cloudflare.com` (WebFetch: `ENOTFOUND`; curl: `CONNECT tunnel failed, response 403`). Every Cloudflare number below therefore comes from WebSearch excerpts of the named doc page, retrieved 2026-10-20, **not** from reading the page. Treat each as **UNVERIFIED until someone opens the URL**. Search excerpts disagreed with each other in places; those are flagged.

### 6.0 Hard rules from the repo that this plan must not contradict

- Root `CLAUDE.md` (Watch out): sign-in works only on `local.ping-devops.com:4000` (passkey rp.id), and `authz:verify` fails if `auth-requirements.json` and App.js guards drift. A new Workers host is a new rp.id / cookie host: Phase 1 cannot reuse the existing passkeys on a preview hostname.
- `REGRESSION_PLAN.md:183`: the hosted-access gate lives in `k8s/aws/se-ingress.yaml` (ingress `auth-url`, `:108-109`) and the BFF; only four exact OAuth login/callback paths bypass it; "Public MCP hosts stay outside this browser gate". Moving the edge to Workers means re-implementing that perimeter, guarded by `npm run hosted-access:verify`.
- `REGRESSION_PLAN.md:185`: `/api/codegraph/` must keep `proxy_buffering off` + 300s timeouts, guarded by `scripts/check-codegraph-sse-nginx.js` and `k8s/smoke.sh` check 7. These guards read `demo_api_ui/nginx.conf` and the ingress. Phase 1 must keep nginx.conf and the guard until the Worker path has an equivalent check, not delete them.
- `REGRESSION_PLAN.md:188`: HITL receipt must be **single-use** via the consuming `POST /challenges/:id/verify`. Any HITL replacement must keep an atomic consume (see 6.2).
- `REGRESSION_PLAN.md` section 0 / `CLAUDE.md`: security headers and the UI hard rules apply to whatever serves `demo_api_ui`; `nginx.conf:17-18` notes that `add_header` inside a `location` drops server-level headers, so a Workers `_headers` file must be diffed per path, not per site.
- `oauth-mcp/CLAUDE.md:5-6`: edit `src/`, never `dist/`; registry changes must propagate to `mcp-tool-schemas.json` and `scope-topology.json` (`topology:verify`). A Workers port of the MCP server forks that registry unless it shares `src/tools`.
- `demo_api_server/CLAUDE.md:9`: BFF is `express-session` + `connect-redis` + LMDB. Consistent with section 3: BFF stays out of Workers.
- `demo_hitl_service`, `demo_mcp_weather`, `demo_mcp_brave` have **no** nested `CLAUDE.md` (checked: only root, `oauth-mcp`, `demo_api_ui`, `demo_api_server`, `demo_mcp_gateway`, `langchain_agent` have one), so only the root rules apply to them.

### 6.1 `oauth-mcp` vs `mcp-server`

- **`mcp-server` is not a directory.** `ls mcp-server` fails; the name is only the compose service, container, k8s Deployment and image name. `oauth-mcp/` is the only banking/OLB MCP server source.
- Compose: `docker-compose.yml:964-970` service `mcp-server` builds `context: ./oauth-mcp`, `dockerfile: Dockerfile`.
- Deploy script mapping: `se-update-code.sh:18` (`mcp  oauth-mcp -> ai-demo-mcp-server -> mcp-server`) and `se-update-code.sh:126` (`mcp) echo "oauth-mcp"`).
- k8s: `k8s/30-mcp-server-deployment.yaml:4,31` Deployment `mcp-server`, image `ai-demo-k8-mcp-server:latest`, port 8080 named `ws` (`:33-35`). Its comments call it "oauth-mcp's embedded authorization server" (`:62`). The `privilege/ai-demo-whole-stack/.../30-mcp-server-deployment.yaml` is a Helm copy of the same.
- **Build context** (`oauth-mcp/Dockerfile`): two stages, `node:22-alpine`; builder runs `npm install` then `npm run build:prod` (tsc) then `npm prune --production` (`:5-25`); production copies `dist/`, `node_modules`, `package*.json` and `scripts/health-check.js` (`:50-62`), runs as uid 1001, `EXPOSE 8080`, `CMD node dist/index.js` (`:68,79`). Context dir also holds `src/`, `tests/`, `openapi/`, `docs/`, two compose files, and stray notes (`banking_tool_updates.md`, `corrected_methods.md`).
- **There is no second build to differ from.** The only other "mcp-server" directory-like hits are `demo_mcp_pingone/Dockerfile` and `docker-compose.yml`, which mention it only as a string. Plan section 1 row 18 ("verify it is the `mcp-server` image") is therefore answered: yes.
- **Workers-fit correction (matters for section 1's "best Workers candidate").** `oauth-mcp` is a WebSocket **server**, not just an HTTP MCP endpoint:
  - `oauth-mcp/src/server/DemoMCPServer.ts:3,6,77` ("WebSocket server implementation", `import WebSocket from 'ws'`, `WebSocket.Server`); the BFF reaches it with `MCP_SERVER_URL: ws://mcp-server:8080` (`docker-compose.yml:529`) and `REGRESSION_PLAN.md:247` lists it as `ws://localhost:8080`.
  - It also opens `https.createServer` (`DemoMCPServer.ts:215`), `http.createServer` (`:251`, `:282`), and `http2.createSecureServer` (`:305`, `:9`), and generates certs with `selfsigned` (`:12`, `:210`, `:300`).
  - Token/session state is files: `oauth-mcp/src/storage/EncryptedTokenStorage.ts:29,59,68` (`fs.mkdir/writeFile/readFile`) on a 1 GiB PVC (`k8s/31-mcp-server-oauth-state-pvc.yaml`, mounted at `/app/data` per its header). Losing it makes RFC 7591 clients see `Unknown client_id` (same file, header comment).
  - It also serves legacy HTTP+SSE (`src/server/HttpMCPTransport.ts:12-16,77,82`, 25s keepalive, max 64 streams).
  - It is public-facing for OAuth: `k8s/aws/oauth-mcp-public-ingress.yaml` (host `cmuir-mcp.ping-devops.com`, CORS `https://xaa.dev`).
  - `jose` and `@upstash/redis` (`oauth-mcp/package.json`) are Workers-friendly; `ws`, `selfsigned`, `fs` storage and `http2` are not (see 6.4). **Verdict: Workers needs a rewrite of the transport and storage layers, not a port; the `/token`, `/jwks`, `/.well-known/*` and `/protected/profile` HTTP surface is the only slice that could move cheaply. Recommend Containers for the whole server first.** This contradicts the section 1 row 18 verdict ("Best Workers candidate"); left unedited there because it is a judgement, not a cross-reference.

### 6.2 `demo_hitl_service` state and replacement

- **State persisted:** one JSON file of challenge records, `HITL_CHALLENGE_STORE_FILE=/app/data/challenges.json` (`docker-compose.yml:1599`, `k8s/62-hitl-service-deployment.yaml:73`), on volume `ai-demo-hitl-data` (`docker-compose.yml:1620`, `:2653`) / PVC `hitl-challenges`, 1 GiB, mounted at `/app/data` (`k8s/62-hitl-service-deployment.yaml:6-19,84-89`). Without the volume a rollout drops in-flight approvals (`:1-2`).
- **Record and lifecycle** (`demo_hitl_service/src/store/challengeStore.js:5-10`): `{id, tool, userId, agentId, context, correlationId, status, createdAt, expiresAt, resolvedAt, decision}`; `pending -> approved|denied|expired`, `approved -> consumed` (single-use). TTL 10 min, cap 1000 records, resolved entries pruned after 1 h (`:21-22`, prune `:50-60`).
- **Access pattern:** in-memory `Map` loaded once at boot (`:25-33`); **whole file rewritten on every change** via temp file + `rename` (`:36-48`, comment: "fine at MAX_CHALLENGES small records"). Single writer, `replicas: 1` (`k8s/62-hitl-service-deployment.yaml:29`); the file itself says two replicas need Redis or a DB (`:12-14`). Routes: `POST /challenges`, `GET /challenges/:id`, `POST /:id/verify` (consuming), `POST /:id/respond`, `GET /challenges` (`src/routes/challenges.js:47,81,111,137,191`), all behind a shared secret (`requireSecret`). Outbound: axios to PingOne CIBA and the BFF `/api/internal/hitl-notify` (`src/notifier.js:71,91`). Dependencies are `express`, `axios`, `uuid`, `pino`, otel (`package.json`): no sqlite, ws or child_process.
- **Replacement options (access pattern: tiny, short-lived, read-modify-write, must be single-use):**

| Option | Fit | Tradeoff |
|---|---|---|
| **Durable Object with SQLite storage** (one object, fixed name) | Best. Serialised access gives an atomic `approved -> consumed`; alarms can do the 10 min TTL and prune. 10 GB per object and 2 MB row limits dwarf the 1000-record cap (DO limits URL below). | One object is a single region and single point of serialisation; fine at demo volume. Needs the service rewritten from Express to a Worker. |
| **D1** | Works: `UPDATE ... SET status='consumed' WHERE id=? AND status='approved'` and checking changes gives single-use. 10 GB, 2 MB row (D1 limits URL). | Extra round trip; TTL pruning needs a cron trigger; less natural than DO for per-id serialisation. |
| **KV** | Poor. 1 write per second per key (KV limits URL) and the single-use check needs a consistent read-then-write. KV being eventually consistent is **UNVERIFIED** here (not in the excerpts retrieved). | Would violate `REGRESSION_PLAN.md:188` risk if consume is not atomic. |
| **R2** | Not suitable: object store, no conditional atomic status transition shown in the research. **UNVERIFIED** beyond that. | Overkill for ~1000 small records. |

- **Recommendation:** leave HITL in k8s for Phase 1 and 2 (nothing in the plan needs it moved; the BFF and gateway call it in-cluster, `docker-compose.yml:616`). If moved, use a DO with SQLite, keeping the same five routes so `demo_mcp_gateway/src/hitlClient.ts` is unchanged.

### 6.3 weather and brave tools

- **`demo_mcp_weather`: needs `child_process`.** `server.js:11` `require('node:child_process')`, `:27` `spawn(process.execPath, [CHILD_ENTRY], {stdio: ['pipe','pipe','inherit']})` launches the third-party `@dangahagan/weather-mcp@1.13.0` (`package.json:10`, stdio-only) as a long-lived child and bridges it to HTTP (`server.js:1-6`). It also respawns on exit (`:42-52`). The bridge exists because Agent Gateway needs an HTTP backend.
  - On Workers: `child_process` is only an import-time stub (Node-compat URL below), so the bridge cannot run. Options: (a) **Container** (keeps code as is; recommended); (b) rewrite as a Worker that calls the weather data API directly, which requires reading what `weather-mcp` fetches (not done: `node_modules` is absent and the package was not inspected, so its upstream API and any Node-only deps are **UNVERIFIED**); (c) stay in k8s.
- **`demo_mcp_brave`: no `child_process`.** The plan's section 1 claim was wrong; `server.js:2-3` says "No child-process bridge". It uses `node:http` (server, `:9`), `node:https` (outbound request to `api.search.brave.com`, `:51-85`), `node:zlib` gunzip (`:11,76`), `node:crypto` for ids (`:12`), and an in-memory `Map` of SSE sessions with 25 s keepalive (`:138-139`). Zero npm dependencies (`package.json`).
  - On Workers: the outbound call becomes `fetch()` (which decompresses transparently, so the manual `Accept-Encoding: gzip`/`zlib` goes; the transparent-decompression claim is general platform knowledge, **UNVERIFIED** against a doc here). `crypto.randomUUID()` is a Web API. The inbound server needs a rewrite to a `fetch` handler.
  - **The real obstacle is SSE state.** `GET /sse` and `GET /mcp` hold a stream open and register it in a process-local `Map` (`:138,166,181-183`) so that `POST /messages` can write to it. Across Worker isolates that Map is not shared, so the legacy SSE transport needs a Durable Object (or stays on a Container). The Streamable HTTP `POST /mcp` path is stateless and ports cleanly.
  - The PingOne Privilege discovery client requires the GET-then-SSE `endpoint` handshake (`server.js` comment above the `GET /sse` handler), so dropping SSE would break the Agentic App registration. Keep it.
  - Verdict: **Worker + Durable Object for SSE sessions is possible; Container is the zero-rewrite path.** Needs `BRAVE_SEARCH_API_KEY` as a Worker secret.

### 6.4 Cloudflare limits vs. what each service needs

Source columns: W = Workers limits https://developers.cloudflare.com/workers/platform/limits/ ; N = Node compat https://developers.cloudflare.com/workers/runtime-apis/nodejs/ ; DO = https://developers.cloudflare.com/durable-objects/platform/limits/ and https://developers.cloudflare.com/durable-objects/best-practices/websockets/ ; C = https://developers.cloudflare.com/containers/platform-details/limits/ ; T = https://developers.cloudflare.com/fundamentals/reference/connection-limits/ and https://developers.cloudflare.com/tunnel/reference/origin-parameters/. All fetched via search excerpt on 2026-10-20, **UNVERIFIED by direct read**.

Platform limits (as reported):

| Limit | Reported value | Source | Note |
|---|---|---|---|
| CPU time per HTTP request | Free 10 ms; Paid up to 5 min (default 30 s); I/O wait not counted | W | Excerpts of an older DO page said 30 s per message; verify |
| Memory | 128 MB per isolate, both plans | W | |
| Subrequests | Free 50, Paid 10,000 per request (Free: 1,000 to Cloudflare services) | W, Workflows limits page | |
| Simultaneous outbound connections | 6, counted only until response headers arrive (April 2026 change; main page may still use old wording) | W + changelog 2026-04-09 | Conflict between sources |
| Request body | By zone plan: 100 MB Free/Pro, 200 MB Business, 500 MB Enterprise | W | Enterprise up to 5 GB per a newer version; verify |
| Response body | No enforced limit | W | |
| WebSocket message | 32 MiB received (was 1 MiB until Oct 2025) | W changelog 2025-10-31 | |
| Worker bundle size | 3 MB Free / 10 MB Paid in one source, 64 MiB both in another | W | Conflict; verify |
| Plain-Worker long-lived sockets | Not held by a plain Worker; use Durable Object + Hibernation (idle ~10 s hibernates; non-hibernating evicted after 70-140 s idle); outbound WS keeps DO alive max 15 min; runtime updates give streams up to 20 min to finish | DO WebSockets / lifecycle pages | SSE specifically: **not found in docs retrieved, UNVERIFIED** |
| `nodejs_compat` | `fs` virtual and per-request ephemeral; `net.Socket` outbound only, **`net.Server` not supported**; `zlib` and `http`/`https` supported, `http.createServer` needs `enable_nodejs_http_modules` and compat date 2025-09-01+; **`http2` and `child_process` are import-only stubs**; `nodejs_compat` on by default from compat date 2026-08-04 | N + compat-flags page + changelog 2026-08-04 | `ws` server package on Workers is not addressed in any excerpt: **UNVERIFIED**, assume it needs the Workers native WebSocket API |
| Containers instance types | lite 1/16 vCPU 256 MiB 2 GB; basic 1/4 vCPU 1 GiB 4 GB; standard-1 1/2 vCPU 4 GiB 8 GB; standard-2 1 vCPU 6 GiB 12 GB; standard-3 2 vCPU 8 GiB 16 GB; standard-4 4 vCPU 12 GiB 20 GB; custom max 4 vCPU / 12 GiB / 20 GB | C + pricing page | Page copies disagree on custom disk ratio; a 2026-09-29 changelog removes the ratio cap |
| Containers storage | Container disk is per instance (sizes above); no persistent volume documented in excerpts | C | PVC-style state (oauth-state, SQLite) needs R2/DO/D1: **UNVERIFIED** whether any mount exists |
| Containers pricing | Memory 25 GiB-h included then $0.0000025/GiB-s; CPU 375 vCPU-min included then $0.000020/vCPU-s (active use); disk 200 GB-h included then $0.00000007/GB-s; egress $0.025/GB NA/EU, 1 TB incl. | https://developers.cloudflare.com/containers/pricing/ | Pricing page flagged ~180 days old; recheck |
| Tunnel / origin | Proxy idle timeout to origin 900 s (fixed, 520); proxy read timeout default 125 s, up to 6000 s on Enterprise (524); cloudflared keepAlive 1m30s, connect 30 s | T | No 100 s figure found; the often-quoted 100 s is **UNVERIFIED** and probably outdated |
| Worker to private origin | Workers VPC (beta, free on all plans in beta): Tunnel + VPC Service + `vpc_services` binding; needs cloudflared 2025.7.0+ and outbound UDP 7844 | https://developers.cloudflare.com/workers-vpc/ | New since the plan was drafted; use instead of a public Tunnel hostname if beta is acceptable |
| D1 | 10 GB Paid / 500 MB Free; 2 MB row; 100 KB statement | https://developers.cloudflare.com/d1/platform/limits/ | |
| DO SQLite | 10 GB per object; 2 MB row | DO | |
| KV | 25 MiB value, 512 B key, 1 write/s same key | https://developers.cloudflare.com/kv/platform/limits/ | |

Per-service comparison (need from this repo vs. platform):

| Service | What it needs (repo) | Against the limits | Verdict |
|---|---|---|---|
| `demo_api_ui` static | Static bundle; SPA fallback; per-path headers (`nginx.conf:17-19,40`) | Static assets limits (file count/size) **not researched: UNVERIFIED**; no CPU or memory issue | Fits, subject to asset-limit check |
| Worker edge proxy to BFF | 6 prefixes (`nginx.conf:53,63,84,111,131,151`); `/api/` and `/api/codegraph/` need 300 s, no buffering (`nginx.conf:76-77`, `se-ingress.yaml:82-83`); WebSocket upgrade headers (`nginx.conf:90-97`) | Response size unlimited and I/O wait not billed as CPU, so a streamed SSE through a Worker is plausible; 6 simultaneous outbound connections only count until headers; Tunnel/Workers-VPC idle behaviour for long streams is **UNVERIFIED** | Plausible; prove with the section 5 SSE test |
| `demo_api_server` BFF | `child_process` x24, docker.sock, sqlite, LMDB, `http2`, ws, own HTTPS (section 1) | `child_process`/`http2` stubs, no `net.Server`, ephemeral `fs`, 128 MB | Does not fit Workers (agrees with section 3) |
| `oauth-mcp` | ws server, http2, https + selfsigned, file storage on PVC, SSE streams (6.1) | `net.Server` unsupported, `http2` stub, `fs` ephemeral, 128 MB | Container; only the plain-HTTP OAuth endpoints could be a Worker |
| `demo_hitl_service` | Tiny JSON state, 5 routes, outbound HTTPS (6.2) | Fits with a DO/D1 rewrite; Express removed | Worker + DO feasible |
| `demo_mcp_brave` | Outbound HTTPS, SSE with in-memory sessions (6.3) | `fetch` OK; SSE session map needs DO | Worker + DO, or Container |
| `demo_mcp_weather` | spawn of stdio child (6.3) | `child_process` stub | Container |
| `demo_api_resource_server`, `demo_mcp_proxy` | Not re-checked beyond section 1 (express, prom-client) | Express on Workers under `nodejs_compat` is **UNVERIFIED**; `prom-client` uses Node APIs, **UNVERIFIED** | Per-service check still open |
| `demo_mcp_gateway` | ws x15 files, WebSocket + HTTP (`REGRESSION_PLAN.md:188`) | ws server not a plain-Worker pattern | Container (agrees with section 1) |

Still **UNVERIFIED** (carry into the spike): `express`, `jose`, `jsonwebtoken` behaviour under `nodejs_compat` (no excerpt covered them; `jose` is Web-Crypto based but that is not from a Cloudflare doc); Workers static-assets file limits; whether Containers can reach a Tunnel-fronted k8s service and at what latency; Containers persistent storage.

## 6a. Questions only the owner can answer

Do not guess these; each blocks a decision.

1. Is the `ping-devops.com` zone on Cloudflare DNS, and who administers it? If not, which hostname (new zone or delegated subdomain) hosts the preview?
2. Which private names should the Tunnel (or Workers VPC service) expose, and what are the tunnel names / account to create them in? In-cluster services use internal-cert TLS names (section 4).
3. Who re-tests auth after the edge moves: hosted-access wall + Bearer pass, pi.flow login, the passkey rp.id on a new host, PingOne redirect URIs, `xaa.dev` CORS, `oauth-bypass` ingress routes, e2e `storageState`? PingOne redirect URIs need an admin change.
4. Which long-lived flows must survive (SSE agent runs, Code Explorer 300 s, MCP host 3600 s, BFF-to-`ws://mcp-server` WebSocket), and what idle/duration is acceptable if Cloudflare cannot match 3600 s?
5. Cost ceiling and plan: is there a Workers Paid account, and what monthly number makes Containers / Tunnel / Workers VPC acceptable before Phase 2?
6. Is Workers VPC beta acceptable for a production-adjacent demo, or must Tunnel with public hostnames be used?
7. Should the hosted-access wall (`REGRESSION_PLAN.md:183`) be reproduced in a Worker, kept at an ingress, or replaced with Cloudflare Access? That is a security-policy decision.

## 7. Resume here (when picking this up)

State: sweep + plan only. Nothing built, no Cloudflare account/zone touched, no branch or PR.

First steps, in order:
1. Answer the §4 DNS question (is `ping-devops.com` on Cloudflare?) — it decides the Phase 1 hostname.
2. Close the §6 unverified items (cheap greps: `oauth-mcp` build context, hitl PVC, weather/brave `child_process`).
3. Re-verify Cloudflare limits against current docs (Containers, Workers `nodejs_compat`, Tunnel timeouts).
4. Phase 1 spike on a **preview** hostname only: `wrangler.toml` with static assets from `demo_api_ui/dist` + a Worker routing the six prefixes to the BFF over a Tunnel. Do it in a worktree (shared main checkout gets clobbered by concurrent sessions).
5. Run the §5 success checks before touching the live SE host.

Non-goals until Phase 1 passes: moving the BFF, agents, or anything in §2.
