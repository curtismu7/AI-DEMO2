<!-- generated-by: gsd-doc-writer -->

# Development Guide

This guide covers the development workflow, code conventions, module systems, build requirements, and debugging practices for AI-Demo (a multi-vertical AI-agent-security demo; default vertical "Super Banking").

---

## Quick Start: Running Locally

### One-time setup

```bash
# 1. Ensure /etc/hosts and mkcert are configured (HTTPS only)
echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
brew install mkcert && mkcert -install

# 2. Fresh install (chains: deps + optional data import + PingOne bootstrap)
npm run setup:fresh

# Or migrate from another machine with an archive:
npm run setup:fresh -- /path/to/archive.tar.gz
```

### Start all services

```bash
./run.sh                    # start the full stack (~13 services)
./run.sh status             # health check
./run.sh tail all           # follow all logs interleaved
./run.sh stop               # stop all services
```

**What starts:**
- BFF (demo_api_server) on `https://api.ping.demo:3001`
- UI (demo_api_ui) on `https://api.ping.demo:4000`
- MCP Server on `localhost:8080` (loopback)
- MCP Gateway on `localhost:3005`
- MCP Invest on `localhost:8081`
- Mortgage Service on `localhost:8082`
- Agent Service on host `localhost:3016` (container 3006)
- HITL Service on `localhost:3009`
- LangChain Agent on `localhost:8888/8889/8890` (Python)
- OpenAI Agent on `localhost:8891`, Mastra Agent on `localhost:8892`, Pydantic Agent on `localhost:8893`
- Authorize mock on `localhost:9001`

### Quick workflow: make a change → test → verify

```bash
# 1. Edit a file (e.g., demo_api_ui/src/components/Dashboard.js)
# 2. If TypeScript service (MCP, gateway, agent), build it:
cd demo_mcp_server && npm run build

# 3. If UI change, verify build succeeds:
cd demo_api_ui && npm run build  # must exit with code 0

# 4. Run tests for the area you changed:
npm run test:api-server           # BFF tests
npm run test:mcp-server           # MCP unit + integration tests
npm run test:ui                   # React component tests (CI mode)
npm run test:e2e:ui:smoke         # UI end-to-end smoke tests

# 5. Start services and verify in browser:
./run.sh
# Visit https://api.ping.demo:4000 → login → test your feature
```

---

## Module System by Package

AI-Demo is **not** a monorepo, but contains many services (Node.js + Python) across the stack, each with its own module system. The core ones:

### CommonJS Services (Plain JavaScript)
- **demo_api_server** — Express BFF, all routes and services use `require()`/`module.exports`
- **demo_hitl_service** — HITL consent handler
- **demo_mortgage_service** — Mortgage backend service
- No build step required; changes take effect on restart

### TypeScript Services (Compiled to `dist/`)
- **demo_mcp_server** — Tool definitions and execution (`src/` → `dist/index.js`)
- **demo_mcp_gateway** — MCP request routing and authorization
- **demo_agent_service** — LangGraph agent orchestration
- **demo_mcp_invest** — Investment tools and integration
- **Build requirement:** `npm run build` generates `dist/`, which is **launched unconditionally**

### React / CRA (No Build at Dev Time)
- **demo_api_ui** — Create React App SPA, ES modules + JSX in `.js` files
- **Dev server:** `npm start` watches and compiles
- **Prod build:** `npm run build` → `build/` directory (required before deployment)
- **UI changes must exit `npm run build` with code 0** — this is a non-negotiable gate

### Python (Separate Virtual Environment)
- **langchain_agent** — Async FastAPI + LangGraph agent
- Requires `pip install -r requirements.txt` (Python 3.10+)
- Run via `./run.sh` (auto-handled by the start script)

---

## Build Commands: When and Why

### TypeScript Services (Always Required After Source Edit)

```bash
cd demo_mcp_server && npm run build
cd demo_mcp_gateway && npm run build
cd demo_agent_service && npm run build
cd demo_mcp_invest && npm run build
```

