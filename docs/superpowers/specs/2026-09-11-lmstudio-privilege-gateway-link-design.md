# LM Studio Privilege Gateway Link — Design Spec
**Date:** 2026-09-11  
**Status:** Approved (design); pending spec review

---

## Goal

An MCP client (LM Studio) connected to the façade's Privilege door —
`http://localhost:3002/mcp-facade/privilege-gateway/<app>/mcp` — works without
anyone visiting `/privilege-mcp-client`. The client's own OAuth sign-in also
establishes the façade's upstream leg to the PingOne Privilege AI Gateway.

**Done when:** with the BFF's gateway session empty, clicking Authenticate on a
Privilege entry in LM Studio lists that app's tools, with no visit to
`/privilege-mcp-client`; the session survives an `ai-demo-api-server` recreate;
and each app (`opensearch22`, `opensearch`) holds its own gateway session.

## Why it breaks today (measured 2026-09-11)

| Fact | Evidence |
|---|---|
| The façade's gateway leg exists only after a human signs in at `/privilege-mcp-client` | `privilegeGatewaySession.remember()` has one caller, `/auth/callback` in `routes/privilegeMcpClient.js`, gated on Privilege mode |
| Without it, every authenticated call to the door answers 503 | `routes/mcpFacade.js` `ownsUpstreamAuth` branch: `Gateway session unavailable` |
| LM Studio reports that as "Authentication failed — SSE error: Non-200 status code (405)" | LM Studio 0.4.23 falls back to SSE on any non-`UnauthorizedError`; the façade answers GET with a deliberate 405 (`mcpFacade.js`, `router.get(['/:door/mcp', ...])`) |
| The session is in-memory, and the BFF container is recreated often | `ai-demo-api-server` recreated 15:55Z; several sessions share one stack (deploys, `serve:worktree`) |
| Gateway tokens live 60 minutes with no refresh token | LMDB session store: `expiresAt` = sign-in + 1h, `hasRefresh: false`; gateway AS metadata lists no `offline_access` |
| The gateway has no machine credential | AS metadata: `grant_types_supported: [authorization_code, refresh_token]` only |

So a browser sign-in is unavoidable at least hourly. This design moves it from
`/privilege-mcp-client` into the sign-in the MCP client already performs.

## Non-goals

- SE / k8s deployment (both switches stay unset there; tracked in `TECH_DEBT.md`).
- Making the `opensearch` app policy-blocked — a Privilege console change.
- Refresh tokens / `offline_access` from the gateway.
- Per-user gateway sessions — the module stays single-operator, keyed per app.

---

## Flow

One browser round trip covers both legs when an MCP client authenticates to a
Privilege door:

1. LM Studio → broker `http://localhost:3005/oauth/authorize?resource=http://localhost:3002/mcp-facade/privilege-gateway/<app>/mcp&…`. The broker now keeps `resource` on the pending authorization.
2. Broker → PingOne (`01d89b06`) → broker `/oauth/callback` — unchanged.
3. **New:** if `BFF_PRIVILEGE_LINK_URL` is set and `resource` matches `/mcp-facade/privilege-gateway/<app>/mcp`, the broker stores a *resume record* and redirects to `<BFF_PRIVILEGE_LINK_URL>?app=<app>&resume=<issuer>/oauth/resume?rs=<id>`.
4. BFF `GET /api/privilege-mcp/facade-link` runs the existing gateway sign-in (`beginOAuthFlow`: gateway DCR + PKCE) for `<gateway>/<app>/mcp`, in its own session slot and with its own callback. The gateway federates to the same PingOne tenant, so an existing PingOne session makes this silent.
5. BFF `GET /api/privilege-mcp/facade-link/callback` exchanges the code, stores the token for `<app>`, and redirects to `resume` with `link=ok` (or `link=error&reason=…`).
6. **New:** broker `/oauth/resume` issues its own code and redirects to LM Studio's loopback `redirect_uri` with the original `state` — exactly what `/oauth/callback` does today.

When an app's gateway token is missing or expired, the façade answers **401**
with an RFC 9728 challenge (flag on), so LM Studio re-runs steps 1–6 on its own.

---

## Components

### Broker — `demo_mcp_gateway` (image-built; deploy rebuilds it)

- `src/oauth/BrokerTokenStore.ts`
  - `PendingAuthorization` gains optional `resource`.
  - New resume records: `createResume(params) → id`, `consumeResume(id)`; single use, 10-minute TTL (same as pending). Params are what `createCode` needs: `clientId`, `redirectUri`, `scope`, `codeChallenge`, `codeChallengeMethod`, `clientState`, `pingOneAccessToken`, `pingOneExpiresIn`, `correlationId`.
