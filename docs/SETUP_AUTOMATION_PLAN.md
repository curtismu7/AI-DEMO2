# Super Banking — Full tenant setup automation plan

> **Goal:** A new operator can bring a **fresh PingOne environment** + **fresh app deployment** to “first successful admin login + customer login + agent MCP” with **minimal manual PingOne console work**, using **scripts**, a **Setup** wizard page (buttons + status), and **idempotent** Management API calls.

This complements (does not replace) today’s pieces:

| Already exists | Role |
|----------------|------|
| [`/onboarding`](../banking_api_ui/src/components/Onboarding.js) | Static checklist → `/config` |
| [`scripts/setup-vercel-env.js`](../scripts/setup-vercel-env.js) + `npm run setup:vercel` | Vercel env wizard + optional `vercel env add` |
| [`/config`](../banking_api_ui/src/components/Config.js) | Manual PingOne field entry |
| [`POST /api/authorize/bootstrap-demo-endpoints`](../banking_api_server/routes/authorize.js) | Worker token → create/reuse **Authorize decision endpoints** + save IDs |
| [`/demo-data`](../banking_api_ui/src/components/DemoDataPage.js) (admin) | Demo toggles, MCP scopes, Authorize bootstrap UI |
| OAuth callbacks | **First login** creates **local** `dataStore` users (not PingOne user provisioning) |

---

## 1. What “ready” means (definition of done)

Use this as the **Setup** page “all green” checklist:

1. **Hosting**
   - Vercel (or other) **deployed**; `REACT_APP_CLIENT_URL` / `PUBLIC_APP_URL` correct.
   - **Session store** (Upstash / Redis) on serverless — **required** for real tokens ([`REGRESSION_PLAN.md`](../REGRESSION_PLAN.md)).
2. **PingOne environment**
   - `PINGONE_ENVIRONMENT_ID`, `PINGONE_REGION` known.
3. **OAuth applications (two)**
   - **Admin** OIDC app: auth code + PKCE (or confidential + secret per your choice); redirect `…/api/auth/oauth/callback`.
   - **End-user** OIDC app: redirect `…/api/auth/oauth/user/callback`.
   - Correct **grant types**, **scopes** requested (see §4).
4. **Optional but demo-complete**
   - **Resource server** (audience) + **custom scopes** (`banking:*`) if you want Token Chain / RFC 8693 demos without synthetic `may_act`.
   - **Worker** app(s): Management / Authorize / Notifications — client credentials, correct roles.
   - **MCP** `wss://` deployment + `MCP_SERVER_URL`.
   - **Authorize** decision endpoints (button on Demo Data or this plan’s Setup page).
5. **Test identities**
   - PingOne directory users (e.g. `bankadmin`, `bankuser`) **or** document “use any user in population X”.
6. **First-run app verification**
   - Admin login → `/admin` → Config readable.
   - User login → `/dashboard` → accounts load.
   - BankingAgent → tool call succeeds (local or exchanged MCP token).

---

## 2. Hard truths (scope boundaries)

| Expectation | Reality |
|-------------|---------|
| “User does nothing” | **Impossible without one bootstrap secret.** Something must authenticate **first** Management API call: e.g. long-lived **worker** client, **personal access token**, or interactive PingOne login once. |
| Create every PingOne product feature | **Authorize policies**, **DaVinci flows**, **risk policies** are often **UI-first** or need **specific licenses**. Automate **what the Platform API supports**; link docs for the rest. |
| Same script for every PingOne SKU | **Feature flags** in manifest: `authorize: false`, `resourceServer: true`, etc. |
| Create apps without Management API scopes | Worker app must have **`p1:read:` / `p1:update:` / `p1:create:`** style permissions for **applications**, **resources**, **users** — exact scope names depend on PingOne **role** assigned to that worker. |

**Recommendation:** Standardize on **one “Infrastructure worker”** PingOne application (client credentials) stored only in **env** / **Setup master key** flow — never in browser.

---

## 3. Target architecture

### 3.1 Manifest-driven bootstrap (single source of truth)

Add `config/pingone-bootstrap.manifest.json` (or `.yaml`) describing:

- Environment metadata (region).
- **Resource server**: name, audience URI, list of scopes (name + description).
- **Applications**: `admin_oidc`, `user_oidc`, `management_worker`, `authorize_worker`, `agent_cc` (optional) — type, grants, redirect URI templates (placeholders `{PUBLIC_URL}`), requested scope names.
- **Populations** (if not default).
- **Users**: `bankadmin`, `bankuser` — username, email, population, `password: "${SETUP_GENERATED}"` or omit and force password reset email.
- **Post-steps**: enable Token Exchange on BFF app, `may_act` documentation links (PingOne cannot always set via API in all tenants).

**Idempotency:** Each step searches by **name** or **clientId** pattern before create (same pattern as Authorize demo endpoints).

### 3.2 Implementation layers

| Layer | Responsibility |
|-------|------------------|
| **`banking_api_server/services/pingoneBootstrapService.js`** (new) | Pure functions: `ensureResourceServer`, `ensureApplication`, `ensureUser`, … using `fetch` + worker token. |
| **`scripts/pingone-bootstrap.js`** (new) | CLI: load manifest, read env `PINGONE_BOOTSTRAP_WORKER_ID/SECRET` (or token), run all steps, print **summary JSON** (client IDs, redirect URIs to paste if needed). |
| **`POST /api/setup/pingone/run`** (new route, gated) | Same logic as script; returns structured result for UI. |
| **`SetupPage.js`** (new) + route `/setup` | Stepper UI: prerequisites → run bootstrap → copy env snippet → “Verify” buttons calling existing `/api/auth/debug`, `/api/admin/config`, optional probe MCP. |

### 3.3 Security gate for Setup API

Avoid open **tenant takeover**:

- **Option A:** `SETUP_MASTER_KEY` header required for any `/api/setup/*` until `configStore.isConfigured()` is true, then disable route.
- **Option B:** Allow only when `!configStore.isConfigured()` **and** hosting is local, or **admin session** + explicit “I am resetting tenant” flag.

Document chosen option in [`REGRESSION_PLAN.md`](../REGRESSION_PLAN.md) **Critical** row if it touches OAuth/session.

---

## 4. PingOne objects to create (ordered)

**Order matters** (dependencies):

1. **Resource server** + **scopes** (if using custom `banking:*` audience).
2. **Populations** (if not using default).
3. **Admin OIDC application** — attach redirect URIs; request scopes (`openid profile email` + optional resource scopes).
4. **User OIDC application** — same.
5. **Grant / Token Exchange** — often **PATCH application** to add token exchange grant and **resource access**; some steps are **console-only** depending on API version — detect and return `manualSteps[]` in API response.
6. **Worker apps** (split or combined):
   - **Management worker** — for bootstrap script + optional ongoing automation.
   - **Authorize worker** — already used by `pingOneAuthorizeService`.
   - **Agent CC** — RFC 8693 actor (optional).
7. **Role assignment** — worker must have permissions to manage apps/users (PingOne **Identity Roles** or equivalent).
8. **Directory users** `bankadmin` / `bankuser` — `POST .../users`, set password or `PASSWORD_FORCE_CHANGE`.
9. **Authorize** — policies still **UI** or **import**; **decision endpoints** already automatable via existing bootstrap API.

---

## 5. Scripts (concrete deliverables)

| Script | Purpose |
|--------|---------|
| `npm run setup:vercel` | *(exists)* Env vars for deploy. |
| `npm run pingone:bootstrap` | *(new)* Node CLI → full manifest apply; outputs `.env.generated.snippet`. |
| `npm run pingone:bootstrap -- --dry-run` | Print planned creates only. |
| `npm run pingone:bootstrap -- --step=users` | Partial apply for debugging. |

**Optional:** Shell wrapper `scripts/run-full-setup.sh` that runs `setup:vercel` (if Vercel) → `pingone:bootstrap` → `vercel env add` for new IDs (non-secret).

---

## 6. New **Setup** page (UI) — sections & buttons

Route: **`/setup`** (public or gated — see §3.3).

1. **Prerequisites** (read-only cards)
   - Links: PingOne admin console, this doc, `.env.vercel.example`.
2. **Deployment URL**
   - Input: production URL → show **exact** redirect URIs (reuse `getOAuthRedirectDebugInfo` from config GET).
3. **PingOne connection test**
   - Button: “Test environment” → existing `POST /api/admin/config/test` pattern or dedicated `GET /api/setup/pingone/ping`.
