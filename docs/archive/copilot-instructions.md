<!-- GSD:project-start source:PROJECT.md -->
## Project

**AI Demo**

A hands-on educational demo that teaches developers, architects, and conference audiences how to implement secure AI agent authentication using real OAuth 2.0 / OIDC standards. The demo shows three distinct authentication flows, two token exchange patterns (RFC 8693), CIBA, and the full MCP 2025-11-25 spec — all running live, with in-app education panels explaining each concept as it happens.

**Core Value:** A developer who completes a 5-minute walkthrough of the live demo should understand exactly how to implement a secure, delegated AI agent that acts on behalf of a human user without ever exposing raw tokens to the browser or the agent.

### Constraints

- **Tech stack**: Express + React CRA + TypeScript MCP — do not introduce new frameworks mid-milestone
- **Tokens stay server-side**: BFF must remain sole token custodian; no token exposure to browser
- **Vercel serverless**: Changes to session handling must account for Lambda isolation and cold starts
- **Build must pass**: `cd banking_api_ui && npm run build` exit 0 after every UI change; `tsc` clean in MCP server
- **Regression list**: Read `REGRESSION_PLAN.md` §1 before touching protected areas
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES2022) — `banking_api_server/` (Express BFF, plain CommonJS modules)
- TypeScript 5.x — `banking_mcp_server/src/` (strict mode, compiled to `dist/`)
- JavaScript (JSX) — `banking_api_ui/src/` (React, transpiled by CRA)
- Python 3.x — `langchain_agent/src/` (async, FastAPI-based agent)
## Runtime
- Node.js 20.x — `banking_api_server/`, `banking_mcp_server/`, `banking_api_ui/`
- Python 3.x — `langchain_agent/` (no pinned version; `requirements.txt` drives deps)
- npm >=9 — all JS/TS sub-projects (individual `package.json` per sub-project)
- pip — `langchain_agent/requirements.txt`
- Lockfile: `package-lock.json` present in each JS sub-project; no `poetry.lock` in agent
## Frameworks
- Express 4.18 — `banking_api_server/server.js` — HTTP BFF, OAuth proxy, banking APIs
- React 18.2 — `banking_api_ui/src/` — SPA via Create React App (react-scripts 5.0.1)
- React Router DOM 6.28 — client-side routing
- No web framework; custom WebSocket server via `ws` 8.14 + optional Streamable HTTP transport
- `@modelcontextprotocol/sdk` 0.5.0 — MCP protocol foundation
- FastAPI >=0.100 — `langchain_agent/src/api/` — health + inspector HTTP endpoints
- Uvicorn >=0.20 — ASGI server
- WebSocket transport via `websockets` >=11.0 — agent ↔ UI chat stream
- Jest 29.x — `banking_api_server/` + `banking_mcp_server/` (unit + integration)
- @playwright/test 1.44 — end-to-end tests in `banking_api_ui/tests/e2e/`
- @testing-library/react 13 — component unit tests in `banking_api_ui/src/`
- Supertest 7 — HTTP integration tests in `banking_api_server/`
- pytest >=7, pytest-asyncio, pytest-mock — `langchain_agent/tests/`
- react-scripts 5.0.1 (CRA) — UI build; outputs to `banking_api_ui/build/`
- tsc (TypeScript 5.x) — MCP server compile; outputs to `banking_mcp_server/dist/`
- nodemon 3 — dev hot-reload in BFF and MCP server
- ts-node 10.9 — MCP server dev execution without pre-compile
## Key Dependencies
- `express` ^4.18.2 — HTTP framework
- `express-session` ^1.19.0 — server-side session management
- `express-rate-limit` ^7.1.5 — API rate limiting
- `helmet` ^7.1.0 — HTTP security headers
- `jsonwebtoken` ^9.0.2 — JWT decode + verify for OAuth tokens
- `bcryptjs` ^2.4.3 — password hashing (demo users)
- `ws` ^8.19.0 — WebSocket client connecting BFF to MCP server
- `better-sqlite3` ^12.8.0 — local config persistence (`data/config.db`); used when KV not set
- `redis` ^5.11 + `connect-redis` ^9.0 — TCP Redis session store (self-hosted / Railway)
- `@vercel/kv` ^3.0 — Upstash REST session store + config KV (Vercel deployments)
- `@modelcontextprotocol/sdk` ^0.5.0 — MCP protocol types and SDK
- `ws` ^8.14.0 — WebSocket server
- `jsonschema` ^1.4.1 — tool input parameter validation
- `uuid` ^9.0.0 — session/correlation IDs
- `axios` ^1.4.0 — HTTP client to BFF
- `chart.js` ^4.3.0 + `react-chartjs-2` ^5.2 — dashboard charts
- `react-table` ^7.8.0 — transaction table rendering
- `react-toastify` ^11.0.5 — toast notifications
- `date-fns` ^2.30 — date formatting
- `langchain==0.0.353` — agent orchestration, tool binding
- `openai<1.0.0` — ChatOpenAI LLM provider (primary)
- `groq>=0.4.0` — Groq LLM provider (optional)
- `pydantic<2.0.0` — data validation (Pydantic v1 API)
- `cryptography>=41.0.0` — token encryption at rest
- `redis>=4.5.0` — optional token caching
- `sqlalchemy>=2.0.0` + `alembic>=1.10.0` — optional persistent storage
## TypeScript Configuration
- `target: ES2020`, `module: commonjs`
- `strict: true`, `esModuleInterop: true`, `skipLibCheck: true`
- `experimentalDecorators: true`, `emitDecoratorMetadata: true`
- `outDir: ./dist`, `rootDir: ./src`
- Source maps + declaration files emitted
## Configuration
- `.env` files loaded via `dotenv` in all sub-projects at startup
- Root `.env.example` is the canonical catalog of all variables across all apps
- Per-sub-project `.env.example` files are narrower copies
- Vercel injects env vars at runtime (no `.env` file on Vercel)
- `banking_api_server/services/configStore.js` provides runtime config: env vars → KV/SQLite fallback chain
- `vercel.json` — Vercel deploy config: `buildCommand: "cd banking_api_ui && npm run build"`, `outputDirectory: "banking_api_ui/build"`, API routes → `/api/handler`
- `banking_api_ui/.env` — `REACT_APP_*` variables baked at build time (CRA convention)
- TypeScript build: `npm run build` in `banking_mcp_server/` runs `tsc`
## Platform Requirements
- Node.js 20.x, npm >=9
- Python 3.x with pip
- Optional: Docker + docker-compose (MCP server dev/prod containers)
- Optional: Redis instance for multi-instance session testing
- Vercel — UI + BFF (serverless functions via `api/handler.js`)
- Railway / Render / Fly.io — MCP server (Docker; NOT deployed on Vercel)
- Replit — alternative full-stack hosting (BFF + UI)
- Upstash Redis — session store and config KV on Vercel (required for multi-instance)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Module Systems by Package
- CommonJS: `require()` / `module.exports = { ... }`
- Some files open with `'use strict';`
- No ES module syntax; no `.mjs` files
- ES modules: `import` / `export default` / named `export`
- JSX in `.js` files (not `.jsx`)
- ES module syntax compiled to CJS via `tsconfig.json`
- Barrel `index.ts` files in each subdirectory re-export everything: `export * from './server'`
## Naming Patterns
- `banking_api_server`: camelCase for services/utils (`configStore.js`, `authStateCookie.js`); kebab-case for test files (`oauth-error-handling.test.js`, `runtime-settings-api.test.js`)
- `banking_api_ui`: PascalCase for React components (`Accounts.js`, `BankingAgent.js`); camelCase for hooks (`useDemoMode.js`) and services (`bffAxios.js`, `configService.js`)
- `banking_mcp_server`: PascalCase for class files (`BankingToolProvider.ts`, `BankingSessionManager.ts`)
- camelCase everywhere: `validateAmount`, `fetchAccounts`, `restoreAccountsFromSnapshot`, `mockAdminSession`
- camelCase for locals and module-level `const`
- SCREAMING_SNAKE_CASE for feature flags and env-derived booleans: `SKIP_TOKEN_SIGNATURE_VALIDATION`, `DEBUG_TOKENS`, `USE_KV`
- PascalCase: `OAuthError`, `StructuredLogger`, `BankingToolProvider`, `BankingAPIClient`
- Object-as-enum pattern with SCREAMING_SNAKE_CASE values:
## Code Style
- No project-wide Prettier config; `banking_mcp_server/.eslintrc.js` is the only lint config
- Indentation: 2 spaces throughout
- Parser: `@typescript-eslint/parser`
- Extends: `eslint:recommended` + `plugin:@typescript-eslint/recommended`
- `@typescript-eslint/no-unused-vars`: **error** — prefix ignored params/vars with `_`
- `@typescript-eslint/no-explicit-any`: **off** — `any` is permitted
- `@typescript-eslint/explicit-function-return-type`: **off**
- No lint config for `banking_api_server` or `banking_api_ui` beyond CRA defaults
- `react-app` + `react-app/jest` (CRA defaults, configured in `package.json`)
## Import Organization
- None defined — all imports use relative paths
## Error Handling
- `middleware/auth.js` and `middleware/oauthErrorHandler.js` throw `OAuthError` instances
- `OAuthError(type, description, statusCode, additionalData)` — see `OAUTH_ERROR_TYPES`
- `formatOAuthErrorResponse(error, req)` serializes to RFC 6749 shape with `timestamp`, `request_id`, `path`, `method`
- `notifyError(msg)` — `src/utils/appToast.js`
- `toastAdminSessionError(msg, navigateFn)` — `src/utils/dashboardToast.js`
## Logging
- Route-level prefix in brackets: `[transactions]`, `[StepUp]`, `[Authorize]`, `[ConsentChallenge]`
- Emoji prefixes on business-significant events (transactions, step-up)
- Signature: `logger.level(category, message, metadata)`
- Categories: `OAUTH_VALIDATION`, `SCOPE_VALIDATION`, `TOKEN_INTROSPECTION`,
- `StructuredLogger` in `utils/logger.js` outputs JSON to console (with color) and optionally to files
- Use `logger` + `LOG_CATEGORIES` in middleware and services
- Use `console.*` in route handlers and data-layer helpers
## configStore Usage Patterns
- `.get()` is synchronous — safe in middleware and sync route code
- `.getEffective()` resolves: env var → KV/SQLite → default
- Call `await configStore.ensureInitialized()` at the top of routes that may be hit during Vercel cold-start (`mcpInspector.js`, `adminConfig.js`)
## Function Design
## Comments
- File-level JSDoc block describing purpose and key exports (`/** ... */`)
- Complex business logic (step-up thresholds, delegated access RFC 8693)
- Environment variable semantics (audience validation skip logic in `auth.js`)
- TODO in routes for known planned changes
## TypeScript (MCP Server)
- `interface` for DTO/data shapes: `ToolResult`, `Session`, `UserTokens`, `BankingAPIError`
- `class` for service implementations: `BankingToolProvider`, `BankingSessionManager`
- `export interface ToolExecutionContext { ... }` — named exports only, no default exports
- Unused params prefixed with `_` to satisfy `no-unused-vars` rule
- `any` type used freely (rule is off); prefer specific types where straightforward
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:docs/ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- All OAuth tokens are held server-side in the BFF (`banking_api_server`); the browser only holds an httpOnly session cookie (`connect.sid`)
- The React SPA (`banking_api_ui`) calls BFF exclusively via `bffAxios` (cookie-based, no Authorization header from browser)
- The BFF performs RFC 8693 Token Exchange to mint delegated MCP access tokens before proxying tool calls to `banking_mcp_server`
- `banking_mcp_server` is a stateful TypeScript process (WebSocket / JSON-RPC 2.0); the BFF connects via `ws://` (not HTTP REST)
- Vercel routes all `/api/*` traffic to `api/handler.js`, which re-exports the Express app — same codebase runs locally and serverless
## Layers
- Purpose: Browser client; renders admin and customer views
- Location: `banking_api_ui/src/`
- Contains: React components (74 in `components/`), pages, hooks, contexts, services
- Depends on: BFF — all API traffic via `bffAxios` or `apiClient`
- Used by: End users and admin operators in browser
- Purpose: Token custodian, OAuth orchestrator, banking API gateway, MCP proxy
- Location: `banking_api_server/server.js` (entry), `banking_api_server/routes/`, `banking_api_server/services/`, `banking_api_server/middleware/`
- Contains: 20 route modules, 36 service modules, 10 middleware modules
- Depends on: PingOne OAuth (AS), banking data store (`banking_api_server/data/store.js`), `banking_mcp_server` (WebSocket), Redis/Upstash (sessions)
- Used by: React SPA (browser), MCP Inspector, LangChain agent
- Purpose: MCP 2025-11-25 JSON-RPC tool server; executes banking tool calls on behalf of the BFF
- Location: `banking_mcp_server/src/index.ts` (entry), `banking_mcp_server/src/`
- Contains: `tools/` (registry, provider, validator, auth challenge handler), `auth/`, `banking/`, `server/`, `storage/`, `utils/`
- Depends on: `banking_api_server` HTTP API (via `BankingAPIClient`); PingOne token introspection
- Used by: BFF (`banking_api_server`) over WebSocket (`mcpWebSocketClient.js`)
- Purpose: Thin adapter — re-exports `banking_api_server/server.js` for Vercel's `@vercel/node` runtime
- Location: `api/handler.js`
- Contains: One line: `module.exports = require('../banking_api_server/server')`
- All `/api/*` requests are rewritten by `vercel.json` to this handler
- Purpose: Optional Python agent that drives banking operations via the BFF
- Location: `langchain_agent/`
- Status: Optional; not part of primary Vercel deployment
## Data Flow
- Same flow via `/api/auth/oauth/user/login` → `/api/auth/oauth/user/callback` (separate user-app OAuth client)
- React contexts: `SpinnerContext`, `EducationUIContext`, `TokenChainContext`, `AgentUiModeContext`, `IndustryBrandingContext`, `ThemeContext`
- `TokenChainContext` displays live `tokenEvents` metadata from MCP proxy responses
- Service singletons: `apiTrafficStore.js`, `mcpCallStore.js`, `toastLogStore.js` (in-memory stores for UI panels)
## Key Abstractions
- Purpose: Runtime-mutable config loaded from PingOne or env vars; all OAuth config reads go through this
- File: `banking_api_server/services/configStore.js`
- Pattern: Singleton with `configStore.getEffective(key)` — never read env vars directly in route handlers
- Purpose: Express middleware that validates Bearer tokens (JWT or session-backed) and sets `req.user`
- File: `banking_api_server/middleware/auth.js`
- Pattern: Checks `Authorization: Bearer` header first, then `req.session.oauthTokens.accessToken`; validates against PingOne JWKS via `tokenValidationService`
- Purpose: Static map of all MCP tool names → definition (description, schema, required scopes, handler name)
- File: `banking_mcp_server/src/tools/BankingToolRegistry.ts`
- Pattern: `BankingToolRegistry.getTool(name)` → `BankingToolDefinition`; add tools by adding entries to `TOOLS` map
- Purpose: Executes a named tool: validates params, checks auth scopes, calls `BankingAPIClient`
- File: `banking_mcp_server/src/tools/BankingToolProvider.ts`
- Pattern: `provider.executeTool(toolName, params, session, agentToken)` → `BankingToolResult`
- Purpose: Resolves the access token to send to MCP; handles RFC 8693 exchange chain and attaches `tokenEvents` for UI
- File: `banking_api_server/services/agentMcpTokenService.js`
- Pattern: `resolveAgentMcpToken(req, tool)` → `{ token, tokenEvents, userSub }`
- Purpose: Axios instance for all BFF calls; sends session cookie, no Authorization header
- File: `banking_api_ui/src/services/bffAxios.js`
- Pattern: Import and use instead of plain `axios` for any `/api/*` call
- Purpose: In-memory banking data (users, accounts, transactions); loaded from `bootstrapData.json` + `sampleData.js`
- Location: `banking_api_server/data/store.js`, `banking_api_server/data/bootstrapData.json`
- Pattern: Singleton accessed directly in route handlers
## Entry Points
- Location: `banking_api_server/server.js`
- Triggers: `node server.js` or `npm start` (default port 3001)
- Responsibilities: Full Express app init, session store selection, middleware chain, route registration
- Location: `banking_api_ui/src/index.js`
- Triggers: `npm start` in `banking_api_ui/` (port 3000 or `REACT_APP_API_PORT`)
- Proxy: `banking_api_ui/src/setupProxy.js` forwards `/api/*` to `localhost:3001` in dev
- Location: `api/handler.js`
- Triggers: All `/api/*` requests via `vercel.json` rewrite rule `{ "src": "/api/(.*)", "dest": "/api/handler" }`
- Static: React build served from `banking_api_ui/build/` as `outputDirectory`
- SPA fallback: `{ "src": "/.*", "dest": "/index.html" }` handles client-side routing
- Location: `banking_mcp_server/src/index.ts`
- Triggers: `npm start` in `banking_mcp_server/` (WebSocket on default port 8080)
- Responsibilities: Loads config, initializes `BankingAuthenticationManager`, `BankingSessionManager`, `BankingAPIClient`, `BankingToolProvider`, starts `BankingMCPServer`
## Error Handling
- BFF: `oauthErrorHandler.js` middleware catches OAuth-specific errors and maps to RFC 6749 JSON responses
- Token resolution failures: `throwTokenResolutionError()` in `agentMcpTokenService.js` attaches `tokenEvents` array so the UI Token Chain panel shows exactly what failed
- MCP tool errors: `BankingToolProvider` wraps all errors and returns `{ error: string, success: false }` — never throws to the WebSocket layer
- Session loss: `restoreSessionFromCookie` middleware rebuilds session identity from signed `_auth` cookie on cold starts; Upstash re-fetch recovers tokens
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