- `src/oauth/OAuthBrokerRouter.ts`
  - `handleAuthorize`: store `resource` (query param) on the pending record.
  - `handleCallback`: after the PingOne token exchange and the `oauth.callback` hop, if `process.env.BFF_PRIVILEGE_LINK_URL` is set and `resource`'s path matches `^/mcp-facade/privilege-gateway/([A-Za-z0-9._-]+)/mcp$`, create a resume record and 302 to the link URL with `app` and `resume`. Otherwise unchanged.
  - New route `/oauth/resume` (GET): consume `rs`; unknown/expired → 400 `invalid_grant`. `link=ok` → `createCode` + 302 to the client `redirect_uri` with `code` and `state`. Anything else → 302 to the client `redirect_uri` with `error=access_denied`, `error_description=<reason, ≤300 chars>`, and `state`.
- `docker-compose.yml` (`mcp-gateway`): `BFF_PRIVILEGE_LINK_URL: "https://local.ping-devops.com:4000/api/privilege-mcp/facade-link"` — browser-facing, the host that holds the BFF session cookie.

### BFF — `demo_api_server` (bind-mounted)

- `services/privilegeGatewaySession.js`
  - Sessions keyed by app: `remember({ app, accessToken, refreshToken, expiresIn, tokenUri, clientId, clientSecret })`, `getAccessToken(app)`, `status(app)`, `clear(app)`.
  - No-arg calls resolve to the default app (`MCP_FACADE_PRIVILEGE_GATEWAY_APP || 'opensearch22'`), so `services/checks/privilegeMcpFirstCheck.js` and `/state` keep working unchanged.
  - New `statusAll()` → `{ [app]: status }` for `/state`.
  - Write-through persistence to a new LMDB DB `privilegeGatewaySessions` (`services/lmdb/privilegeGatewaySessionStore.lmdb.js`, same shape as `privilegeDoorStore.lmdb.js`); loaded lazily on first use. Writes are best-effort (`try/catch` + `console.warn`) — LMDB is at 108% of `mapSize` and an `MDB_MAP_FULL` must not break the in-memory session.
  - Expired entries with no refresh token are dropped on read. The header comment's "deliberately in-memory" rationale is rewritten (see Security).
- `routes/privilegeMcpClient.js`
  - `GET /facade-link?app=&resume=`: validate `app` against the façade's app-segment regex and `resume` (origin must equal `new URL(MCP_FACADE_AGENT_GATEWAY_AS || 'http://localhost:3005').origin`, path must be `/oauth/resume`); otherwise 400, no redirect. Build the door URL from `DEFAULT_PRIVILEGE_MCP_URL()`'s origin + `/<app>/mcp`, run `beginOAuthFlow` against a minimal session object for that door (Privilege mode, no `prompt=none`) with callback path `/api/privilege-mcp/facade-link/callback`, save its pending state and `app`/`resume` in `req.session.privilegeFacadeLink`, persist the session, 302 to the gateway authorize URL. Never touches `session.pendingAuth` or `session.config`.
  - `GET /facade-link/callback`: check `state` against `req.session.privilegeFacadeLink`; exchange the code via a helper shared with `/auth/callback` (factored out of it, no behaviour change there); `privilegeGatewaySession.remember({ app, … })`; clear the slot; 302 to `resume&link=ok`. Any failure → 302 to `resume&link=error&reason=…`; a missing slot → 400 (nothing safe to redirect to).
  - `beginOAuthFlow(session, req, { callbackPath })`: optional third argument; default keeps `/api/privilege-mcp/auth/callback`.
  - `getOrRegisterDcrClient`: cache key includes the redirect URI — the gateway binds a DCR client to its registered redirect URIs.
  - `/auth/callback`: `remember` now passes the app parsed from the door URL.
  - `/state`: `gatewaySession` keeps its top-level `ready`/`reason` (default app) and gains `apps: statusAll()`. The UI needs no change.
- `routes/mcpFacade.js`
  - `getAccessToken(req.params.app)` on the privilege door (both call sites).
  - No token and `MCP_FACADE_PRIVILEGE_LINK === 'true'` → 401, `WWW-Authenticate` built by the existing `rewriteChallenge(null, <PRM URL>, door.scopes)`, JSON-RPC body `{ code: -32001, message: 'Unauthorized', data: { reason: 'gateway_session_unavailable' } }`. Flag off → today's 503, unchanged.
  - Upstream 401 on a request that used the app's session → `privilegeGatewaySession.clear(app)` before relaying, so the next sign-in starts clean.
- `docker-compose.yml` (`demo-api-server`): `MCP_FACADE_PRIVILEGE_LINK: "true"`.

---

## Error handling

