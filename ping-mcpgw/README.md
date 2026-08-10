# PingOne Privilege MCP Gateway (MCPGW)

Runs the PingOne Privilege proxy container — an inline MCP security gateway that
enforces just-in-time, least-privilege access and full session auditing for MCP servers.
It fronts the unchanged `mcp-server`; the `/privilege-mcp-client` page in the demo UI
is the client that drives it.

MCP frontend port `8620`. Compose profile: `mcpgw`. Image: `public.ecr.aws/s7q1z8z4/privilege-proxy`.

Clients reach it through nginx, never the proxy port directly:

| | URL |
|---|---|
| Local — app `MCP-aidemo` | `https://MCP-aidemo.mcpgw.local.ping-devops.com/mcp` |
| Local — app `mcp-pingone-admin` | `https://mcp-pingone-admin.mcpgw.local.ping-devops.com/mcp` |
| Local — legacy, rewritten by nginx | `https://aidemo.mcpgw.local.ping-devops.com/mcp` |
| SE cluster (AWS) | `https://aidemo.mcpgw.ai-demo.ping-devops.com/mcp` |
| Gateway base (`SERVER_URL`) | `https://mcpgw.local.ping-devops.com` |

**nginx rewrites every client hostname to the app's registered Frontend Name**
(`<app-name>.default.applications.procyon.ai:8643`) — the only Host this gateway build
routes on, proven end to end 2026-08-10 (initialize → 238 tools → tools/call). The
per-app client hosts in the table are named after their app purely for readability;
each one has a map line in `nginx.conf` doing the rewrite. Anything unmapped gets
`Domain not found` and an empty `200`. Adding an MCP application = one map line + one
`/etc/hosts` line. Full account: `docs/PRIVILEGE-MCP.md` §2026-08-10 (final).

## Prerequisite that no test can cover

The deny decision and the session recording this demo shows are **authored in the
PingOne Privilege console**, not in this repo. Every check in the repo can pass
while the demo still shows nothing, because the policy that produces the DENY and
the recording toggle live in the console. Do the console steps below before
judging whether the demo works.

## Quick start

```sh
# Start the MCPGW alongside the core stack
docker compose --profile mcpgw up -d ping-mcpgw
```

Stop it again without touching the core stack:

```sh
docker compose --profile mcpgw stop ping-mcpgw
```

## Setup steps

### 1. Register the gateway in PingOne Privilege

1. PingOne Privilege console → **Cloud > Gateways** → **Add New > Add via Docker**.
2. Enter **Proxy Cluster Name** (e.g. `ai-demo-se`) and **FQDN / Host IP**: `local.ping-devops.com`.
3. The wizard shows a `docker run` command containing `ENV_PROXY_TOKEN=eyJ...`.
4. Extract the token value and save it:
   ```sh
   printf '%s' 'eyJ...<full JWT>' > ping-mcpgw/procyon/config/proxy-token
   ```
   This file is gitignored and must never be committed.

### 2. Front-end PingOne credentials — `pingone.env`

**This is the config that authenticates CLIENTS to the gateway.** PingOne is the OAuth
server; the gateway is an MCP server in front of ours. A client calls the gateway, gets
a `401`, is sent to PingOne to sign in, and comes back with a token the gateway accepts.
`pingone.env` holds the PingOne credentials that make that possible.

Do not confuse it with the backend hop — see the table under "Two auth boundaries" below.

`ping-mcpgw/procyon/config/pingone.env` (copy `pingone.env.example`):

| Key | Value |
|---|---|
| `SERVER_URL` | `https://mcpgw.local.ping-devops.com` — the nginx front door, browser-reachable. This is what the `401` challenge hands the client, so it must not be a proxy port |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | the PingOne application the gateway signs users in against |
| `OIDC_AUTH_URL` | `https://auth.pingone.com/<env-id>/as/authorize` |
| `OIDC_TOKEN_URL` | `https://auth.pingone.com/<env-id>/as/token` |
| `OIDC_USER_URL` | `https://auth.pingone.com/<env-id>/as/userinfo` |
| `OIDC_SCOPES` | `openid profile email` |

Register `${SERVER_URL}/callback` as a redirect URI on that PingOne application.

`docker-compose.yml` both bind-mounts this file at
`/var/lib/procyon/config/pingone.env` and loads it via `env_file`, so its values reach
the container as files *and* as environment variables.

> **Update (2026-08-10):** the front-end OAuth config does **not** come from this file
> in the current build. It lives on the Privilege Application object and is set with
> `cyctl` (`--spec-mcp-app-config-resource-o-auth-*`, `--spec-mcp-app-config-entry-path`,
> `--spec-oidc-relying-party-redirect-ur-ls-elems`) — not exposed in the console UI.
> Keep this file correct anyway; the native-install guest agent reads the same settings.
> Note `use-pkce` is mandatory: PingOne app `deff60f5` enforces `S256_REQUIRED`.
> See `docs/PRIVILEGE-MCP.md` §2026-08-10.

> **Open issue (2026-08-09):** with all of the above in place the gateway still returns
> `401 Bearer Token not found.` and emits no `WWW-Authenticate`. The proxy binary
> contains no reference to `pingone.env` or its key names, and the same failure
> reproduces on Ping's own hosted frontend. The component that consumes this config
> appears to be the **guest agent**, which ships only with the native installer and is
> not in the Docker image (`/procyon/bin/` has just `cyctl` and `cyonproxy`). See
> `docs/PRIVILEGE-MCP.md` §2026-08-09 and `procyon-guest-agent.env`, which carries the
> same settings under different key names plus the `APIKey`/`APISecret` the agent uses
> to register them with the control plane.