**Why:** TypeScript is compiled to `dist/index.js`. The launch script runs the compiled code unconditionally — if `dist/` is stale, the service will crash with `MODULE_NOT_FOUND` or stale function signatures.

**run.sh auto-builds:** The `./run.sh` startup script auto-detects and builds all TypeScript services in its dependency-check loop. If you're running `./run.sh`, the builds are automatic.

**When you launch services manually:** If you're running `npm start` directly inside a service directory (debugging), you must run `npm run build` first.

### UI Build (Required Before Deployment)

```bash
cd demo_api_ui && npm run build
```

**Why:** Create React App's dev server (`npm start`) is **not** sufficient for production. A full production build checks for TypeScript errors, unused imports, and optimizes bundle size.

**Non-negotiable:** Exit code must be `0`. If the build fails, the deployment will fail. Check the error log carefully — it often points to a missing import or JSX syntax error.

**Local dev:** `npm start` in `demo_api_ui/` works for local development; the build gate is only for pre-deployment or CI.

### CommonJS Services (No Build)

```bash
# demo_api_server — no build required
# demo_hitl_service — no build required
# demo_mortgage_service — no build required
```

These are plain Node.js; changes take effect on server restart.

---

## Code Conventions: Non-Negotiables

Read [CLAUDE.md](../../CLAUDE.md) before making changes. These are binding:

### 1. **Read REGRESSION_PLAN.md §1 before editing critical files**

The [REGRESSION_PLAN.md](../../REGRESSION_PLAN.md) file lists 90+ "do not break" areas. If you edit any file in the §1 table:
- **State what you will not break** before starting work
- Example: "I will not change the session middleware registration order in `server.js`"
- Read the entire row to understand the consequence of breakage

**Critical files** (spot check before editing):
- `demo_api_server/routes/oauth*.js` — OAuth flow, redirect origins
- `demo_api_server/server.js` — middleware order, route registration
- `demo_api_server/services/configStore.js` — environment variable resolution
- `demo_api_ui/src/App.js` — agent float visibility, routing
- `demo_api_ui/src/components/BankingAgent.js` — FAB state, HITL modal
- `demo_mcp_server/src/tools/BankingToolRegistry.ts` — MCP tool definitions

### 2. **Minimal diff — touch only what the task requires**

- Name the component/file you're editing
- Do **not** refactor unrelated code in the same file
- Do **not** "while I'm here" cleanup (pre-existing code style issues)
- Fix pre-existing bugs **only** if they're in a file you already had to change AND the fix is small and scoped

**Example:** If fixing a button label, don't restructure the component's useState hooks.

### 3. **Token custody — tokens never in the browser**

**Rule:** Tokens are **never** exposed to the browser. The BFF (demo_api_server) is the sole token custodian.

- The React SPA holds **only** an httpOnly session cookie (`connect.sid`)
- Every BFF call uses `bffAxios` (cookie-based, no `Authorization` header from browser)
- MCP tool calls go: Browser → (cookie) → BFF (agentMcpTokenService.js) → RFC 8693 token exchange → WebSocket → MCP Server
- Never add `Authorization: Bearer <token>` headers from the browser
- Never fetch tokens in useEffect and store them in state or localStorage

See [ARCHITECTURE-TRUTHS.md](../ARCHITECTURE-TRUTHS.md) (T-5 cascade rule, T-4 resource identity) for the token architecture.

### 4. **No emojis in UI text (⚠️ ✅ ❌ only)**

**HARD RULE:** No emojis in button labels, status messages, section headers, or descriptions.

- ❌ "🔄 Refresh" → "Refresh"
- ❌ "✅ Balance" → "Balance"
- ✅ "Refresh" (plain text)
- ✅ `⚠️` Warning, `✅` success status, `❌` error (only these three)
- ✅ Directional arrows (`→ ← ↑ ↓`) and box-drawing chars (`│ ├ └ ─`) in text

