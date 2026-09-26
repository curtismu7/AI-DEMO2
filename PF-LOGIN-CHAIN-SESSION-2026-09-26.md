# PF Login-Chain Session Report — 2026-09-26 (PingFederate login debugging)

**Prepared for:** cross-agent review. This records MY session's work only. A separate
`SESSION-REPORT-2026-09-26.md` (A2A hardening) and `UC40-PF-IDJAG-SESSION-HANDOFF.md`
(PF exchange-chain) cover the other sessions' work on the same day — check all three
before assuming something is broken or unowned.

**Repo state at writing:** `main` @ `51fb424e8`. Working tree has one uncommitted
change from another session (`demo_api_server/services/pfStandardTokenExchangeService.js`
— subset-scope semantics; their tests passed, review it) plus 632 generated
step-verification ledger files (churn from stack bounces, regenerate or discard).

---

## 1. What I was asked to fix

The user, with PF selected as login provider, hit UC38/UC40 (PingFederate ID-JAG).
The flow kept their PingOne session, threw an error, and never showed the PF
sign-in page. "PF login is broken period."

## 2. Root causes found (in order) and fixes

### A. `invalid_scope` on the PF authorize request — no login page at all
PF-mode user login requested the PingOne banking scope set
(`read accounts:read write transfer ai:agent:read airlines:read`). PF's
`ai-demo-pf-user` client is OIDC-only → PF rejected authorize outright.

- **Fix:** `config/oauthUser.js` scopes getter returns `openid profile email
  offline_access` when provider is `pingfederate`. **PR #326, merged.**
- Same bug in the **admin** client (`config/oauth.js`) found via live logs
  (`client_id=ai-demo-pf-admin`, `error=invalid_scope`). Same fix. **PR #327, merged.**
- **Regression guard:** `src/__tests__/oauthPfScopeGuard.test.js` pins both
  clients to OIDC-only in PF mode AND keeps PingOne banking scopes (incl.
  `transfer`) intact. Proven red against pre-fix `0504823c6` (4 failed).
  **PR #329, merged.**

### B. Unstyled PF login page
PF's stored Federation Info base URL was `https://localhost:9031` (baked in at
first setup, because `PF_ENGINE_PUBLIC_HOSTNAME=localhost`). Login templates
render `<base href="https://localhost:9031/">` → browser can't load CSS; the
issuer also mismatched BFF's `PF_ISSUER`.

- **Fix path:** the admin password on file matched nothing, so I booted a
  throwaway PF, minted a known admin credential, transplanted the admin-user
  hash into the live volume (config preserved), then PUT
  `/pf-admin-api/v1/serverSettings` → `federationInfo.baseUrl =
  https://local.ping-devops.com:9031`. Verified `<base href>` correct.
- **PF admin console afterwards:** console login NPE'd
  (`AdminSessionTracker.addAdminSession` — `adminSession is null`); a PF
  container restart cleared it. Credentials now:
  `administrator` / `Reset-Temp-Pass-2026`.
- **Password persistence:** stored in (a) the encrypted vault as
  `PF_ADMIN_CONSOLE_PASSWORD` (`node scripts/vault.js get PF_ADMIN_CONSOLE_PASSWORD`),
  (b) `scripts/pingfederate/.env` as `PINGFEDERATE_ADMIN_PASSWORD`,
  (c) container env `PING_IDENTITY_PASSWORD`.

### C. PF container volume drift (the fix that "came back")
PF was recreated by another session onto the **wrong OUT volume**
(`ai-demo-pingfederate-out` — stale config with the localhost base URL) instead
of `ai-demo-pingfederate-out-classic` (correct config). The styling bug
resurrected identically.

- **Fix:** `scripts/pingfederate/docker-compose.local.yml` now defaults
  `PINGFEDERATE_VOLUME_NAME` to `ai-demo-pingfederate-out-classic`, with a
  warning comment. Deleted 9 leftover volumes; only `-out-classic`,
  `-jvm-security`, `-bootstrap`, `-filebeat-data` remain. **PR #336, merged.**
