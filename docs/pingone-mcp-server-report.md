# PingOne MCP Server — Integration Report

> **⚠️ SUPERSEDED (2026-06-16).** This report describes the **old local** `pingone-mcp-server`
> stdio binary, which has been **removed**. Both Claude Code and the BFF now use PingOne's
> **hosted HTTP MCP server** at `https://api.pingone.{region}/v1/environments/{envId}/mcp`:
> - Claude Code → `.mcp.json` entry `pingone` (`type: http`, OAuth PKCE, callback port 7464).
> - BFF → `services/mcpPingOneHttpAdapter.js` (worker `client_credentials` token).
>
> Sections below are retained for historical context only.

> **Status (historical):** Installed — `pingone-mcp-server v0.0.2` (via Homebrew `pingidentity/tap`)
> **Source:** https://github.com/pingidentity/pingone-mcp-server
> **Preview software** — APIs and tools subject to change; not recommended for production environments.

---

## What It Is

The official PingOne MCP Server is a **Go binary** that exposes PingOne's Management API as MCP tools. It lets any MCP-compatible client (Claude Code, Cursor, VS Code Copilot, Claude Desktop) administer a PingOne tenant using natural language.

**It is not a customer-facing runtime component.** It is a developer/admin tool — think of it as a "management plane" complement to our existing "data plane" MCP servers (`demo_mcp_server`, `demo_mcp_gateway`).

---

## What It Can Do Today

Four tool collections (read-only by default; write requires `--disable-read-only`):

| Collection | Read Tools | Write Tools |
|---|---|---|
| `applications` | `list_applications`, `get_application` | `create_oidc_application`, `update_oidc_application` |
| `environments` | `list_environments`, `get_environment`, `get_environment_services` | `create_environment`, `update_environment`, `update_environment_services` |
| `populations` | `list_populations`, `get_population` | `create_population`, `update_population` |
| `directory` | `get_total_identities_by_environment` | — |

---

## How Authentication Works

The server uses **OAuth 2.0 Authorization Code + PKCE** (default) or **Device Authorization Grant** (headless/Docker).

1. On first tool use, a browser opens → user logs in to PingOne as themselves (an admin)
2. Token stored in **macOS Keychain** (or Windows Credential Manager / Linux Secret Service)
3. Subsequent calls reuse the cached token; auto-re-authenticates on expiry

**Key insight:** The MCP server inherits the **user's own PingOne admin roles** — the worker app itself has no roles. This means it's fully auditable as the human user.

---

## Prerequisites for Our Environment

We already have everything we need in PingOne:

| Requirement | Our Environment |
|---|---|
| PingOne environment ID | `01d89b06-66d5-430e-9f28-65636843788b` |
| PingOne region | `com` → `PINGONE_ROOT_DOMAIN=pingone.com` |
| Worker application | **Must create** — see setup below |

### Worker App We Need to Create

In PingOne Console → Applications → Applications → (+):

| Setting | Value |
|---|---|
| Name | `PingOne MCP Server` (or similar) |
| Type | **WORKER** |
| Grant Type | Authorization Code |
| PKCE Enforcement | S256_REQUIRED |
| Token Endpoint Auth | **None** |
| Redirect URI | `http://127.0.0.1:7464/callback` |
| Roles | **None** (inherits from authenticated user) |
| Access Control | `ADMIN_USERS_ONLY` |

Capture the **Client ID** after saving.

---

## Quick Setup for Claude Code

Once the worker app is created:

```bash
# Set env vars (replace <CLIENT_ID> with the worker app's client ID)
export PINGONE_MCP_ENVIRONMENT_ID="01d89b06-66d5-430e-9f28-65636843788b"
export PINGONE_AUTHORIZATION_CODE_CLIENT_ID="<CLIENT_ID>"
export PINGONE_ROOT_DOMAIN="pingone.com"

# Register with Claude Code
claude mcp add --transport stdio pingOne \
  --env PINGONE_MCP_ENVIRONMENT_ID=$PINGONE_MCP_ENVIRONMENT_ID \
  --env PINGONE_AUTHORIZATION_CODE_CLIENT_ID=$PINGONE_AUTHORIZATION_CODE_CLIENT_ID \
  --env PINGONE_ROOT_DOMAIN=$PINGONE_ROOT_DOMAIN \
  -- pingone-mcp-server run

# Verify
claude mcp list
```

Or add to [.mcp.json](../.mcp.json):

```json
{
  "mcpServers": {
    "pingone-admin": {
      "type": "stdio",
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "01d89b06-66d5-430e-9f28-65636843788b",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<CLIENT_ID>",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

**To enable write tools** (needed for creating/updating apps, environments, populations):

```json
"args": ["run", "--disable-read-only"]
```

---

## How We Can Use It — Concrete Use Cases for This Demo

### 1. Development Workflow (Highest Value)
Ask Claude Code to inspect or fix PingOne config without leaving the IDE:

> "List all applications in our environment and show me which have token_exchange grant type"
> "Show me the current redirect URIs for Demo Admin App"
> "What services are enabled in our environment?"
> "How many identities are in our environment this week vs last week?"

### 2. Onboarding New Developers
Instead of walking someone through the PingOne console manually:

> "Create a sandbox environment for my feature branch testing"
> "Show me all populations and which has the most users"

### 3. Demo Environment Maintenance
Before or after demos:

> "List all enabled applications" — quick sanity check
> "Get the config for Demo AI Agent app" — verify client IDs match .env

### 4. Post-Bootstrap Verification
After running `npm run pingone:bootstrap`, ask:

> "Confirm all 7 apps exist: Demo Admin App, Demo User App, Demo AI Agent, Demo MCP Gateway, Demo MCP Exchanger, Demo Worker Token App, Demo Agent"
> "Show me the grant types on Demo AI Agent — it should have authorization_code, client_credentials, token_exchange"

---

## What It Is NOT (Important Distinction)

| This server | Our existing MCP servers |
|---|---|
| Admin plane — manages PingOne config | Data plane — serves banking tools to end users |
| Runs locally, used by developers | Runs as services in `./run.sh` |
| Authenticates as a human admin via PKCE | Authenticates via RFC 8693 token exchange |
| Talks to `api.pingone.com/v1` (Management API) | Talks to BFF at `api.ping.demo:3001` |
| Tool for us building the demo | Part of the demo itself |

---

## Limitations (Preview Software)

- **No DaVinci, MFA, or custom domain tools yet** — limited to apps, environments, populations, directory
- **No resource server / scope management** — can't yet create/edit resource servers or scopes via MCP
- **Production environments blocked by default** — tools that write config/data are restricted on `PRODUCTION` type environments
- **Preview software** — APIs and tools may change without notice; don't use on live prod tenants

---

## Recommended Next Step

Create the worker app in PingOne and add the `pingone-admin` entry to [.mcp.json](../.mcp.json) (read-only mode by default is safe). This gives the entire dev team instant natural-language access to PingOne config inspection from Claude Code.