| Failure | Result |
|---|---|
| Gateway sign-in fails (error param, state mismatch, token exchange) | BFF → `resume&link=error&reason=…` → broker → client `redirect_uri` with `error=access_denied`; LM Studio shows it |
| No PingOne session | The gateway hop shows the normal login in that tab (no `prompt=none`, so no `login_required` dead end) |
| Resume record expired/unknown/reused | Broker 400 `invalid_grant` (same as today's expired pending) |
| Gateway rejects the new token upstream | Façade clears that app's session and relays the challenge; the MCP SDK re-auths at most once per connect ("401 after successful authentication" ends it) |
| `BFF_PRIVILEGE_LINK_URL` unset (broker) | Callback returns to the client as today |
| `MCP_FACADE_PRIVILEGE_LINK` unset (BFF) | Façade keeps the 503; a half-configured pair cannot loop |
| LMDB write fails | Warn and continue in memory |

## Security

- **Open redirect:** `/facade-link` redirects only to the configured broker origin's `/oauth/resume`; `app` must match the app-segment regex. Anything else is a 400 with no `Location`.
- **Login CSRF:** the gateway code is redeemed with the BFF's own `state` + PKCE verifier held in the requesting browser's session slot. A crafted `/facade-link` URL can only sign the victim into the gateway as themselves.
- **Resume ids:** random, single-use, 10-minute TTL. `link=ok` is unsigned by design: skipping the gateway hop yields today's behaviour (a broker code with no gateway leg → 401 again), not an escalation.
- **Tokens at rest:** the per-app gateway token is written to LMDB in the BFF data volume. The same token is already persisted in the LMDB session store (`CLEAR_SESSIONS_ON_BOOT=false`), it expires within 60 minutes, and expired entries are dropped. Never logged, never on a ledger hop.
- **Identity:** one operator identity per app, as today. Whoever authenticates through the MCP client sets that app's gateway session.

## What does not change

`/privilege-mcp-client`'s own sign-in, `pendingAuth`, selected door and
`/auth/logout`; the broker for every non-Privilege door; the façade's 405 on
GET; every door other than `privilege-gateway`.

---

## Testing

Scoped runs only.

- **Broker** — `cd demo_mcp_gateway && npm run build && npm test -- <files>`; extend `tests/oauth-broker-router-authorize.test.ts` and `tests/oauth-broker-token-store.test.ts`: `resource` stored; Privilege-door callback → 302 to link URL with `app`/`resume`; `/oauth/resume` `link=ok` → code + original `state`; `link=error` → `access_denied`; unknown/reused `rs` → `invalid_grant`; link URL unset → callback unchanged.
- **BFF** — `cd demo_api_server && CI=true ./node_modules/.bin/jest <files> --forceExit`:
  - extend `tests/services/privilegeGatewaySession.test.js` (its existing cases must stay green): per-app isolation; no-arg = default app; survives module reload via LMDB; LMDB write failure still works in memory.
  - new `tests/routes/privilegeMcpClient.facadeLink.test.js`: foreign `resume` origin/path → 400, no redirect; bad `app` → 400; valid → 302 to gateway authorize with its own slot, `pendingAuth` and `config` untouched; callback → `remember({ app })` + `link=ok`; state mismatch / exchange failure → `link=error`.
  - `tests/routes/mcpFacade.privilegeGatewayDoor.test.js`: no session + flag → 401 challenge with `gateway_session_unavailable`; flag off → 503.
  - existing, must stay green: `privilegeMcpClient.gatewaySessionRemember`, `privilegeMcpClient.gatewaySessionState`, `privilegeMcpClient.dcrReregister`, `checks/privilegeMcpFirstCheck`.
- **Revert-to-RED:** revert each fix once; only its own tests go red.

## Live verification

Pin the stack generation before and after (`npm run -s stack:generation`).

1. Restart the BFF; `/api/privilege-mcp/state` shows `gatewaySession.apps.opensearch22` not ready.
2. LM Studio → Authenticate on `MCP Privilege-OpenSearch22` → the tab passes through → tools list; gateway log shows `has policy based capabilities` for `opensearch22`. No visit to `/privilege-mcp-client`.
3. Recreate `ai-demo-api-server` → still ready, tools list without a sign-in.
4. Repeat for `MCP Privilege-OpenSearch-Blocked` (`opensearch`) → its own entry in `apps`.
5. Regression: `/privilege-mcp-client` Privilege-mode sign-in still works; Façade mode still shows its banner when not ready.

## Rollout

- Worktree branch `worktree-lmstudio-privilege-link`, one PR (both services).
- `REGRESSION_PLAN.md` entry (protected auth area): files changed, what was broken, verify line.
- `lmstudio/README.md`: drop "sign in once at /privilege-mcp-client" for the Privilege entries; correct the stale `cm-mcpgw-opensearch-mcp-server` port-forward to `opensearch-mcp-server`.
- `TECH_DEBT.md`: SE not wired (both switches unset there).
- After merge: `scripts/sync-main-checkout.sh`, then `scripts/deploy-live.sh` (rebuilds `mcp-gateway` for `demo_mcp_gateway/*`, restarts the BFF); confirm both env vars inside the containers.