Banking apps are professional. See [REGRESSION_PLAN.md §0](../../REGRESSION_PLAN.md#0-ui-style-guidelines).

### 5. **Use the default host: api.ping.demo**

- **BFF:** `https://api.ping.demo:3001`
- **UI:** `https://api.ping.demo:4000`
- **MCP (loopback):** `localhost:8080`

Never hardcode `localhost:3001` or `localhost:4000` in route handlers. Read the configured host via:
```javascript
// demo_api_server/routes/oauth.js
const origin = req.get('origin') || getConfiguredPublicAppUrl();
```

Users can override via `/setup` page (writes configStore) or `.env` (`PUBLIC_APP_URL`, `REACT_APP_CLIENT_URL`, `CORS_ORIGIN`).

### 6. **Bug fixes: log an entry in REGRESSION_PLAN.md §4**

Every bug fix must be logged in [REGRESSION_PLAN.md §4 (Bug Fix Log)](../../REGRESSION_PLAN.md#4-bug-fix-log).

**Template:**
```markdown
### YYYY-MM-DD — Brief description of what was broken

**Files changed:**
- `path/to/file.js` — what was changed

**What was broken:** [Symptom + root cause]

**What was fixed:** [Solution + files involved]

**Security note / Do not break:** [Any load-bearing invariants to preserve]

**Verify:**
```bash
npm test -- --testPathPattern=related-test
```
```

---

## Development Workflow: Adding a Feature

### Step 1: Plan (especially if touching §1 files)

Use a written plan for:
- **3+ steps** (feature is multi-faceted)
- **OAuth/session/MCP/auth** (security surface)
- **§1 file edits** (regression risk)
- **Session/store behavior** (LMDB + in-memory fallback)

Example plan:
```
1. Add new MCP tool to BankingToolRegistry.ts (MCP server)
2. Add RFC 8693 scope to PINGONE_RESOURCE_MCP_SERVER_URI (PingOne)
3. Add authorization rule to simulatedAuthorizeService.js (BFF)
4. Call tool from BankingAgent.js (UI)
5. Test: npm run test:mcp-server, then ./run.sh + smoke test in browser
```

### Step 2: Code

**For each service:**

#### CommonJS (BFF, HITL, Mortgage)
- Edit `.js` files directly
- Import via `require('../../path/to/module')`
- No build step; restart to test

#### TypeScript (MCP, Gateway, Agent, Invest)
- Edit `.ts` files in `src/`
- Import via `import { fn } from '../../path/to/module'`
- After editing: `npm run build`
- Verify `dist/index.js` is generated
- Restart service to test

#### React (UI)
- Edit `.js` or `.jsx` files in `src/`
- Import via `import { Component } from './path'`
- Dev server auto-watches; reload browser
- Before pushing: `npm run build` must exit 0

#### Config Changes
- Edit `.env` or `.env.example`
- Or use `/config` UI (writes `config.db`)
- Or use `/api/admin/config` endpoint (BFF)
- Verify via `configStore.getEffective(key)` in code

### Step 3: Test

**Unit/integration tests (TypeScript services):**
```bash
cd demo_mcp_server && npm run test:unit
cd demo_mcp_server && npm run test:integration
cd demo_api_server && npm test
npm run test:ui
```

**E2E tests (UI):**
```bash
npm run test:e2e:ui:smoke          # fast: dashboard + landing
npm run test:e2e:ui                # full: all pages
npm run test:e2e:admin             # admin dashboard
npm run test:e2e:agent             # agent flows
```

**Critical test suite (OAuth, HITL, sessions):**
```bash
cd demo_api_server
npx jest oauthStatus.regression oauthStatus.integration \
         hitlRoute.regression hitlRoute.integration
# Should see: 43 tests, all passing
```

**Manual verification:**
```bash
./run.sh                      # start all services
# Visit https://api.ping.demo:4000 in browser
# Log in as admin or user
# Navigate to affected feature
# Check browser console for errors
# Check /tmp/demo-api.log for API errors
```

### Step 4: Pre-commit Checklist

Before committing:

- [ ] `npm run test:api-server` passes (if BFF changes)
- [ ] `npm run test:mcp-server` passes (if MCP changes)
- [ ] `npm run test:ui` passes (if UI changes)
- [ ] `cd demo_api_ui && npm run build` exits with 0 (if UI changes)
- [ ] No new unhandled rejections in logs
- [ ] No new console.error in flows I changed
- [ ] If OAuth touched: admin login + user login both work
- [ ] If agent/MCP touched: Token Chain shows events, act claim present
- [ ] If HITL touched: consent dialog appears for transfers > threshold
- [ ] Minimal diff — no unrelated refactoring
- [ ] Regression-guide read + "do not break" statement in commit message

### Step 5: Commit & Log

```bash
git add <files>
git commit -m "feat(mcp): add new banking tool for expense forecasting

- Add tool schema to BankingToolRegistry.ts
- Add RFC 8693 scope to token exchange
- Add authorization rule to simulated Authorize service
- Call tool from agent when requested

Do not break: MCP tool execution gate (simulatedAuthorizeService.js),
token custody rule (no browser tokens), existing scope sufficiency
checks in agentMcpTokenService.js per REGRESSION_PLAN §1 row 57.

REGRESSION_PLAN §4 entry: 2026-05-19 — Expense forecasting tool added.
Files: src/tools/BankingToolRegistry.ts, services/simulatedAuthorizeService.js,
demo_api_ui/src/components/BankingAgent.js.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Debugging

### Service Logs

All logs live in `/tmp/`:

```bash
/tmp/demo-api.log         # BFF (demo_api_server) — start here
/tmp/demo-ui.log                 # UI dev server (demo_api_ui)
/tmp/demo-mcp.log         # MCP server
/tmp/demo-mcp-gateway.log        # MCP gateway
/tmp/demo-agent.log      # LangGraph agent
/tmp/demo-hitl.log       # HITL consent
/tmp/demo-invest.log         # Investment tools
/tmp/demo-mortgage.log   # Mortgage backend
/tmp/demo-langchain.log    # Python LangChain agent
```

**View logs:**
```bash
tail -f /tmp/demo-api.log        # follow BFF
./run.sh tail 1                    # view BFF log (numbered menu)
./run.sh tail all                  # all logs interleaved
```

### Common Patterns in Logs

**BFF logs are structured** (pino JSON or pretty format):

```
[McpExchangerToken] ✅ Token obtained
[McpToolAuth] evaluateMcpFirstTool: transfer $500 → needsConfirm=true
[SessionStore] LMDB session store unavailable, using in-memory fallback
```

**Search for errors:**
```bash
grep -i "error\|failed\|exception" /tmp/demo-api.log | tail -20
grep "\[McpExchangerToken\]" /tmp/demo-api.log           # token exchange events
grep "evaluate.*Tool" /tmp/demo-api.log                  # auth decisions
```

### Health Checks

```bash
./run.sh status

# Output shows:
# ✅ BFF (3001) responsive
# ✅ UI (4000) responsive
# ✅ MCP (8080) responsive
# etc.
```

### Browser DevTools

**Session & Token Chain:**
- Log in to https://api.ping.demo:4000
- Open browser DevTools → Application → Cookies
- Verify `connect.sid` is present (httpOnly, Secure, SameSite=Lax)
- Never expose `Authorization` header in outgoing requests

**MCP Tool Execution:**
- Click an MCP tool (e.g., "View Balance")
- Open DevTools → Network tab
- Find `POST /api/mcp/tool` request
- Response includes `tokenEvents` array with token exchange milestones
- Check for `act` claim in Token Chain UI panel

**React Component State:**
- Install [React Developer Tools](https://reactjs.org/blog/2019/08/15/new-react-devtools.html) browser extension
- Open DevTools → Components tab
- Navigate to component (e.g., BankingAgent)
- Inspect `hitlPendingIntent`, `mcpLoading`, `tokenChainEvents` state

---

## Service Architecture Reference

### Request Flow: MCP Tool Call

```
Browser
  ↓ (cookie)
BFF (demo_api_server)
  ├─ authenticateToken → req.user set
  ├─ evaluateMcpFirstToolGate() → check Authorize rules (HITL, step-up, scope)
  ├─ agentMcpTokenService.resolveMcpAccessToken() → RFC 8693 exchange with PingOne
  └─ mcpWebSocketClient → WebSocket ws://localhost:8080
      ↓
MCP Server (demo_mcp_server)
  ├─ BankingToolRegistry.ts → tool schema + scopes
  ├─ BankingToolProvider.ts → execute tool
  └─ BankingAPIClient → call BFF /api/*
      ↓
BFF again (fetch banking data)
  └─ BFF response → tool result → MCP WS → Browser
```

### Key Service Files

| File | Language | Role |
|------|----------|------|
| `demo_api_server/server.js` | JS | Express app, middleware order, route registration |
| `demo_api_server/services/configStore.js` | JS | Runtime config — env, KV, LMDB resolution |
| `demo_api_server/services/agentMcpTokenService.js` | JS | RFC 8693 token exchange orchestration |
| `demo_api_server/services/mcpWebSocketClient.js` | JS | BFF ↔ MCP WebSocket pooled connection |
| `demo_mcp_server/src/tools/BankingToolRegistry.ts` | TS | All MCP tools: schema, scopes, definitions |
| `demo_mcp_server/src/tools/BankingToolProvider.ts` | TS | Tool execution: validation, scope check, call handler |
| `demo_api_ui/src/services/bffAxios.js` | JS | Axios wrapper for cookie-authenticated BFF calls |
| `demo_api_ui/src/components/BankingAgent.js` | JSX | Agent FAB, HITL modal, tool result display |

---

## TypeScript Strict Mode

All TypeScript services use strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

**When editing TypeScript:**
- All variables must have explicit types
- No `any` (use generics or union types)
- No `!` non-null assertion (use proper narrowing)
- Fix compilation errors before `npm run build`

```typescript
// ❌ Wrong
const toolName = params.name;  // implicit any

// ✅ Right
const toolName: string = params.name;
```

---

## Environment Variable Best Practices

### Quoting Secrets

**Always quote secrets** if they contain special characters (`~`, `-`, `.`, `:`):

```bash
# ❌ Wrong — shell parsing breaks:
PINGONE_CLIENT_SECRET=x6Ee...8u0_w8F9a.qA9-j47z

# ✅ Right — quoted:
PINGONE_CLIENT_SECRET="x6Ee...8u0_w8F9a.qA9-j47z"
```

### Credentials Priority (Highest to Lowest)

1. **Vault** (Phase 269) — encrypted at rest
2. **Runtime configStore** — set via `/config` UI
3. **Explicit `PINGONE_*` env vars** (e.g., `PINGONE_ADMIN_CLIENT_ID`)
4. **Fallback env vars** (e.g., `PINGONE_MGMT_CLIENT_ID` → `PINGONE_ADMIN_CLIENT_ID`)
5. **Built-in defaults** (e.g., `PINGONE_REGION` → `com`)

See [ENV_VARS.md](ENV_VARS.md) for the complete list.

### Never Commit Secrets

- Use `.env.example` as a template (no real values)
- Commit `.env.example`; ignore `.env`
- Use a team vault (1Password, LastPass) for real secrets
- If a secret leaks, rotate it immediately in PingOne

---

## Test Patterns: Regression vs. Integration

Critical BFF routes (OAuth, HITL, sessions) use a two-tier test pattern:

### Regression Tests (`*.regression.test.js`)

```javascript
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const defaults = {
      'ff_hitl_enabled': 'true',
      'confirm_threshold_usd': '500',
    };
    return defaults[key] || null;
  }),
}));

// Mock everything: auth, data store, external services
jest.mock('../../middleware/auth', () => ({ /* ... */ }));
jest.mock('../../data/store', () => ({ /* ... */ }));