4. **Run bootstrap**
   - Inputs: **only if** not using env-only worker (e.g. paste one-time worker secret — warn not to save in browser).
   - Button: **“Create PingOne resources & apps”** → `POST /api/setup/pingone/run`.
   - Result table: created vs skipped vs **manual required** (with deep links to PingOne docs).
5. **Apply to this deployment**
   - If KV writable: write `admin_client_id`, `user_client_id`, … via `configStore.setConfig`.
   - If read-only: show **copy block** for Vercel env (integrate with `setup-vercel-env` output format).
6. **Create demo users**
   - Button: **“Ensure bankadmin & bankuser in PingOne”** (subset of manifest or dedicated endpoint).
7. **Post-config assistants** *(reuse existing)*
   - Link: **Demo data** → Authorize decision endpoint button.
   - Link: **Config** for fine-tuning.
8. **Verification**
   - Buttons: “Open admin login”, “Open user login”, “Probe MCP”, “Session debug JSON”.

**Navigation:** Add **Setup** link on [`LandingPage`](../banking_api_ui/src/components/LandingPage.js) next to onboarding for unauthenticated users; add admin quick link from `/admin`.

---

## 7. Work breakdown (phased — “a lot” split safely)

### Phase A — Documentation & manifest (1–2 PRs)

- [ ] This plan + update [`Onboarding.js`](../banking_api_ui/src/components/Onboarding.js) to link **`/setup`** when automation exists.
- [ ] Add `config/pingone-bootstrap.manifest.json` with **commented** example matching current `configStore` field names.

### Phase B — `pingoneBootstrapService` + CLI (2–4 PRs)

- [ ] Worker token helper (reuse pattern from `pingOneAuthorizeService.getWorkerToken` but for **bootstrap** client — may be **different** app from Authorize worker).
- [ ] Implement **read-first** helpers: list apps by name, list resources, list users by username.
- [ ] Implement creates: resource + scopes, OIDC apps, users.
- [ ] `scripts/pingone-bootstrap.js` + `package.json` script.
- [ ] Unit tests with **mocked `fetch`** (no live PingOne in CI).

### Phase C — BFF `/api/setup/*` (1–2 PRs)

- [ ] `POST /api/setup/pingone/run` + gate from §3.3.
- [ ] `GET /api/setup/status` — manifest hash, last run timestamp (store in KV or omit on read-only).

### Phase D — **Setup** React page (1–2 PRs)

- [ ] `SetupPage.js`, route in [`App.js`](../banking_api_ui/src/App.js).
- [ ] Wire buttons to APIs; toasts + copy-to-clipboard for env snippets.

### Phase E — Hardening

- [ ] E2E smoke: optional Playwright “setup → login” against **mock** or **dedicated test env**.
- [ ] REGRESSION_PLAN entry for Setup route + API (FAB/nav unchanged per rules).

---

## 8. Open questions (decide before coding Phase B)

1. **Single worker vs many:** One Management super-worker vs separate Authorize/Management workers? (Security vs simplicity.)
2. **Confidential vs public** admin/user apps on localhost vs production.
3. **Password for `bankadmin` / `bankuser`:** Fixed dev password (documented) vs force change on first login.
4. **Token Exchange + `may_act`:** Fully automated vs “manual step” card with screenshot link.
5. **MCP server:** Out of PingOne scope — Setup page only **validates** `MCP_SERVER_URL` reachable (optional `wss` probe).

---

## 9. Success criteria

- [ ] New engineer with **PingOne env + empty Vercel project** can follow **Setup page** + **two npm scripts** and reach **admin dashboard** without opening PingOne console **except** where API returns `manualSteps` (explicitly listed).
- [ ] All automation **idempotent** (safe to re-run).
- [ ] No OAuth client secrets in browser storage; Setup paste flow uses **one-time** display only.

---

## 10. References (implementers)

- PingOne Platform APIs — [Decision endpoints](https://developer.pingidentity.com/pingone-api/authorize/authorization-decisions/decision-endpoints.html) (create — already used in app).
- Repo: [`pingOneAuthorizeService.js`](../banking_api_server/services/pingOneAuthorizeService.js), [`clientRegistration.js`](../banking_api_server/routes/clientRegistration.js), [`setup-vercel-env.js`](../scripts/setup-vercel-env.js).
- Internal skill: **pingone-api-calls** (Management API patterns).

---

*Document version: 2026-03-29 — planning only; implementation tracked in Phase A–E above.*
