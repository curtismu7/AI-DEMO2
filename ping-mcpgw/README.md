# PingOne Privilege MCP Gateway (MCPGW)

Runs the PingOne Privilege MCPGW container — an inline MCP security gateway that
enforces just-in-time, least-privilege access and full session auditing for MCP servers.
It fronts the unchanged `mcp-server`; the `/privilege-mcp-client` page in the demo UI
is the client that drives it.

Port `8623`. Compose profile: `mcpgw`. Optional group: `mcpgw`.

| | URL |
|---|---|
| Local (Docker Compose) | `https://local.ping-devops.com:8623` |
| SE cluster (AWS) | `https://ai-demo.ping-devops.com/mcpgw` |

## Prerequisite that no test can cover

The deny decision and the session recording this demo shows are **authored in the
PingOne Privilege console**, not in this repo. Every check in the repo can pass
while the demo still shows nothing, because the policy that produces the DENY and
the recording toggle live in the console. Do the console steps below before
judging whether the demo works.

## Quick start

```sh
# Start the MCPGW alongside the core stack (needs MCPGW_IMAGE — see step 5)
./run-docker.sh optional start mcpgw
```

Stop it again without touching the core stack:

```sh
./run-docker.sh optional stop mcpgw
```

## Setup steps

### 1. Create the MCPGW application in PingOne

1. PingOne admin console → **AI Security > Agentic Apps** → add a new agent named `MCPGW`.
2. Toggle the application on.
3. In **Configuration**, register **both** Redirect URIs on this one application —
   local and SE cluster point at the same PingOne app:
   - `https://local.ping-devops.com:8623/callback`
   - `https://ai-demo.ping-devops.com/mcpgw/callback`
4. In **Resources**, add scopes: `openid`, `email`, `profile`.
5. Save and copy the **Client ID** and **Client Secret**.

### 2. Register the gateway in PingOne Privilege

1. PingOne Privilege admin console → **Cloud > Gateways** → **Add New > Add via Wizard**.
2. Follow the wizard: provide a **Proxy Cluster Name** and **FQDN / Host IP**.
3. The wizard generates a Docker run command — the image tag it provides is what you
   set as `MCPGW_IMAGE` (step 5).

### 3. Configure the OIDC environment file

```sh
cp ping-mcpgw/config/pingone.env.example ping-mcpgw/config/pingone.env
# Edit pingone.env — fill in OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, <env-id>, SERVER_URL
```

`ping-mcpgw/config/` is mounted read-only into the container at
`/var/lib/procyon/config`. The vendor reads `pingone.env` **as a file** at that
path — the values are not injected as environment variables, so do not also list
them under `environment:` in `docker-compose.yml`.

On the SE cluster the same file becomes the `ping-mcpgw-secrets` Kubernetes secret
(one key, the whole file) via `k8s/create-secrets.sh`, mounted at the same path.
`pingone.env` is gitignored and must never be committed.

### 4. TLS certificates — nothing to generate

The existing repo cert pair is mounted straight into the container:

```
certs/api.ping.demo+2.pem      → /var/lib/procyon/ssl/mcpgw-cert.pem
certs/api.ping.demo+2-key.pem  → /var/lib/procyon/ssl/mcpgw-key.pem
```

That cert already covers `local.ping-devops.com` and is valid until Oct 2028, so no
`ping-mcpgw/ssl/` directory is created and no private key is duplicated. In Compose
the service also carries a network alias of `local.ping-devops.com`, which is what
makes one cert-valid URL work for both the browser (via `/etc/hosts` and the
published port) and the BFF's server-side relay (via compose DNS).

### 5. Set the image (from the Privilege wizard)

Put the wizard-provided image URI in the **root `.env`**, which Compose reads
automatically:

```sh
# in /.env
MCPGW_IMAGE=<image URI from the Privilege gateway wizard>
```

There is deliberately no default. An unset `MCPGW_IMAGE` fails the Compose run
with `set MCPGW_IMAGE from the PingOne Privilege gateway wizard` rather than
silently pulling something wrong. For Kubernetes, replace
`MCPGW_IMAGE_PLACEHOLDER` in `k8s/75-ping-mcpgw-deployment.yaml` with the same URI.

### 6. Attach an MCP Server application

1. PingOne Privilege admin console → **AI Security > Agentic Apps** → **Add Application**.
2. Select the **MCP Server** tile → **Integrate**.
3. Set:
   - **Frontend URL**: `https://local.ping-devops.com:8623` (or
     `https://ai-demo.ping-devops.com/mcpgw` for the SE cluster)
   - **MCP Server URL**: `http://mcp-server:8080/mcp` (internal service DNS — same
     name in Compose and Kubernetes)
4. In **Mesh Cluster**, select the gateway you registered in step 2.
5. Configure tool/prompt/resource policy and bind to PingOne identities. Author the
   rule that produces the DENY here, and enable session recording.

## Directory layout

```
ping-mcpgw/
  config/
    pingone.env          ← gitignored — your real OIDC credentials
    pingone.env.example  ← committed template
  README.md
  .gitignore
```

## Where the wiring lives

| file | what it does |
|---|---|
| `docker-compose.yml` | `ping-mcpgw` service (profile `mcpgw`), plus `PRIVILEGE_MCPGW_URL` on the BFF |
| `run-docker.sh` | registers `mcpgw` as an optional group |
| `k8s/75-ping-mcpgw-deployment.yaml` | Deployment + ClusterIP Service on 8623 |
| `k8s/create-secrets.sh` | builds `ping-mcpgw-secrets` from `config/pingone.env` |
| `k8s/aws/se-ingress.yaml` | second Ingress object serving `/mcpgw` on the SE host |
| `demo_api_server/routes/privilegeMcpClient.js` | seeds the client page's default MCP URL from `PRIVILEGE_MCPGW_URL` |
