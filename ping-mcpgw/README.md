# PingOne Privilege MCP Gateway (MCPGW)

Runs the PingOne Privilege MCPGW container — an inline MCP security gateway that
enforces just-in-time, least-privilege access and full session auditing for MCP servers.

Port `8623`. Compose profile: `mcpgw`.

## Quick start

```sh
# Start the MCPGW alongside the core stack
docker compose --profile mcpgw up ping-mcpgw
```

## Setup steps

### 1. Create the MCPGW application in PingOne

1. PingOne admin console → **AI Security > Agentic Apps** → add a new agent named `MCPGW`.
2. Toggle the application on.
3. In **Configuration**, set the Redirect URI to `https://<mcpgw-dns>:8623/callback`.
4. In **Resources**, add scopes: `openid`, `email`, `profile`.
5. Save and copy the **Client ID** and **Client Secret**.

### 2. Register the gateway in PingOne Privilege

1. PingOne Privilege admin console → **Cloud > Gateways** → **Add New > Add via Wizard**.
2. Follow the wizard: provide a **Proxy Cluster Name** and **FQDN / Host IP**.
3. The wizard generates a Docker run command — the image tag it provides is what you
   should set as `MCPGW_IMAGE` in your shell or `.env` before running Compose.

### 3. Configure the OIDC environment file

```sh
cp ping-mcpgw/config/pingone.env.example ping-mcpgw/config/pingone.env
# Edit pingone.env — fill in CLIENT_ID, CLIENT_SECRET, env-id, and SERVER_URL
```

### 4. Install TLS certificates

Copy a certificate whose CN/SAN matches your `<mcpgw-dns>` into:

```
ping-mcpgw/ssl/mcpgw-cert.pem
ping-mcpgw/ssl/mcpgw-key.pem
```

For local dev with mkcert:

```sh
mkcert -cert-file ping-mcpgw/ssl/mcpgw-cert.pem \
       -key-file  ping-mcpgw/ssl/mcpgw-key.pem \
       <mcpgw-dns> localhost 127.0.0.1
```

### 5. Set the image (from the Privilege wizard)

Export the image URI the wizard provided, or set it in your shell before running Compose:

```sh
export MCPGW_IMAGE=docker.io/procyon/mcpgw:latest   # replace with wizard-provided image
```

### 6. Attach an MCP Server application

1. PingOne Privilege admin console → **AI Security > Agentic Apps** → **Add Application**.
2. Select the **MCP Server** tile → **Integrate**.
3. Set:
   - **Frontend URL**: `https://<mcpgw-dns>:8623`
   - **MCP Server URL**: e.g. `http://mcp-server:8080/mcp` (internal compose DNS)
4. In **Mesh Cluster**, select the gateway you registered in step 2.
5. Configure tool/prompt/resource policy and bind to PingOne identities.

## Directory layout

```
ping-mcpgw/
  config/
    pingone.env          ← gitignored — your real OIDC credentials
    pingone.env.example  ← committed template
  ssl/
    mcpgw-cert.pem       ← gitignored (*.pem root rule)
    mcpgw-key.pem        ← gitignored (*.pem root rule)
  README.md
  .gitignore
```
