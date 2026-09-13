# librechat/ — standalone LibreChat MCP client stack

A standalone LibreChat + MongoDB Docker Compose stack, separate from this
repo's root `docker-compose.yml` / `run-docker.sh`. It exists to prove
this demo's MCP servers work against a real, unmodified, off-the-shelf MCP
client — LibreChat's own OAuth (RFC 9728 discovery + DCR + PKCE) against
the `demo_api_server` recording façade (`/mcp-facade/:door/mcp`,
`routes/mcpFacade.js`), never a fork of LibreChat itself.

Two targets, one compose file: the local docker stack (`api.ping.demo:3001`)
or the SE AWS cluster (`ai-demo.ping-devops.com`) — see "Docker vs pingaws"
below.

## First-time setup

1. **`.env`** — copy the example and fill in the generated secrets:
   ```bash
   cd librechat
   cp .env.example .env
   sed -i '' "s|^JWT_SECRET=|JWT_SECRET=$(openssl rand -hex 32)|" .env
   sed -i '' "s|^JWT_REFRESH_SECRET=|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" .env
   sed -i '' "s|^CREDS_KEY=|CREDS_KEY=$(openssl rand -hex 32)|" .env
   sed -i '' "s|^CREDS_IV=|CREDS_IV=$(openssl rand -hex 16)|" .env
   sed -i '' "s|^OPENID_SESSION_SECRET=|OPENID_SESSION_SECRET=$(openssl rand -hex 32)|" .env
   ```
   `.env` is gitignored — do this before the first `up`, not after. If you skip it,
   Docker silently auto-creates an **empty directory** at `librechat/.env` instead of
   erroring, and every later `up` fails with `error mounting ".../.env" to rootfs at
   "/app/.env": not a directory`. Fix: `rmdir librechat/.env`, then do the steps above.

   `OPENID_CLIENT_SECRET` and the `PRIVILEGE_MCP_CLIENT_ID`/`_SECRET` fields stay
   blank unless you specifically need PingOne login for LibreChat's own account
   system (see `.env.example`'s comments) — local email/password
   (`ALLOW_REGISTRATION=true`) is enough to reach the chat UI and drive every MCP
   door's own OAuth.

2. **TLS trust** — `mkcert-rootCA.crt` is checked into this repo (a CA's public
   cert, not its private key, so this is safe to share) and already wired into
   `docker-compose.yml`'s `NODE_EXTRA_CA_CERTS`. It only works if it matches
   the mkcert CA your machine's `demo_api_server` cert was issued from — if
   LibreChat's outbound HTTPS to the façade fails TLS verification, regenerate
   it from your own `mkcert -CAROOT` and re-copy over `librechat/mkcert-rootCA.crt`.
   `procyon-tenant-root.crt` is vestigial — an earlier design had LibreChat
   trust the Priv Agent's own CA directly; the façade owns that connection now
   on its own trust config, so this file is unused, not a setup step.

3. **Start the stack**:
   ```bash
   cd .. # repo root
   docker compose -f librechat/docker-compose.yml up -d # force-compose
   ```
   The `# force-compose` comment is required — a repo-wide hook blocks raw
   `docker compose up` to protect the *main* demo stack (`ai-demo-*`
   containers) from concurrent-session name collisions. This stack's
   containers (`librechat`, `librechat-mongodb`) don't collide with anything
   there and aren't managed by `run-docker.sh` at all, so the escape hatch is
   the correct, intended way to start it — not a workaround.

   UI: `http://localhost:3080`.

4. **Demo agents** (optional, so presenters don't have to know what to type):
   ```bash
   node librechat/seed-demo-agents.js
   ```
   Creates public agents — Everyday Banking, Money Movement, Support and
   Fees, Super Sports, Super Sports Gear & Rentals, Super Sports Orders &
   Loyalty, Super Sports Stores & Code — each on PingOne Privilege (OpenAI) /
   `gpt-4o-mini` with a few `aidemo-mcp` tools and four clickable starter
   prompts. Pick one in the agent selector and click a prompt. Re-run it to
   update them in place. The three "Super Sports …" data agents read the
   seeded Super Sports store through the BFF vertical-tool relay.
   Every click is a real OpenAI call billed to the Privilege virtual key, and
   Money Movement changes the demo balances.

   It also creates Super Sports Policy Guardrails (on `super-sports-gateway`)
   and three OpenSearch agents — OpenSearch · Direct, OpenSearch · via
   Privilege, OpenSearch · Privilege opensearch22 — with the same three
   starters, one per door.

   Banking and CareConnect (healthcare) agents: Banking Account Details,
   CareConnect Health Data, CareConnect Coverage & Claims and CareConnect
   Actions run on `aidemo-mcp` (no sign-in; CareConnect Actions changes the
   seeded store until the BFF restarts). Banking Policy Guardrails and
   CareConnect Policy Guardrails reuse `super-sports-gateway`: reads are
   permitted, transfers and record releases are denied by policy. Before using
   the gateway and Privilege agents:
   - **Connect once** per LibreChat user to `super-sports-gateway`,
     `opensearch-privilege-gateway` and `privilege-opensearch22` (MCP settings →
     Connect → PingOne login). `opensearch-privilege-gateway` also needs the
     façade's Privilege leg signed in at `/privilege-mcp-client`.
   - **Start the port-forward** for OpenSearch · Direct:
     `kubectl --context us -n ping-devops-curtismuir port-forward svc/opensearch-mcp-server 9900:80`.
   - The `oauth-loopback` sidecar shares the api container's network, so after
     recreating `librechat`, run
     `docker compose -f librechat/docker-compose.yml up -d oauth-loopback` too.

## Docker vs pingaws

`librechat.yaml` targets the local docker stack by default: `aidemo-mcp`,
`super-sports-gateway`, the three OpenSearch doors — see "Known door caveats"
below. To point at the SE AWS cluster instead:
```bash
LIBRECHAT_CONFIG=librechat.pingaws.yaml docker compose -f librechat/docker-compose.yml up -d # force-compose
```
This swaps which config file `CONFIG_PATH` loads (LibreChat's own documented
selector — no fork). The pingaws variant drops two doors that are host-local
only with no cluster equivalent (`aidemo-mcp`, `opensearch-direct`) — see
`librechat.pingaws.yaml`'s own header comment.

Switching an **already-running** container needs an explicit restart —
`docker restart librechat` — since `CONFIG_PATH` and the mounted `.env` are
read once at Node startup; changing them and re-running `up -d` alone won't
recreate a container whose compose-level config didn't change.

## Known door caveats

| Door | Docker target | pingaws target |
|---|---|---|
| `aidemo-mcp` | works (auth-disabled local mcp-server) | not offered — host-local only |
| `super-sports-gateway` | works once each user Connects (PingOne login); the façade's `localhost:3005` sign-in server is reached through the `oauth-loopback` sidecar | not offered |
| `opensearch-direct` | works while the Mac port-forward runs: `kubectl --context us -n ping-devops-curtismuir port-forward svc/opensearch-mcp-server 9900:80` (no auth) | not offered — Mac-only port-forward |
| `privilege-opensearch22` | works once each user Connects; LibreChat signs in against the Privilege gateway's own OAuth server (public host, no sidecar) | not offered |
| `opensearch-privilege-gateway` | works once each user Connects (through the `oauth-loopback` sidecar) and the façade's Privilege leg is signed in at `/privilege-mcp-client` | works — replaced `opensearch-privilege-agent` on 2026-09-05. That entry pointed at the deleted `agent` door, whose mesh frontend still resolved while nothing served it; the Mac-local `:8643` reachability caveat it carried is moot now, since nothing routes that way |
| `privilege-agentless` | removed 2026-09-13 — addressed `ai-demo.ping-devops.com`, torn down with `ping-devops-cmuir` | works — verified live |
| `agent-gateway` | removed 2026-09-13 — same host as `privilege-agentless` | works — a 502 `upstream_unavailable` seen live 2026-08-25 was a routine `demo_mcp_gateway` rollout on the pingaws cluster catching this door mid-startup-probe (`kubectl -n ping-devops-cmuir get events` showed one `Unhealthy: connection refused` right after pod creation, then `2/2 Running` ~4s later) — not a bug. If this recurs, check `kubectl --context us -n ping-devops-cmuir get pods -l app=mcp-gateway` before assuming a LibreChat or façade problem |

A door showing `OAuth Required: true` at LibreChat startup is normal — it
means the façade answered its RFC 9728 discovery correctly and LibreChat
hasn't logged in yet, not an error. Only `Failed to inspect server "<door>"`
/ `upstream_unavailable` in `docker logs librechat` means the door itself is
actually unreachable.
