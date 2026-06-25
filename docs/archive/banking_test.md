# Banking Digital Assistant — Test Reference

## Quick Start

```bash
# One-time: make the runner executable
chmod +x run-tests.sh

# Run all API tests
./run-tests.sh api

# Run everything (API + E2E)
./run-tests.sh all
```

---

## API Tests (Jest) — `banking_api_server/`

### Run Commands

```bash
cd banking_api_server

npm test                  # all 10 suites  (192 pass, 4 skip, 0 fail)
npm run test:unit         # fast regression only (~4 suites, no OAuth)
npm run test:auth         # OAuth + scope tests only
npm run test:all          # verbose output, all suites
npm run test:coverage     # with coverage report
```

### Top-Level Runner (`run-tests.sh`)

```bash
./run-tests.sh            # defaults to "api" mode
./run-tests.sh unit       # core regression only (fastest)
./run-tests.sh api        # all Jest suites
./run-tests.sh e2e        # Playwright only (needs API server on :3001)
./run-tests.sh all        # Jest + Playwright
```

### Test Suites (10 total)

| File | Tests | Notes |
|------|-------|-------|
| `step-up-gate.test.js` | ✅ all pass | Step-up authentication gate |
| `authorize-gate.test.js` | ✅ all pass | Authorization gate middleware |
| `runtime-settings-api.test.js` | ✅ all pass | Runtime settings endpoints |
| `transaction-flows.test.js` | ✅ all pass | Core CRUD transaction flows |
| `auth.test.js` | ✅ all pass | JWT auth middleware |
| `oauth-callback.test.js` | ✅ all pass | OAuth callback handling |
| `oauth-error-handling.test.js` | ✅ all pass | OAuth error scenarios |
| `scope-integration.test.js` | ✅ all pass | Scope-based authorization |
| `oauth-scope-integration.test.js` | ✅ all pass | OAuth + scope combined |
| `oauth-e2e-integration.test.js` | 13 pass / 4 skip | End-to-end OAuth flows |

**Result:** 10 suites, 192 passing, 4 skipped, **0 failures**

### 4 Skipped Tests (in `oauth-e2e-integration.test.js`)

These require full PKCE + session isolation that the in-process MemoryStore can't provide:

- `should complete full OAuth flow for end user`
- `should complete full OAuth flow for admin user`
- `should maintain OAuth tokens in session`
- `should handle session expiration`

To unskip: set up a real Redis session store and run the API server out-of-process.

---

## E2E Tests (Playwright) — `banking_api_ui/`

### Prerequisites

```bash
cd banking_api_ui
npx playwright install chromium   # one-time browser install
```

### Run Commands

```bash
cd banking_api_ui

npm run test:e2e          # headless Chromium
npm run test:e2e:ui       # interactive Playwright UI mode
```

### Spec Files (`tests/e2e/`)

| File | What it tests |
|------|--------------|
| `health.spec.js` | App health check — needs API server on :3001 |
| `admin-dashboard.spec.js` | Admin UI flows |
| `security-settings.spec.js` | Security settings pages |

> **Note:** `health.spec.js` requires `banking_api_server` running on port 3001.
> Start it with: `cd banking_api_server && node server.js`

---

## Key Technical Notes

### Why `setupFilesAfterEnv` matters
`banking_api_server/src/__tests__/setup.js` sets env vars (`SKIP_TOKEN_SIGNATURE_VALIDATION=true`, `DEBUG_TOKENS=true`) **before** any module loads. Without this, tokens are validated and most auth tests fail.

### Admin vs Scope middleware response shapes
- **`requireAdmin`** (admin routes) returns: `{ error: 'insufficient_scope', required_access: 'admin role or banking:admin scope' }`
- **`requireScopes`** (non-admin routes) returns: `{ requiredScopes, providedScopes, missingScopes, validationMode }`
- `/api/users GET` is special: `requireScopes(['banking:read'])` runs BEFORE `requireAdmin`, so a missing-scope error returns `requiredScopes` not `required_access`.

