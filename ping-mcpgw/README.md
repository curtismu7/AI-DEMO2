# PingOne Privilege MCP Gateway (MCPGW)

Runs the PingOne Privilege proxy container — an inline MCP security gateway that
enforces just-in-time, least-privilege access and full session auditing for MCP servers.
It fronts the unchanged `mcp-server`; the `/privilege-mcp-client` page in the demo UI
is the client that drives it.

Port `8680`. Compose profile: `mcpgw`. Image: `public.ecr.aws/s7q1z8z4/privilege-proxy`.

| | URL |
|---|---|
| Local (Docker Compose) | `https://local.ping-devops.com:8680` |
| SE cluster (AWS) | `https://ai-demo.ping-devops.com/mcpgw` |

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
   printf '%s' 'eyJ...<full JWT>' > ping-mcpgw/config/proxy-token
   ```
   This file is gitignored and must never be committed.

### 2. Configure the MCP application (wizard MCP Config step)

If using the full wizard (Add via Wizard), fill in the MCP Config step:

| Field | Value |
|---|---|
| Gateway URL | `https://local.ping-devops.com:8680` |
| Cert Path | `/procyon/ssl` |
| Client ID | Use `PINGONE_MCP_GATEWAY_CLIENT_ID` from `demo_api_server/.env` |
| Client Secret | Use `PINGONE_MCP_GATEWAY_CLIENT_SECRET` from `demo_api_server/.env` |
| Auth URL | `https://auth.pingone.com/<env-id>/as/authorize` |
| Token URL | `https://auth.pingone.com/<env-id>/as/token` |
| User Info URL | `https://auth.pingone.com/<env-id>/as/userinfo` |
| UserID Claim | `sub` |

Replace `<env-id>` with `PINGONE_ENVIRONMENT_ID` from `demo_api_server/.env`.

### 3. TLS certificates — nothing to generate

The existing repo cert pair is mounted into the container:

```
certs/api.ping.demo+2.pem      → /procyon/ssl/mcpgw-cert.pem
certs/api.ping.demo+2-key.pem  → /procyon/ssl/mcpgw-key.pem
```

That cert already covers `local.ping-devops.com` and is valid until Oct 2028, so no
`ping-mcpgw/ssl/` directory is created and no private key is duplicated. In Compose
the service also carries a network alias of `local.ping-devops.com`, which is what
makes one cert-valid URL work for both the browser (via `/etc/hosts` and the
published port) and the BFF's server-side relay (via compose DNS).

### 4. Attach an MCP Server application

1. PingOne Privilege console → **AI Security > Agentic Apps** → **Add Application**.
2. Select the **MCP Server** tile → **Integrate**.
3. Set:
   - **Frontend URL**: `https://local.ping-devops.com:8680` (or
     `https://ai-demo.ping-devops.com/mcpgw` for the SE cluster)
   - **MCP Server URL**: `http://mcp-server:8080/mcp` (internal service DNS — same
     name in Compose and Kubernetes)
4. In **Mesh Cluster**, select the gateway you registered in step 1.
5. Configure tool/prompt/resource policy and bind to PingOne identities. Author the
   rule that produces the DENY here, and enable session recording.

## Key facts

- **Image**: `public.ecr.aws/s7q1z8z4/privilege-proxy` (hardcoded, not configurable)
- **Binary**: `/procyon/bin/cyonproxy -hostname <fqdn> -listen :8680`
- **Token**: `ENV_PROXY_TOKEN` env var, or file at `/procyon/ssl/proxy-token.data` (file preferred — the proxy writes back to it)
- **Proxy phones home** outbound to `grpc.privilege.pingone.com:443` — no inbound firewall holes needed
- **Default listen port**: `:8680` (flag `-listen`)
- **Token expiry**: ~1 year from wizard creation; decode the JWT `exp` claim to check

## Directory layout

```
ping-mcpgw/
  config/
    proxy-token          ← gitignored — JWT from the Privilege gateway wizard
    proxy-token.env      ← gitignored — ENV_PROXY_TOKEN=<jwt> for env_file use
    pingone.env.example  ← committed template (legacy OIDC approach)
  README.md
  .gitignore
```

## Where the wiring lives

| file | what it does |
|---|---|
| `docker-compose.yml` | `ping-mcpgw` service (profile `mcpgw`), mounts proxy-token as `/procyon/ssl/proxy-token.data` |
| `k8s/75-ping-mcpgw-deployment.yaml` | Deployment + ClusterIP Service on 8680, token from `ping-mcpgw-secrets` |
| `k8s/create-secrets.sh` | builds `ping-mcpgw-secrets` from `config/proxy-token` |
| `k8s/aws/se-ingress.yaml` | Ingress serving `/mcpgw` on the SE host, backend port 8680 |
| `demo_api_server/routes/privilegeMcpClient.js` | seeds the client page's default MCP URL from `PRIVILEGE_MCPGW_URL` |