describe('HITL transaction consent', () => {
  it('should require consent for transfer > $500', () => {
    // Test logic in isolation — fast, no external deps
  });
});
```

**Purpose:** Logic correctness in isolation; fast; no side effects.

### Integration Tests (`*.integration.test.js`)

```javascript
// configStore NOT mocked — uses real .env
jest.mock('../../data/store', () => ({ /* ... */ }));
jest.mock('../../services/transactionConsentChallenge', () => ({ /* ... */ }));

describe('HITL with real configStore', () => {
  it('should use confirm_threshold_usd from .env', () => {
    // Tests route + service interaction with real config
  });
});
```

**Purpose:** Real environment config; verifies .env values work end-to-end.

### When to Add a Test Pair

1. Critical security/session/HITL flows (§1 files)
2. Routes that depend on feature flags (`ff_hitl_enabled`, etc.)
3. Session validation or token expiry logic
4. Phase 170+ critical rules (transfer HITL, step-up gates)

---

## Performance & Load Considerations

### MCP WebSocket Pooling

The BFF maintains a **pooled WebSocket connection** to MCP. Never:
- Open a new connection per tool call (reuse the pool)
- Hold references to the socket outside the pool manager
- Release the slot before the response is complete

The pool is bounded: `MCP_WS_MAX_CONCURRENT` (default 10) prevents unbounded concurrent tool calls.

### Session Store

The BFF uses an **LMDB-backed session store** with an **in-memory fallback** — no Redis is involved.
- Primary store: LMDB at `demo_api_server/data/persistent/lmdb/`
- Falls back to in-memory storage if LMDB is unavailable (sessions are then lost on restart)
- LMDB sessions persist across service restarts

---

## Troubleshooting

### "Cannot find module '.../dist/index.js'"

**Cause:** TypeScript service built but `dist/` is stale or missing.

**Fix:**
```bash
cd <service> && npm run build
./run.sh restart
```

### "ECONNREFUSED localhost:3001" from UI

**Cause:** BFF not running or listening on wrong port.

**Fix:**
```bash
./run.sh status           # check if BFF is running
tail -f /tmp/demo-api.log
# Look for: "listening on :3001"
```

### "Session expired" after login

**Cause:** Session store failure (LMDB unavailable, so the in-memory fallback dropped the session) or the session cookie was not set.

**Fix:**
```bash
# Check the LMDB session store directory exists and is writable:
ls -la demo_api_server/data/persistent/lmdb/

