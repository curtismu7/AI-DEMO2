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

## Docker vs pingaws

`librechat.yaml`'s `mcpServers` doors point at the local docker stack
(`api.ping.demo:3001`) by default. To point them at the SE AWS cluster
instead:
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
| `opensearch-direct` | works if the Mac kubectl port-forward (`:9900`) is running | not offered — Mac-only port-forward |
| `opensearch-privilege-agent` | works | **known-broken**: the façade reaches the Priv Agent over a Mac-local `:8643` listener; the pingaws-hosted façade (running in-cluster, not on the Mac) has no verified path to it — 502 `upstream_unavailable` is expected, not a bug to chase |
| `privilege-agentless` | works | works — verified live |
| `agent-gateway` | works | **intermittent** — 502 `upstream_unavailable` observed live 2026-08-25 even though this door doesn't depend on the Priv Agent (it fronts `demo_mcp_gateway`, in-cluster). Root cause not yet found — check whether `demo_mcp_gateway` is actually up in the pingaws namespace before assuming a LibreChat or façade bug |

A door showing `OAuth Required: true` at LibreChat startup is normal — it
means the façade answered its RFC 9728 discovery correctly and LibreChat
hasn't logged in yet, not an error. Only `Failed to inspect server "<door>"`
/ `upstream_unavailable` in `docker logs librechat` means the door itself is
actually unreachable.
