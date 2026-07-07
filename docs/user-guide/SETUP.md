# AI-Demo — Complete Setup Guide

> **First-time developer?** Follow this guide top-to-bottom to go from a fresh PingOne trial account + fresh repo clone to a running local demo with all three auth flows operational.
>
> This is a **multi-vertical AI-agent-security demo**, not a real bank. The default vertical is "Super Banking"; others include healthcare, retail, workforce, and sporting-goods.

---

## 1. Prerequisites

### Software

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | 20+ LTS | `node -v` |
| npm | 9+ (bundled with Node) | `npm -v` |
| Git | Any recent | `git --version` |

### Accounts

- **PingOne** free trial at [pingidentity.com](https://www.pingidentity.com/) — you need:
  - Your **Environment ID** (UUID, found under Environments → *your environment* → Settings)
  - Your **Region** suffix: `com`, `eu`, `ca`, `ap`, or `asia`
- Optional for full agent demo: an LLM provider key — Helix/Ping AI (default), Anthropic (Claude), or OpenAI. A local model also works with **no key**: run llama.cpp's `llama-server` (the installer/`run.sh` set this up on `:8090`) or a local LM Studio endpoint.

### Clone the repo

```bash
git clone https://github.com/<org>/AI-Demo.git
cd AI-Demo
```

---

## 2. PingOne Application Configuration

### 2.0 Automated bootstrap (recommended)

The fastest path is the bootstrap script, which provisions every PingOne resource (apps, scopes, resource servers) for you. Provide your PingOne worker credentials (Environment ID, Region, worker Client ID/Secret) when prompted, then run:

```bash
cd demo_api_server
npm run pingone:bootstrap
```

This creates the OIDC applications, the resource server, the plain `read` / `write` / `admin` scopes, and the demo users automatically. It also writes `demo_api_server/.env`, including `PING_EMAIL` when your git `user.email` ends in `@pingidentity.com` (used by `./run-k8.sh` for SE namespace derivation). If you prefer to set things up by hand, the sections below describe what the bootstrap creates.

**Source of truth for env vars:** See [ENV_VARS.md](ENV_VARS.md) for the authoritative environment variable catalog.

> Scopes used by this demo are plain `read`, `write`, and `admin`. (Earlier revisions of this guide referenced `banking:*`-prefixed custom scopes — those are obsolete.)

### 2.1 The API Resource (plain scopes)

The bootstrap defines the Resource that the `read` / `write` / `admin` scopes belong to.

1. PingOne Admin → **Environment** → **Resources** (or **APIs**)
2. Click **Add Resource** → give it any name (e.g. `Super Banking API`)
3. **Audience**: must match `REACT_APP_ENDUSER_AUDIENCE` in your env
4. Add the following **scopes**:

```
read
write
admin
```

### 2.2 Admin OIDC Application (`admin_client_id`)

Used for **staff login** (`/admin`) and **RFC 8693 Token Exchange** to MCP.

| Setting | Value |
|---------|-------|
| Type | OIDC Web App (or single-page, depending on your template) |
| Grant types | Authorization Code, Refresh Token |
| PKCE enforcement | Required (S256) |
| Redirect URI (local) | `https://api.ping.demo:3001/api/auth/oauth/callback` |
| Redirect URI (hosted) | `https://<your-domain>/api/auth/oauth/callback` |
| Token auth method | `client_secret_basic` or `client_secret_post` |
| Required scopes | `openid profile email offline_access read write admin` |
| Token Exchange | **Enable** if using MCP agent delegation (RFC 8693) |
| CORS Origins | `https://api.ping.demo:4000` (local development) or your production domain |

**CORS Configuration:**
- In PingOne Admin → Applications → Admin OIDC App → Configuration → Advanced
- Add `https://api.ping.demo:4000` to Allowed Origins for local development
- Add your production domain (e.g., `https://your-domain.com`) for hosted deployments
- This allows the frontend to make API calls to the backend

**Copy the Client ID and Client Secret** — you will use these as `PINGONE_ADMIN_CLIENT_ID` / `PINGONE_ADMIN_CLIENT_SECRET`.

> Admin is a role overlay, not a separate vertical. Staff sign in through the same flow and gain admin capabilities across whichever vertical is active.

### 2.3 End-User OIDC Application (`user_client_id`)

Used for **customer login** (`/dashboard`).

| Setting | Value |
|---------|-------|
| Type | OIDC Web App |
| Grant types | Authorization Code, Refresh Token |
| PKCE enforcement | Required (S256) |
| Redirect URI (local) | `https://api.ping.demo:3001/api/auth/oauth/user/callback` |
| Redirect URI (hosted) | `https://<your-domain>/api/auth/oauth/user/callback` |
| Required scopes | `openid profile email offline_access read write` |
| CORS Origins | `https://api.ping.demo:4000` (local development) or your production domain |

**CORS Configuration:**
- In PingOne Admin → Applications → End-User OIDC App → Configuration → Advanced
- Add `https://api.ping.demo:4000` to Allowed Origins for local development
- Add your production domain (e.g., `https://your-domain.com`) for hosted deployments
- This allows the frontend to make API calls to the backend

**Critical:** The end-user app must grant the scopes the agent will delegate (`read` / `write`) for token exchange to succeed. See [ENV_VARS.md](ENV_VARS.md) for the authoritative variable list.

**Copy the Client ID and Client Secret** — these become `PINGONE_USER_CLIENT_ID` / `PINGONE_USER_CLIENT_SECRET`.

### 2.4 Management Worker Application (client credentials)

Used by the BFF to call PingOne Management API (read users etc.).

| Setting | Value |
|---------|-------|
| Type | Worker (Client Credentials) |
| Grant types | Client Credentials |
| Required API permissions | `p1:read:user`, `p1:update:user` (assign via Roles or Resource Permissions) |

You can generate a long-lived token from this app and set `PINGONE_MANAGEMENT_API_TOKEN`, **or** set its credentials as `PINGONE_MANAGEMENT_CLIENT_ID` / `PINGONE_MANAGEMENT_CLIENT_SECRET` for the BFF to obtain tokens dynamically.

### 2.5 MCP Token Exchanger Application (RFC 8693)

Required for AI agent MCP tool calls with token exchange delegation.

| Setting | Value |
|---------|-------|
| Type | AI_AGENT |
| Grant types | Client Credentials, Token Exchange (`urn:ietf:params:oauth:grant-type:token-exchange`) |
| Token auth method | `client_secret_basic` |
| Required scopes | `read write` |

**Copy the Client ID and Client Secret** — these become `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` / `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET`.

**Also set** in your `.env`:
```bash
PINGONE_MCP_TOKEN_EXCHANGER_SCOPES=read write
PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD=client_secret_basic
```

### 2.6 Create test users

Create at least two PingOne directory users in your environment:

| Username | Role | Notes |
|----------|------|-------|
| `bankadmin` (or any) | Admin | Must exist in PingOne; the BFF's `dataStore` role is set at first login |
| `bankuser` (or any) | Customer | Standard user |

---

## 3. Environment Variables

All services read environment variables from `.env` files. See [ENV_VARS.md](ENV_VARS.md) for the authoritative catalog.

### Quick setup

```bash
# BFF — the primary service
cp demo_api_server/.env.example demo_api_server/.env

# MCP server (optional for local dev)
cp demo_mcp_server/.env.example demo_mcp_server/.env
```

The React UI reads `REACT_APP_*` vars from the **root** `.env` or from its own `.env` file at build time (CRA). For local dev, set them in the repo-root `.env` or in `demo_api_ui/.env`.

### Required variables reference

| Variable | Service | Where to get it | Required? |
|----------|---------|-----------------|-----------|
| `PINGONE_ENVIRONMENT_ID` | BFF | PingOne Admin → Environment → Settings | ✅ Yes |
| `PINGONE_REGION` | BFF | `com` / `eu` / `ca` / `ap` / `asia` | ✅ Yes |
| `PINGONE_ADMIN_CLIENT_ID` | BFF | Admin OIDC app → Client ID | ✅ Yes |
| `PINGONE_ADMIN_CLIENT_SECRET` | BFF | Admin OIDC app → Client Secret | ✅ Yes |
| `PINGONE_USER_CLIENT_ID` | BFF | End-user OIDC app → Client ID | ✅ Yes |
| `PINGONE_USER_CLIENT_SECRET` | BFF | End-user OIDC app → Client Secret | ✅ Yes |
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` | BFF | MCP Token Exchanger app → Client ID | Optional (enables MCP token exchange) |
| `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET` | BFF | MCP Token Exchanger app → Client Secret | Optional (enables MCP token exchange) |
| `SESSION_SECRET` | BFF | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | ✅ Yes |
| `PUBLIC_APP_URL` | BFF | `https://api.ping.demo:4000` (local) or your hosted domain | ✅ Yes |
| `REACT_APP_API_URL` | UI | `https://api.ping.demo:3001` (local) | ✅ Yes |
| `REACT_APP_ENDUSER_AUDIENCE` | UI | Audience you set on the API resource (§2.1) | ✅ Yes |
| `PINGONE_MANAGEMENT_API_TOKEN` | BFF | Worker app → generate token, or set worker credentials | Optional |
| `MCP_SERVER_URL` | BFF | WebSocket URL of deployed MCP server | Optional |
| `GROQ_API_KEY` | BFF | console.groq.com | Optional (enables NL intents) |

> **Legacy names:** The BFF also accepts `PINGONE_AI_CORE_CLIENT_ID` as a fallback alias for `PINGONE_ADMIN_CLIENT_ID`. Use the canonical names above for new setups.

> **Config UI alternative:** Instead of `.env` files, launch the app and visit **`https://api.ping.demo:4000/config`** to enter PingOne credentials via the browser UI. Settings are encrypted and saved to `demo_api_server/data/persistent/lmdb/` (LMDB). Either method works.

---

## 4. Running Locally

### Option A — All services in one command (recommended)

```bash
# From repo root
./run.sh
```

`./run.sh` starts all services concurrently using HTTPS via mkcert and requires a `/etc/hosts` entry (`127.0.0.1 api.ping.demo`).

**Core ports:**

| Service | Port | URL |
|---------|------|-----|
| React UI | 4000 | `https://api.ping.demo:4000` |
| BFF API | 3001 | `https://api.ping.demo:3001` |
| MCP server | 8080 | `ws://localhost:8080` |

The full stack is ~13 services (UI, BFF, mcp-server 8080, mcp-gateway 3005, mcp-invest 8081, hitl 3009, mortgage 8082, agent-service 3016, langchain 8888/8889/8890, openai 8891, mastra 8892, pydantic 8893, authz-mock 9001).

Commands: `./run.sh start`, `./run.sh stop`, `./run.sh status`, `./run.sh tail`

### Option B — Docker Compose

```bash
# From repo root
docker-compose up --build
```

### Option C — Start services individually

```bash
# Terminal 1 — BFF
cd demo_api_server && npm install && node server.js

# Terminal 2 — React UI
cd demo_api_ui && npm install && npm start

# Terminal 3 — MCP server (optional; only needed for AI agent flows)
cd demo_mcp_server && npm install && npm start
```

Default ports:

| Service | Port (default) |
|---------|---------------|
| React UI | 4000 |
| BFF | 3001 |
| MCP server | 8080 |

---

## 5. Verifying the Setup

Run through each flow once after startup:

### Flow 1 — Admin login (Authorization Code + PKCE)

1. Visit `https://api.ping.demo:4000`
2. Click **Log In as Admin** (or go to `/admin`)
3. You should be redirected to PingOne → log in with your admin user
4. After callback, land on `/admin`
5. ✅ Admin panel visible, config shows "Connected"

### Flow 2 — Customer login (Authorization Code + PKCE)

1. Visit `https://api.ping.demo:4000`
2. Click **Log In** (customer)
3. PingOne login → land on `/dashboard`
4. ✅ Account cards and transactions visible

### Flow 3 — AI agent (optional, needs MCP server running)

1. Log in as admin (Flow 1)
2. Open the **AI Agent** FAB (floating button, bottom-right)
3. Type a natural-language banking request (e.g. "Show my accounts")
4. ✅ Agent responds with data via MCP tool calls

### Flow 4 — CIBA step-up (optional, needs `CIBA_ENABLED=true`)

1. Log in as customer (Flow 2)
2. Attempt a high-value transfer (above `STEP_UP_AMOUNT_THRESHOLD`, default $250)
3. ✅ App prompts for out-of-band approval (check email / push device)

---

## 6. Deployment

This demo is **not** deployed to Vercel. (Earlier revisions referenced a Vercel + Upstash Redis path — that is obsolete; sessions use LMDB with an in-memory fallback, no Redis.)

Supported deployment paths:
- **Local:** `./run.sh` (HTTPS via mkcert) or `docker-compose up --build`
- **Containers / Kubernetes:** see the manifests and deploy script under [`k8s/`](../../k8s/) (`k8s/deploy.sh`)

See [deployment.md](deployment.md) for the full deployment guide.

---

## 7. Troubleshooting

### `invalid_state` error after PingOne redirect

**Cause:** Session cookie was lost between the `/authorize` redirect and the callback.  
**Fix:** Ensure the BFF session store is healthy (LMDB at `demo_api_server/data/persistent/lmdb/`, with in-memory fallback). Confirm cookies are allowed for `https://api.ping.demo:4000` and that `PUBLIC_APP_URL` matches the URL you load.

### `invalid_client` from PingOne token endpoint

**Cause:** Wrong client ID / secret, or wrong token auth method.  
**Fix:** Verify `PINGONE_ADMIN_CLIENT_ID` / `PINGONE_ADMIN_CLIENT_SECRET` match the PingOne app exactly. Check `admin_token_endpoint_auth_method` in `/config` matches your PingOne app setting (`basic` vs `post`).

### `invalid_scope` on authorization request

**Cause:** A scope in the request does not exist on the PingOne application or resource.  
**Fix:** Check §2.1 — the `read` / `write` / `admin` scopes must be added to the PingOne Resource and assigned to the OIDC app. See [ENV_VARS.md](ENV_VARS.md) for the env-var mapping.

### Blank dashboard / no accounts after login

**Cause:** BFF cannot connect to PingOne JWKS for token validation, or `REACT_APP_API_URL` points to wrong port.  
**Fix:** Check `REACT_APP_API_URL` in the UI env matches the BFF port. Visit `/api/auth/debug` to see session state. Enable `DEBUG_OAUTH=true` in the BFF for verbose logging.

### MCP tool calls return 401 / "missing scope"

**Cause:** Token exchange is not enabled on the admin PingOne app, or `REACT_APP_AI_AGENT_AUDIENCE` doesn't match the MCP resource audience.  
**Fix:** Enable Token Exchange on the admin OIDC app (§2.2). Verify `REACT_APP_AI_AGENT_AUDIENCE` matches the audience configured in the MCP server's `PINGONE_BASE_URL` environment. See [docs/PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md](../PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) for the 1-exchange delegated chain setup.

### Logout doesn't redirect / silently fails

**Cause:** PingOne OIDC app is missing `postLogoutRedirectUris`.
**Fix:** Use the automatic fix endpoint:

```bash
curl -X POST https://api.ping.demo:3001/api/admin/app-config/fix-logout-urls \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"publicAppUrl": "https://api.ping.demo:4000"}'
```

Or manually add logout URIs in PingOne Console → Applications → your app → Settings → Sign-Off URLs (`https://api.ping.demo:4000`).

### Audit PingOne app configuration

Run the built-in audit to check both apps for common issues:
```bash
curl https://api.ping.demo:3001/api/admin/app-config/audit/all \
  -H "Cookie: <your-session-cookie>"
```
Returns structured report with issues (missing logout URIs, PKCE not enforced, missing localhost URIs, etc.) and passes.

---

## 8. API Reference — Admin App Config

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/app-config/admin` | GET | Get Admin OIDC app PingOne config |
| `/api/admin/app-config/user` | GET | Get User OIDC app PingOne config |
| `/api/admin/app-config/fix-logout-urls` | POST | Fix logout URLs on both apps |
| `/api/admin/app-config/audit/all` | GET | Audit both apps for issues |

All endpoints require authentication (session cookie or Bearer token).

---

## Code Explorer (optional)

The public `/code-explorer` page answers natural-language questions about this
codebase, grounded in real code. It's powered by a local index that
`npm run setup:fresh` builds for you. To rebuild it after code changes (no API
cost, ~1s):

```bash
cd demo_api_server && npm run codegraph:build
```

`./run.sh` also rebuilds the index on every startup, so local dev stays current.