# Check session cookie in browser:
# DevTools → Application → Cookies → connect.sid
# If missing: login again

# Check BFF logs:
grep -i "session\|lmdb" /tmp/demo-api.log
```

### "invalid_scope" during OAuth login

**Cause:** Scope mismatch between app definition and request.

**Fix:**
1. Read REGRESSION_PLAN.md §1 row "PingOne authorize `resource` + mixed scopes"
2. Check `routes/oauthUser.js` and `routes/oauth.js` — do not revert to always appending `&resource=`
3. Verify PingOne app definition has correct scopes

### UI build fails: "Cannot find module"

**Cause:** Missing import or typo in React code.

**Fix:**
```bash
cd demo_api_ui && npm run build
# Read error output carefully — shows file + line number
# Fix the import path
npm run build
# Repeat until exit code is 0
```

### "MCP token exchange failed: act claim absent" (non-blocking warning)

**Expected behavior:** Not all PingOne token policies emit `act` claims. The agent still works; the claim is advisory.

**To debug:** Check `/tmp/demo-api.log` for `[McpExchangerToken]` entries. Token Chain UI shows `⚠️ act absent` but does not block.

### Agent tool calls are slow

**Cause:** Could be MCP WS pool saturation, PingOne token exchange latency, or database queries.

**Debug:**
```bash
grep "\[McpToolAuth\]\|\[McpExchange\]" /tmp/demo-api.log | tail -50
# Look for duration/latency entries
```

---

## References

- [CLAUDE.md](../../CLAUDE.md) — Agent behavior rules + non-negotiables
- [REGRESSION_PLAN.md](../../REGRESSION_PLAN.md) — Do-not-break critical areas (mandatory read)
- [ENV_VARS.md](ENV_VARS.md) — Environment variable reference
- [ARCHITECTURE-TRUTHS.md](../ARCHITECTURE-TRUTHS.md) — System invariants (token custody, routing, authorization)
- [`run.sh`](../../run.sh) — Startup script (shows port layout, service list)
- [`.claude/skills/`](../../.claude/skills) — Domain-specific developer skills (OAuth, MCP, BFF, etc.)
