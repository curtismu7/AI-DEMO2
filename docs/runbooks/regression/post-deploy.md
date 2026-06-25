# Regression — Post-Deploy Manual Checks

Run after every production **or** preview deploy.

## 1. Sign in and check the debug endpoint

1. Sign in with PingOne (customer or admin).
2. Open **`/api/auth/debug?deep=1`** in a new tab (same origin as the app).
3. Confirm:
   - **`accessTokenStub: false`** — if `true`, MCP/NL will not work (see `REGRESSION_LOG.md`).
   - **`sessionStoreHealthy: true`** — if `false`, check `sessionStoreError` and Vercel env for `KV_REST_*`.
   - **`redisPersist.redisKeyPresent: true`** — if `false`, the `connect.sid` row is missing in Redis. Sign out and sign in again to re-create it.

## 2. Customer Dashboard smoke

| Check | Expected |
|---|---|
| Navigate to `/dashboard` without signing in | Demo accounts load + toast appears once |
| Auto-refresh fires (every 5 s) | Toast does NOT re-appear (deduped `toastId`) |
| Sign in as end user | Real accounts replace demo data, no toast |
| CIBA / CIMD / Demo config FABs | Fixed left rail; **quick nav** (Home / Dashboard / API / Logs) **only** on signed-in **`/`**, **`/admin`**, **`/dashboard`** (plus **Banking** for admins on **`/admin/banking`**) — not on landing or `/config` |
| **Banking Agent (floating)** | **Only** on signed-in dashboard homes **`/`**, **`/admin`**, **`/dashboard`** — not on marketing landing, config, logs, MCP, etc. Open FAB → panel readable (chips, suggestions). |
| **HITL consent** | High-value transfer/deposit/withdraw from customer dashboard → **consent popup** (checkbox to allow the assistant to complete the transaction); decline/success closes modal + toast. Deep link **`/transaction-consent?challenge=…`** shows the same popup. |
| Main content | Does not sit under the left rail (`.App--has-quick-nav` inset when quick nav is shown) |
| **Split vs Classic** (customer) | Toolbar **Split view** / **Classic** toggles three-column (token \| agent \| banking) vs prior layout; page reload may apply after change. |
| **Split view — embedded agent** | Middle column: tall scrollable chat, thin prompt row, scrollable chip/tray below; **Embedded** bottom dock uses **Classic** layout (split suppresses duplicate dock). Education shortcuts: **hamburger** (top-right). |
| Learn bar | **Agent UI** (Floating / Embedded / Both) + layout toggle when signed in on customer dashboard |
| "Customer Dashboard" title | Visible in the header |
| Home › Dashboard breadcrumb | Links render and navigate correctly |

## 3. Admin Dashboard smoke

| Check | Expected |
|---|---|
| Sign in as admin, open `/admin` | "Admin Dashboard" title, stats cards visible |
| **Customer lookup** | Username + last 4 phone returns profile (PingOne when linked), accounts, recent transactions |
| `/activity`, `/users`, `/accounts`, `/transactions` | All load without 403 |
| MCP Inspector (`/mcp-inspector`) | Tools list populates |
| Open **`/config`** signed in | **AI Agent layout** segmented control matches learn bar; **no** dashboard quick nav on this route |

## 4. Transaction consent / step-up

1. Trigger a transfer ≥ $250 as an end user.
2. Confirm HTTP **428** surfaces a **persistent step-up toast** (verify via CIBA, **Verify now** link, or **Dismiss**) — not a duplicate inline banner.
3. Complete CIBA or email step-up.
4. Confirm transfer proceeds and balance updates.

## 5. Token chain

Click the token-info gear icon on the Customer Dashboard toolbar.
- JWT header + payload display.
- `may_act` claim present (green) or absent (red warning) displayed correctly.
