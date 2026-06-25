# PingOne MCP Server Integration Plan

> **✅ COMPLETED, then SUPERSEDED (2026-06-16).** This plan wired the **local** `pingone-mcp-server`
> stdio binary into `.mcp.json` + bootstrap. That local binary has since been **removed** in favor
> of PingOne's **hosted HTTP MCP server** (`.mcp.json` entry `pingone`, `type: http`; BFF uses
> `services/mcpPingOneHttpAdapter.js`). Do **not** execute the steps below — they describe the
> retired stdio setup. Retained as a historical artifact.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the official `pingone-mcp-server` binary into this repo's developer tooling so any dev can ask Claude Code natural-language questions about the PingOne tenant (inspect apps, environments, populations) from day one — and optionally create/update config with write mode.

**Architecture:** The binary is already installed globally (`pingone-mcp-server v0.0.2` via Homebrew). We need one new PingOne Worker app (PKCE, no secret, no roles — inherits user's admin roles), then a new entry in `.mcp.json` so Claude Code loads it. We add the worker app to `bootstrapPingOne.js` so it's provisioned automatically on fresh setups, and document the flow in `PINGONE_CONFIG.md`.

**Tech Stack:** Go binary (`pingone-mcp-server`), PingOne Management API, `.mcp.json` (Claude Code MCP config), `demo_api_server/scripts/bootstrapPingOne.js` (Node.js provisioning script), `demo_api_server/services/pingoneProvisionService.js`.

---

## File Map

| File | Change |
|---|---|
| `.mcp.json` | Add `pingone-admin` server entry (read-only mode, env vars for our tenant) |
| `demo_api_server/scripts/bootstrapPingOne.js` | Add `"PingOne MCP Server"` to `KNOWN_APP_NAMES`; call `createApplication` for it in the provisioning flow |
| `demo_api_server/services/pingoneProvisionService.js` | No change — `createApplication` already handles WORKER + AUTHORIZATION_CODE with PKCE |
| `docs/PINGONE_CONFIG.md` | Add `PingOne MCP Server` row to the Applications table |

---

## Task 1: Create the Worker App in PingOne Console

**This is a manual step — no code.** The PingOne MCP Server requires a dedicated Worker app with PKCE, no secret, and no roles of its own.

**Files:** None (PingOne Console only)

- [ ] **Step 1: Log in to PingOne Console**

  Navigate to: `https://console.pingone.com` → select environment `01d89b06-66d5-430e-9f28-65636843788b`

- [ ] **Step 2: Create the Worker app**

  Go to **Applications → Applications → (+)**. Fill in:

  | Setting | Value |
  |---|---|
  | Name | `PingOne MCP Server` |
  | Description | `Worker app for pingone-mcp-server CLI (AI admin tooling — PKCE, no secret, no app roles)` |
  | Type | **WORKER** |

  Click **Save**.

- [ ] **Step 3: Configure OAuth settings**

  On the **Configuration** tab → pencil icon:

  | Setting | Value |
  |---|---|
  | Response Type | Code |
  | Grant Type | Authorization Code |
  | PKCE Enforcement | **S256_REQUIRED** |
  | Refresh Token | Enabled |
  | Redirect URIs | `http://127.0.0.1:7464/callback` |
  | Token Endpoint Authentication Method | **None** |

  Click **Save**.

- [ ] **Step 4: Leave Roles tab empty**

  Navigate to **Roles** tab — do not assign any roles. The MCP server inherits the authenticated user's roles at runtime.

- [ ] **Step 5: Enable the application**

  Toggle the **Enabled** switch to ON.

- [ ] **Step 6: Capture the Client ID**

  On the **Overview** tab, copy the **Client ID** UUID.

  > You'll need this for Tasks 2 and 4. Save it somewhere temporary (e.g. clipboard, scratch pad).

---

## Task 2: Add `pingone-admin` to `.mcp.json`

Wire the installed binary into Claude Code's MCP server list.

**Files:**
- Modify: `.mcp.json`

- [ ] **Step 1: Open `.mcp.json` and add the `pingone-admin` entry**

  Insert after the `"banking-gateway"` entry:

  ```json
  "pingone-admin": {
    "type": "stdio",
    "command": "pingone-mcp-server",
    "args": ["run"],
    "env": {
      "PINGONE_MCP_ENVIRONMENT_ID": "01d89b06-66d5-430e-9f28-65636843788b",
      "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<CLIENT_ID_FROM_TASK_1>",
      "PINGONE_ROOT_DOMAIN": "pingone.com"
    }
  }
  ```

  Replace `<CLIENT_ID_FROM_TASK_1>` with the UUID captured in Task 1 Step 6.

  The full updated `.mcp.json` should look like:

  ```json
  {
    "mcpServers": {
      "memory": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"]
      },
      "playwright": {
        "command": "npx",
        "args": ["-y", "@playwright/mcp@latest"]
      },
      "context7": {
        "command": "npx",
        "args": ["-y", "@upstash/context7-mcp"]
      },
      "github": {
        "type": "http",
        "url": "https://api.githubcopilot.com/mcp/"
      },
      "filesystem": {
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "/Users/curtismuir/Development/banking"
        ]
      },
      "sequential-thinking": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
      },
      "banking-dev": {
        "command": "node",
        "args": ["/Users/curtismuir/Development/AI-Demo/dev_mcp/banking-dev/dist/index.js"]
      },
      "banking-gateway": {
        "type": "http",
        "url": "https://api.ping.demo:3005/mcp",
        "note": "Claude Code as MCP client (Option B/C). The gateway validates the bearer token from Claude Code's Authorization header against PingOne. Requires the gateway to be running (./run.sh) and a valid access token in CLAUDE_BEARER_TOKEN env or set via Claude Code MCP auth."
      },
      "pingone-admin": {
        "type": "stdio",
        "command": "pingone-mcp-server",
        "args": ["run"],
        "env": {
          "PINGONE_MCP_ENVIRONMENT_ID": "01d89b06-66d5-430e-9f28-65636843788b",
          "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "<CLIENT_ID_FROM_TASK_1>",
          "PINGONE_ROOT_DOMAIN": "pingone.com"
        }
      }
    }
  }
  ```

- [ ] **Step 2: Verify the binary is on PATH**

  ```bash
  which pingone-mcp-server
  pingone-mcp-server --version
  ```

  Expected output:
  ```
  /opt/homebrew/bin/pingone-mcp-server
  pingone-mcp-server version 0.0.2 ...
  ```

- [ ] **Step 3: Test the MCP server starts (smoke test)**

  ```bash
  PINGONE_MCP_ENVIRONMENT_ID="01d89b06-66d5-430e-9f28-65636843788b" \
  PINGONE_AUTHORIZATION_CODE_CLIENT_ID="<CLIENT_ID_FROM_TASK_1>" \
  PINGONE_ROOT_DOMAIN="pingone.com" \
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | pingone-mcp-server run
  ```

  Expected: JSON response with `"result":{"protocolVersion":...,"serverInfo":{"name":"pingone-mcp-server",...}}` — the server responds to the MCP initialize handshake without error.

  > Note: The browser will NOT open at this stage (no tool was called). Authentication is lazy — it only triggers on the first actual tool call.

- [ ] **Step 4: Commit**

  ```bash
  git add .mcp.json
  git commit -m "feat(mcp): add pingone-admin MCP server entry

  Wires the official pingone-mcp-server binary (v0.0.2, installed via
  Homebrew pingidentity/tap) into Claude Code's MCP server list.

  Exposes PingOne Management API tools to AI assistants:
  - list/get/create/update applications, environments, populations
  - directory identity count reports
  Read-only mode by default (write requires --disable-read-only flag).

  Worker app 'PingOne MCP Server' must be created in PingOne Console
  (PKCE, no secret, no roles — see docs/pingone-mcp-server-report.md).

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

## Task 3: Add Worker App to Bootstrap Script

So new devs on fresh setups get the Worker app provisioned automatically alongside the other 8 apps.

**Files:**
- Modify: `demo_api_server/scripts/bootstrapPingOne.js`

- [ ] **Step 1: Add `'PingOne MCP Server'` to `KNOWN_APP_NAMES`**

  Find the array (around line 825):

  ```js
  const KNOWN_APP_NAMES = [
    'Demo Admin App',
    'Demo User App',
    'Demo MCP Server',
    'Demo Worker',
    'Demo MCP Exchanger',
    'Demo MCP Gateway',
    'Demo Agent',
    'Demo AI Agent',
  ];
  ```

  Add the new entry:

  ```js
  const KNOWN_APP_NAMES = [
    'Demo Admin App',
    'Demo User App',
    'Demo MCP Server',
    'Demo Worker',
    'Demo MCP Exchanger',
    'Demo MCP Gateway',
    'Demo Agent',
    'Demo AI Agent',
    'PingOne MCP Server',
  ];
  ```

- [ ] **Step 2: Find where applications are provisioned and add the new app**

  Search for where `createApplication` is called for the existing WORKER apps (around line 1389). Look for a pattern like:

  ```js
  const workerResult = await this.createApplication(
    'Demo Worker',
    'description...',
    'WORKER',
    ['client_credentials']
  );
  ```

  After the last `createApplication` call in that block, add:

  ```js
  // PingOne MCP Server — PKCE worker app for pingone-mcp-server CLI (dev tooling)
  // No secret (tokenEndpointAuthMethod: NONE), no app roles.
  // Redirect URI http://127.0.0.1:7464/callback must be set manually in the console
  // (PingOne Management API does not accept redirectUris on WORKER type apps).
  const mcpAdminResult = await this.createApplication(
    'PingOne MCP Server',
    'Worker app for pingone-mcp-server CLI (AI admin tooling — PKCE, no secret, no app roles)',
    'WORKER',
    ['authorization_code', 'refresh_token']
  );
  logStep(mcpAdminResult, 'PingOne MCP Server worker app');
  ```

  > **Why WORKER + AUTHORIZATION_CODE?** The `pingone-mcp-server` binary uses PKCE Authorization Code flow but targets a Worker-type app (no client secret). `pingoneProvisionService.createApplication` already handles this: WORKER apps are created with `tokenEndpointAuthMethod: NONE` and PKCE is set when AUTHORIZATION_CODE is in the grant list (see `services/pingoneProvisionService.js:625`).

  > **Why not set redirectUris here?** The PingOne Management API silently ignores `redirectUris` on WORKER-type apps. The redirect URI `http://127.0.0.1:7464/callback` must be set manually in the console after bootstrap, or it is already set if the app was manually created in Task 1.

- [ ] **Step 3: Verify the bootstrap script still parses without error**

  ```bash
  cd /Users/curtismuir/Development/AI-Demo/demo_api_server
  node -e "require('./scripts/bootstrapPingOne.js')" 2>&1 | head -5
  ```

  Expected: The script starts (prints its banner/header) and then waits for input or exits cleanly — no syntax errors or `SyntaxError` / `ReferenceError` output.

  > The script prompts for credentials on startup; interrupt with Ctrl+C after confirming no parse errors.

- [ ] **Step 4: Commit**

  ```bash
  git add demo_api_server/scripts/bootstrapPingOne.js
  git commit -m "feat(bootstrap): provision PingOne MCP Server worker app

  Adds 'PingOne MCP Server' to KNOWN_APP_NAMES and the provisioning
  flow so npm run pingone:bootstrap creates it automatically.

  The app uses AUTHORIZATION_CODE + PKCE with tokenEndpointAuthMethod
  NONE (no client secret). Redirect URI http://127.0.0.1:7464/callback
  must still be set manually in the PingOne console (Management API
  does not accept redirectUris on WORKER-type apps).

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

## Task 4: Update `PINGONE_CONFIG.md`

Keep the source-of-truth doc in sync with the new app.

**Files:**
- Modify: `docs/PINGONE_CONFIG.md`

- [ ] **Step 1: Add the new app row to the Applications table**

  Find the Applications table header:

  ```markdown
  | Role | App Name | Client ID | Type | Token Auth | Grant Types |
  |---|---|---|---|---|---|
  ```

  Add a new row at the bottom of the table:

  ```markdown
  | **PingOne MCP Server (dev tooling)** | PingOne MCP Server | `<CLIENT_ID_FROM_TASK_1>` | WORKER | NONE (PKCE) | authorization_code, refresh_token |
  ```

  Replace `<CLIENT_ID_FROM_TASK_1>` with the UUID from Task 1 Step 6.

- [ ] **Step 2: Add the redirect URI row to the Redirect URIs table**

  Find:

  ```markdown
  | App | Redirect URI |
  |---|---|
  ```

  Add:

  ```markdown
  | PingOne MCP Server | `http://127.0.0.1:7464/callback` |
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add docs/PINGONE_CONFIG.md
  git commit -m "docs(pingone-config): add PingOne MCP Server worker app

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  ```

---

## Task 5: End-to-End Verification

Confirm everything works together in Claude Code.

**Files:** None

- [ ] **Step 1: Reload Claude Code MCP servers**

  In a terminal, check the MCP server is registered and healthy:

  ```bash
  claude mcp list
  ```

  Expected output includes:
  ```
  pingone-admin: pingone-mcp-server run - ✓ Connected
  ```

  If not shown, restart Claude Code (the MCP server list is loaded at session start).

- [ ] **Step 2: First tool use — browser auth flow**

  In a Claude Code conversation, ask:

  > "Using the pingone-admin MCP server, list all environments I have access to."

  Expected:
  - A browser window opens automatically to `https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/authorize`
  - You log in as your PingOne admin user (e.g. `curtis@coachcurtis.org`)
  - Browser shows a success/redirect message and closes
  - Claude returns a list of PingOne environments

- [ ] **Step 3: Verify token cached — no re-auth on second call**

  Immediately ask a follow-up:

  > "List all applications in the environment we just found."

  Expected: Claude responds with the application list **without opening a browser again**. Token was stored in macOS Keychain after Step 2.

- [ ] **Step 4: Verify post-bootstrap check works**

  Ask:

  > "Check that all 8 demo apps exist: Demo Admin App, Demo User App, Demo MCP Server, Demo Worker, Demo MCP Exchanger, Demo MCP Gateway, Demo Agent, Demo AI Agent. List any that are missing."

  Expected: Claude calls `list_applications` and reports all 8 present (or flags any missing ones).

- [ ] **Step 5: Verify write mode is off by default**

  Ask:

  > "Create a test population called 'MCPTest'."

  Expected: Claude either reports the tool is not available (read-only mode) or PingOne returns a permission error — confirming that `--disable-read-only` is not set and write tools are correctly gated.

---

## Optional Task 6: Enable Write Mode (When Needed)

Not needed for day-to-day inspection. Only enable when you actively want to create/update PingOne config.

**Files:**
- Modify: `.mcp.json` (temporarily, or as a named variant)

- [ ] **Step 1: Switch to write mode**

  In `.mcp.json`, change the `pingone-admin` args:

  ```json
  "args": ["run", "--disable-read-only"]
  ```

- [ ] **Step 2: Restart Claude Code session**

  MCP servers are loaded at session start. Restart the Claude Code app or start a new session.

- [ ] **Step 3: Revert when done**

  ```json
  "args": ["run"]
  ```

  > **Do not commit write mode as the default.** Read-only is the safe default for the repo.

---

## Notes

- **Production environments are blocked by default** — `pingone-mcp-server` will refuse write operations on environments of type `PRODUCTION`, regardless of `--disable-read-only`.
- **Token stored in macOS Keychain** — To log out or switch users, run `pingone-mcp-server logout`.
- **Debug mode** — Set `PINGONE_MCP_DEBUG=true` in the `.mcp.json` env block to see verbose logs in Claude Code's MCP output panel.
- **Resource servers / scopes not yet supported** — The MCP server only covers apps, environments, populations, and directory. Scope management still requires direct Management API calls or the PingOne console.
- **Preview software** — `pingone-mcp-server` is officially preview. If a tool breaks after a Homebrew update (`brew upgrade pingone-mcp-server`), check the [upstream changelog](https://github.com/pingidentity/pingone-mcp-server/releases).
