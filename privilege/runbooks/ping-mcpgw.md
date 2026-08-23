# PingOne Privilege MCP Gateway (MCPGW)

Runs the current `privilege-mcpgw` / `mcpgw` gateway, an inline MCP security
gateway that enforces Privilege policy and session auditing for MCP servers. The
demo page at `/privilege-mcp-client` is a full Streamable HTTP MCP client.

The current SE deployments are documented separately in
[`../AGENTLESS-CONFIGURATION.md`](../AGENTLESS-CONFIGURATION.md) and
[`../AGENT-CONFIGURATION.md`](../AGENT-CONFIGURATION.md). Their client endpoints are:

| Mode | URL | Authentication |
|---|---|---|
| Agentless (`cmuir`) | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` | Gateway OAuth/PKCE |
| Agent (`cmuir2`) | `https://opensearch.default.applications.procyon.ai:8643/mcp` | Installed Privilege Agent |

The current image is `public.ecr.aws/s7q1z8z4/privilege-mcpgw` pinned at digest
`sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d`.
The public Agentless ingress terminates HTTPS and forwards to gateway port `8623`.

Sections below that discuss Compose, `privilege-proxy`/`cyonproxy`, port `8620`,
or Host rewriting describe the legacy local deployment and historical debugging.
Do not copy those values into the live SE Agentless release.

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
> See `privilege/PRIVILEGE-MCP.md` §2026-08-10.

> **Open issue (2026-08-09):** with all of the above in place the gateway still returns
> `401 Bearer Token not found.` and emits no `WWW-Authenticate`. The proxy binary
> contains no reference to `pingone.env` or its key names, and the same failure
> reproduces on Ping's own hosted frontend. The component that consumes this config
> appears to be the **guest agent**, which ships only with the native installer and is
> not in the Docker image (`/procyon/bin/` has just `cyctl` and `cyonproxy`). See
> `privilege/PRIVILEGE-MCP.md` §2026-08-09 and `procyon-guest-agent.env`, which carries the
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
   mesh mode. See `privilege/PRIVILEGE-MCP.md` for why mesh cannot work here.
6. Configure tool/prompt/resource policy and bind to PingOne identities. Author the
   rule that produces the DENY here, and enable session recording.

## Key facts

- **Image**: `public.ecr.aws/s7q1z8z4/privilege-proxy` (hardcoded, not configurable)
- **Binary**: `/procyon/bin/cyonproxy -hostname <fqdn> -listen :8623` (MCP serves on `-alp-port` 8620)
- **Token**: `ENV_PROXY_TOKEN` env var, or file at `/procyon/ssl/proxy-token.data` (file preferred — the proxy writes back to it)
- **Proxy phones home** outbound to `grpc.privilege.pingone.com:443` — no inbound firewall holes needed
- **MCP frontend port**: `:8620` (flag `-alp-port`). `-listen` (default `:8680`, we
  set `:8623`) is the **mesh** port and speaks mTLS — see `privilege/PRIVILEGE-MCP.md`
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

## Troubleshooting — auth failures

| Error (in BFF log or UI) | Root cause | Fix |
|---|---|---|
| `JWT signature validation failed` | `PRIVILEGE_MCPGW_URL` points at Privilege Cloud hosted frontend or PingOne directly. Neither emits `WWW-Authenticate`, so `discoverAuth()` falls back to PingOne OIDC → BFF exchanges at PingOne → PingOne-signed token → mcpgw rejects it | Set `PRIVILEGE_MCPGW_URL=https://ai-demo.ping-devops.com/mcpgw/<app-name>/mcp` (K8s mcpgw URL, which emits `WWW-Authenticate`) |
| `Token exchange failed: 401 invalid_client` | `OIDC_CLIENT_SECRET` in `pingone.env` is wrong. mcpgw tries to exchange the PingOne auth code at PingOne's token endpoint and PingOne rejects it. Confirm in mcpgw log: `Token exchange failed with status 401: {"error":"invalid_client",...}` | Copy `PRIVILEGE_SSO_CLIENT_SECRET` from `demo_api_server/.env` into `pingone.env` exactly. Watch for `l` (lowercase L) vs `I` (uppercase I) — visually identical in most fonts. Run `create-secrets.sh`, restart mcpgw. |
| `Unknown client` | MCPgw pod restarted and lost in-memory DCR client state. BFF still has the old cached `client_id` from before the restart. | Restart the BFF (`kubectl rollout restart deployment/demo-api-server -n <ns>`) to flush the DCR cache. Next `auth/start` registers a fresh DCR client with the new mcpgw instance. |
| `404 /mcp` (no WWW-Authenticate) | No MCP application registered in the Privilege console for this cluster. | Privilege console → AI Security > Agentic Apps > Add Application > MCP Server. Set backend to `http://mcp-server.<ns>.svc.cluster.local:8080/mcp`, Mesh Cluster = your gateway. The path mcpgw exposes becomes `/<app-name>/mcp`. |
| `502` on `/mcpgw/*` | Service `targetPort` mismatch, or mcpgw pod not ready. | Verify `service.yaml` has `targetPort: 8623` (not 8680). Check `kubectl get pods -n <ns> \| grep mcpgw` and startup probe. |

**Operational rule:** whenever mcpgw is restarted (upgrade, config change, crash), also restart the BFF. MCPgw holds DCR client registrations in memory only — any restart invalidates all clients, and the BFF cache won't know.

## OpenSearch belongs to Agent mode

Do not register or route OpenSearch through the current `cmuir` Agentless gateway.
The working OpenSearch application is the separate Agent use case:

- Privilege application: `cmuir2`
- Client URL: `https://opensearch.default.applications.procyon.ai:8643/mcp`
- Authentication: installed Privilege Agent
- Postman: MCP request, HTTP transport, no OAuth client ID and no bearer token

The old `cmuir-opensearch` Agentless experiment remains in older Postman folders
only as explicitly labelled history. It is not part of the current configuration.


## Where the wiring lives

| file | what it does |
|---|---|
| `docker-compose.yml` | `ping-mcpgw` service (profile `mcpgw`), mounts proxy-token as `/procyon/ssl/proxy-token.data` |
| `k8s/helm/mcpgw`, `k8s/aws/deploy.sh` | SE cluster: Helm-deployed `privilege-mcpgw` binary (mcpgw), swapped from cyonproxy 2026-08-13. mcpgw emits `WWW-Authenticate` OAuth challenge; cyonproxy did not. `k8s/75-ping-mcpgw-deployment.yaml` is the reference manifest the Helm chart mirrors |
| `k8s/create-secrets.sh` | builds `ping-mcpgw-secrets` from `procyon/config/proxy-token` + `procyon/config/pingone.env` — the SE Helm deploy reads `ENV_PROXY_TOKEN` back out of this same Secret |
| `k8s/aws/se-ingress.yaml` | Ingress serving `/mcpgw` on the SE host, backend `ping-mcpgw-mcpgw:80` (the Helm chart's Service) |
| `demo_api_server/routes/privilegeMcpClient.js` | seeds the client page's default MCP URL from `PRIVILEGE_MCPGW_URL` |
| `privilege/PRIVILEGE-MCP.md` | end-to-end explainer: protocols per hop, flow diagrams, BFF endpoint reference, current known gaps |