### Route → Service mapping (important for mocking)
- Admin OAuth: `routes/oauth.js` → `services/oauthService`
- User OAuth: `routes/oauthUser.js` → `services/oauthUserService`
- Both must be mocked separately when testing OAuth flows.

### jest.mock factory rule
`jest.mock()` factories are **hoisted before all code**. Factory functions must be inline literals — they cannot reference variables declared in the same file.

```js
// CORRECT — inline factory
jest.mock('../../services/oauthService', () => ({
  generateState: jest.fn(() => 'test-state'),
  ...
}));

// WRONG — variable not accessible (hoisting)
const impl = { generateState: jest.fn() };
jest.mock('../../services/oauthService', () => impl);  // impl is undefined
```

---

## File Locations

```
banking-digital-assistant/
├── vercel.json                                ← Vercel build + routing config
├── api/
│   └── handler.js                             ← Vercel serverless entry point
├── .env.vercel.example                        ← Vercel env var template
├── run-tests.sh                               ← top-level runner
├── banking_api_server/
│   ├── jest.config.js                         ← jest setup (setupFilesAfterEnv)
│   ├── package.json                           ← test:unit, test:auth, test:all scripts
│   └── src/__tests__/
│       ├── setup.js                           ← sets env vars before modules load
│       ├── step-up-gate.test.js
│       ├── authorize-gate.test.js
│       ├── runtime-settings-api.test.js
│       ├── transaction-flows.test.js
│       ├── auth.test.js
│       ├── oauth-callback.test.js
│       ├── oauth-error-handling.test.js
│       ├── scope-integration.test.js
│       ├── oauth-scope-integration.test.js
│       └── oauth-e2e-integration.test.js      ← 13 pass, 4 skip
└── banking_api_ui/
    ├── playwright.config.js
    └── tests/e2e/
        ├── health.spec.js
        ├── admin-dashboard.spec.js
        └── security-settings.spec.js
```

---

## Vercel Deployment

### Quick Deploy

```bash
# Install Vercel CLI (one-time)
npm i -g vercel

# From project root
cd /path/to/banking-digital-assistant
vercel
```

### Architecture on Vercel

```
https://<your-app>.vercel.app/
  /               → React build (banking_api_ui/build/)
  /api/*          → Express serverless (banking_api_server/server.js via api/handler.js)
```

The MCP WebSocket server must be hosted separately (Vercel doesn't support persistent WS):

| Service | Vercel-compatible hosts |
|---------|------------------------|
| `banking_mcp_server` | Railway, Render, Fly.io |

### One-Time Setup Checklist

1. **Redis** (required for OAuth sessions):
   - Go to [Upstash](https://upstash.com) or use **Vercel KV** (Dashboard → Storage → Add KV)
   - Copy the `REDIS_URL` (starts with `rediss://`)

2. **Deploy MCP server** (required for BankingAgent):
   ```bash
   cd banking_mcp_server && npm run build
   # Deploy to Railway/Render — copy the WebSocket URL
   ```

3. **Register OAuth redirect URIs in PingOne**:
   - Admin callback: `https://<your-app>.vercel.app/api/auth/oauth/callback`
   - User callback:  `https://<your-app>.vercel.app/api/auth/oauth/user/callback`

4. **Set Vercel environment variables** (see `.env.vercel.example`):
   ```bash
   vercel env add REDIS_URL
   vercel env add SESSION_SECRET
   vercel env add PINGONE_ENVIRONMENT_ID
   vercel env add PINGONE_AI_CORE_CLIENT_ID
   # ... (all vars listed in .env.vercel.example)
   ```

5. **Redeploy** after setting env vars:
   ```bash
   vercel --prod
   ```

### Local vs Vercel behaviour differences

| Feature | Local | Vercel |
|---------|-------|--------|
| Session store | MemoryStore | Redis (REDIS_URL required) |
| Data persistence | JSON files in `data/persistent/` | In-memory (resets on cold start) |
| MCP server | `localhost:8080` (local) | External host (MCP_SERVER_URL) |
| OAuth redirects | `http://localhost:3001/...` | `https://<app>.vercel.app/...` |
| API proxy | CRA `proxy` in package.json | Vercel rewrites in vercel.json |