### Two auth boundaries — do not mix them up

| Hop | Configured in | Current setting |
|---|---|---|
| **Client → MCPGW** (front end) | `pingone.env` (this section) | PingOne OIDC |
| **MCPGW → our MCP server** (back end) | the MCP Application in the console: MCP Server URL, Auth Mode, Auth Token | Static Token with an **empty** value — `mcp-server` runs `MCP_AUTH_DISABLED=true`, so the internal hop is deliberately open and Privilege enforces policy at its own layer |

The console's MCP Application screen has no front-end fields at all, which is the
quickest way to tell the two apart while you are in there.

### 3. TLS certificates — generated, then mounted

The gateway's serving certificate for its `-listen` frontend:

```
certs/mcpgw-wildcard.pem      → /procyon/ssl/mcpgw-cert.pem
certs/mcpgw-wildcard-key.pem  → /procyon/ssl/mcpgw-key.pem
```

Privilege looks for exactly those two file names. The vendor's `docker run` maps
host `/var/lib/procyon/ssl` to container `/procyon/ssl`, which is why Ping's SE
material calls them `/var/lib/procyon/ssl/mcpgw-{cert,key}.pem`.

`scripts/ensure-mcpgw-certs.sh` creates the pair (wildcard mkcert over
`*.mcpgw.local.ping-devops.com`); `run-docker.sh` runs it before this profile
starts. The core stack's `certs/api.ping.demo+2.pem` is **not** usable here — it
does not cover the `*.mcpgw.` frontend hosts.

> Earlier revisions of this section described the `api.ping.demo+2` pair as
> already mounted. It never was — `docker-compose.yml` carried no such mount, so
> the listener had no server certificate and answered TLS by demanding a client
> certificate instead. Symptom: `502` from nginx with
> `tlsv13 alert certificate required` in its error log.

### 4. Attach an MCP Server application

1. PingOne Privilege console → **AI Security > Agentic Apps** → **Add Application**.
2. Select the **MCP Server** tile → **Integrate**.
3. Set:
   - **MCP Server URL**: `http://mcp-server:8080/mcp` (internal service DNS — same
     name in Compose and Kubernetes). This is the **backend**
   - **Auth Mode**: Static Token, token empty — this is upstream auth to our MCP
     server, which runs `MCP_AUTH_DISABLED=true`
4. In **Mesh Cluster**, select the gateway you registered in step 1.
5. There is **no Frontend field in the create modal.** The console assigns
   `<app>-app-default.applications.privilege.pingone.com:8643` on save, which is
   mesh mode. See `docs/PRIVILEGE-MCP.md` for why mesh cannot work here.
6. Configure tool/prompt/resource policy and bind to PingOne identities. Author the
   rule that produces the DENY here, and enable session recording.

## Key facts

- **Image**: `public.ecr.aws/s7q1z8z4/privilege-proxy` (hardcoded, not configurable)
- **Binary**: `/procyon/bin/cyonproxy -hostname <fqdn> -listen :8623` (MCP serves on `-alp-port` 8620)
- **Token**: `ENV_PROXY_TOKEN` env var, or file at `/procyon/ssl/proxy-token.data` (file preferred — the proxy writes back to it)
- **Proxy phones home** outbound to `grpc.privilege.pingone.com:443` — no inbound firewall holes needed
- **MCP frontend port**: `:8620` (flag `-alp-port`). `-listen` (default `:8680`, we
  set `:8623`) is the **mesh** port and speaks mTLS — see `docs/PRIVILEGE-MCP.md`
- **Token expiry**: decode the JWT `exp` claim to check. An expired token does not
  stop an already-enrolled proxy — see `RENEW-TOKEN.md`

## Directory layout

`ping-mcpgw/procyon/` is bind-mounted **whole** at `/var/lib/procyon`, same path on
both sides, matching the vendor's own run command (embedded in the `cyctl` binary):

```
-v /var/lib/procyon:/var/lib/procyon
```

Earlier revisions bound only `config/`, which placed `pingone.env` at the right path
but hid every sibling next to it. Add new proxy-side files under `procyon/`, not
`config/`, so the container sees them.

```
ping-mcpgw/
  procyon/                       ← mounted at /var/lib/procyon
    config/
      pingone.env                ← gitignored — real OIDC config (holds a secret)
      pingone.env.example        ← committed template
      proxy-token                ← gitignored — JWT from the gateway wizard
    procyon-guest-agent.env      ← gitignored — per-host guest agent config
    recordings/                  ← session recordings the proxy writes
  README.md
  RENEW-TOKEN.md
  .gitignore
```

Note: the console's **Get Docker Command** output omits the `/var/lib/procyon`
mount entirely, so a proxy enrolled straight from that command never sees this tree.

## Where the wiring lives

| file | what it does |
|---|---|
| `docker-compose.yml` | `ping-mcpgw` service (profile `mcpgw`), mounts proxy-token as `/procyon/ssl/proxy-token.data` |
| `k8s/75-ping-mcpgw-deployment.yaml` | Deployment + ClusterIP Service on 8620, token from `ping-mcpgw-secrets` |
| `k8s/create-secrets.sh` | builds `ping-mcpgw-secrets` from `procyon/config/proxy-token` + `procyon/config/pingone.env` |
| `k8s/aws/se-ingress.yaml` | Ingress serving `/mcpgw` on the SE host, backend port 8620 |
| `demo_api_server/routes/privilegeMcpClient.js` | seeds the client page's default MCP URL from `PRIVILEGE_MCPGW_URL` |
| `docs/PRIVILEGE-MCP.md` | end-to-end explainer: protocols per hop, flow diagrams, BFF endpoint reference, current known gaps |