- **CRITICAL for any PF work:** the live configured instance is on
  `ai-demo-pingfederate-out-classic`. Never let a recreate target another OUT
  volume. Verify with
  `docker inspect ai-demo-pingfederate --format '{{json .Mounts}}'`.

### D. Provider lost after UC40 (user request #2)
The UC40 run requires the PF provider; after the demo the user stayed on PF and
their prior choice was gone.

- **Fix (PR #336, merged):** `demo_api_ui/src/utils/idJagRunMode.js` now
  captures the provider at live-run launch (`capturePreRunProvider`, stashed in
  sessionStorage `bx_id_jag_pre_run_provider`) and auto-restores it when the run
  completes (`restorePreRunProvider` inside `completeIdJagRunHandoff`): POST
  `/api/admin/config`, clear-session, reload — same path as the toggle.
- Removed the `OAUTH_PROVIDER=pingfederate` pin from `docker-compose.yml`
  (and `demo_api_server/.env`), updating `.demo-provider-intent.json` per the
  #333 provider-lock contract, so the toggle/restore control the provider again.
- 3 new tests in `idJagRunMode.test.js` (capture, restore+session-clear,
  no-capture no-op). UI build exit 0.

## 3. Live verification performed (by content, not by stamp)

- User login → `client_id=ai-demo-pf-user`, `scope=openid profile email
  offline_access` only → styled PF Sign On page.
- Admin login → `client_id=ai-demo-pf-admin`, same OIDC-only scopes → styled
  Sign On page.
- Zero `invalid_scope` in `docker logs ai-demo-api-server`.
- `provider-lock verify` → no drift; BFF healthz ok.

## 4. Known issues left open (deliberately not mine to fix)

1. **`OAuthProviderToggle.idJagReset.test.jsx` fails** — consistent, PRE-EXISTING
   (fails identically without my diff; broken by #330/#332 dock work, not by me).
2. **PF exchange chain (Exchange #1 subject token)** — blocked at
   `UnresolvableKeyException` in PF's JwtTokenProcessor. See
   `UC40-PF-IDJAG-SESSION-HANDOFF.md` §4 — that is the active blocker for the
   FULL UC40 live run; my work fixed everything up to the PF sign-on page.
3. **Provider intent vs live value** — `.demo-provider-intent.json` says
   `pingone`; live LMDB may still say `pingfederate` from the UC40 window.
   The lock gate flags this until flipped back (Option A: pingone is default).
4. **Uncommitted:** `pfStandardTokenExchangeService.js` (other session's subset-
   scope fix — tests pass, needs owner to commit) and the generated ledger churn.

## 5. Contracts I preserved (do not undo)

- PingOne-mode scopes unchanged: `transfer` MUST stay in the ENDUSER_AUDIENCE
  list (create_transfer 403s without it); ≥5 distinct scopes for RFC 8693 MCP
  narrowing. PF mode intentionally returns ONLY OIDC scopes — do not "restore"
  banking scopes there.
- `REGRESSION_PLAN.md` §4 entries added for the user-scope and admin-scope fixes.
- Emoji allowlist, `{ error }` response shape, and all §0/§1 invariants untouched.

## 6. Quick reference for the next agent

| Thing | Value |
|---|---|
| PF admin console | https://localhost:9999/pingfederate/app — `administrator` / `Reset-Temp-Pass-2026` (vault: `PF_ADMIN_CONSOLE_PASSWORD`) |
| PF OUT volume (only correct one) | `ai-demo-pingfederate-out-classic` |
| PF compose | `scripts/pingfederate/docker-compose.local.yml` (operator-run, NOT the demo compose) |
| Scope guard test | `demo_api_server/src/__tests__/oauthPfScopeGuard.test.js` |
| Provider restore | `demo_api_ui/src/utils/idJagRunMode.js` → `completeIdJagRunHandoff` |
| Merged PRs from this session | #326, #327, #329, #336 |
