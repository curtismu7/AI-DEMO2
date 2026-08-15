# PingOne Privilege MCP Gateway Configuration

## Core setup flow

1. Create an **MCPGW OIDC application** in PingOne admin.
2. Prepare the gateway host with Docker plus config and TLS files.
3. Register the gateway in **Cloud \> Gateways** and start it with the generated Docker command.
4. Create an **MCP Server application** in **AI Security \> Agentic Apps**.
5. Attach the MCPGW mesh cluster to that MCP Server app.
6. Configure tool, prompt, and resource policy plus approvals.
7. Validate with an MCP client and review session and activity logs.

## Required host configuration

Create these paths on the gateway host:

- `/var/lib/procyon/config/pingone.env`
- `/var/lib/procyon/ssl/mcpgw-cert.pem`
- `/var/lib/procyon/ssl/mcpgw-key.pem`

Use environment values like:

```
SERVER_URL=https://<mcpgw-dns>:<port>
OIDC_CLIENT_ID=<id>
OIDC_CLIENT_SECRET=<secret>
OIDC_AUTH_URL=https://auth.<pingurl>pingone.com/<env>/as/authorize
OIDC_TOKEN_URL=https://auth.<pingurl>pingone.com/<env>/as/token
OIDC_USER_URL=https://auth.<pingurl>pingone.com/<env>/as/userinfo
OIDC_SCOPES=openid profile email
```

## Required prerequisites

- A PingOne tenant with **PingOne Privilege** enabled.
- Administrator access to the PingOne Privilege admin console.
- At least one backend MCP server to protect.
- One or more MCP clients such as Claude Desktop, Cursor, VS Code Copilot Chat, or similar MCP-compatible clients.
- A VM or host capable of running Docker.
- A DNS name for the gateway.

## Network and ports

Public guidance calls out:

- Access from MCP clients to the MCPGW ports.
- Outbound access from the MCPGW host to PingOne endpoints such as `grpc.pingone.com`.
- Add inbound port **8623** on the MCPGW VM.

Internal notes add:

- **8623/TCP** for inbound MCP traffic.
- **8690/TCP** for gateway-to-gateway communication and mesh cluster creation.
- Outbound HTTPS to `hydra.ping1.privilege.com` in some deployments.
- Validate connectivity from MCP clients to the MCP Gateway frontend.
- Validate connectivity from the gateway to the backend MCP server.

## PingOne admin configuration

### 1\) Create the MCPGW application

In the PingOne admin console:

- Go to **AI Security \> Agentic Apps**.
- Add a new agent.
- Give it a name such as `MCPGW`.
- Enable the application.
- In **Configuration**, set the redirect URI to:
  - `http://<mcpgwdns>:<port>/callback`
- In **Resources**, add these scopes:
  - `openid`
  - `email`
  - `profile`

### 2\) Register the gateway in PingOne Privilege

In the PingOne Privilege admin console:

- Go to **Cloud \> Gateways**.
- Click **Add New**.
- Click **Add via Wizard**.
- Follow the wizard to:
  - Review machine requirements and supported operating systems.
  - Install Docker and confirm it is running.
  - Provide the proxy cluster name and FQDN or host IP.
  - Create the environment file.
  - Install the proxy guest agent for your OS and architecture.
  - Run the generated Docker command to start MCPGW.

## MCP Server application configuration

Create an MCP Server application in **AI Security \> Agentic Apps** and configure:

- **Application Name**: for example `mcp-pingone-admin`
- **Frontend URL**: the client-facing MCPGW URL, for example `https://<mcpgw-dns>`
- **MCP Server URL**: the backend MCP server endpoint, including port and path, for example `https://mcp-server-internal:8080/mcp`
- **Headers**: optional custom HTTP headers to send to the MCP server
- **Mesh Cluster**: leave empty until the gateway is associated

Then open the new MCP Server app and set the **Mesh Cluster** to the one created during gateway registration.

## Policy configuration

In the MCP Server application policy controls, configure:

- Which **tools** are available.
- Optional **prompts** for guided flows.
- Optional **resource restrictions** by pattern or regex.
- Which **users or groups** can access the application.
- Whether **approval** is required for higher-risk tools.
- How long **time-bound access** remains valid before access must be requested again.

## Validation checklist

1. Configure a supported MCP client to point to the MCP Server application **Frontend URL**.
2. Initiate a connection or tool call.
3. Confirm the user is redirected through the expected OAuth 2.1 or OIDC flow on first use.
4. Confirm only authorized tools are visible in the MCP client.
5. Confirm tool calls are routed through the MCPGW to the backend MCP server.
6. In **Activity \> Session Logs**, verify the MCP session appears.
7. In **Activity \> Activity Logs**, verify the tool name, arguments, and progress tokens are captured.

## Practical deployment gotchas

Internal notes suggest these are important in real deployments:

- `SERVER_URL` appears to be required in practice.
- Mount `pingone.env` as a **file** at `/var/lib/procyon/config/pingone.env`.
- Kubernetes ingress may need **443 \-\> 8623** mapping.
- Some MCP client flows may need the **`/mcp` path** to trigger the expected OIDC behavior.
- Backend MCP authentication is still somewhat manual in some deployments and may rely on headers or static tokens that the gateway injects.

## Positioning note

Use **PingOne Privilege MCP Gateway** when the main requirement is governed MCP access for workforce or personal-assistant style MCP clients: approvals, time-bound access, credential protection, tool-level control, and auditability.

Use **PingGateway MCP Security Gateway** when the main requirement is downstream token mediation, programmable enforcement, or resource-server-style security semantics.

## Sources

- [Configuring MCP gateways | PingOne Privilege](https://docs.pingidentity.com/privilege/configuration/mcp-gateway.html)
- [MCP Gateway Install and Setup Additions](https://docs.google.com/document/d/1k2y2T_lvfFvK2REym4OJmppd-J7fHOkrTFn-FZvmd24)
- [MCP Privilege Gateway Technical Summary v3](https://docs.google.com/document/d/1twoWn9EgR2S_UBir0WdxCxLKLzrjhwuBFc3U5UKmz4o)
- [Privilege MCP Gateway and the Next Phase of Our Identity for AI Narrative](https://docs.google.com/document/d/13pXdr0GuRqoYgILmNepjsiowhE3V_4FONYavyYM8G0U)
