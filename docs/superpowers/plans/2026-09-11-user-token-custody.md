# Plan: the user token never leaves the BFF

**Status:** plan only, not implemented (2026-09-11).

## Context

The written rule already exists: ADR 0006 (`docs/adr/0006-bff-only-token-custody.md`) says the browser never gets a raw token, and `docs/ARCHITECTURE.md:43` says the same. The code breaks it in several places, and no test checks it.

The rule for this change: the raw session user token (access, id or refresh) goes only to **PingOne** (exchange, introspection, userinfo, refresh, revoke, signoff) or to loopback within the BFF. It never goes to the browser or to any other service. Tokens exchanged from it on the server side are never returned raw to the browser either.

Decisions already made:

- Teaching features: rework them so the lesson survives without the live token. No exceptions to the rule.
- `_auth` cookie: drop the id_token.
- "Decode my token" chip: send the exchanged MCP token instead.
- `test-introspect`: introspect at PingOne.

## Leaks to close (all confirmed by reading the code)

### To the browser

1. **`/api/delegation`, `/history`, `/granted-to-me`, `/admin/all`** return the stored raw user `access_token`. `/admin/all` returns every user's token, and `/granted-to-me` returns the delegator's token to the delegate.
   - Fix: in `services/delegationService.js:51` `toRecord`, destructure out `access_token` (`const { access_token, ...rest } = row`).
   - Revocation is unaffected. Only the admin hard revoke (`routes/delegation.js:172-185`) reads the stored token, and it reads the raw LMDB row through `delegationStore.getDelegationById`, not through `toRecord`. `routes/agentAuthorization.js:138-143` revokes the current session's access token, not a stored one (it finds the delegation with `findActiveByActorAndGrantor`).
2. **`GET /api/api-calls/tokens`** returns the admin login access token stored by `trackToken`. No UI calls it.
   - Fix: delete the `trackToken(...)` call at `routes/oauth.js:374-379`, and its now-unused import at `oauth.js:22`.
   - Leave the endpoint in place. It keeps returning `[]`, and its session-isolation test still passes.
3. **`_auth` cookie carries the raw id_token** (`services/authStateCookie.js:109`, field `it`).
   - Fix in `authStateCookie.js`: remove `it` from the payload (`:109`), the `idToken: obj.it` read (`:147`), and the `idToken` restore (`:212`).
   - Fix the callers: drop `idToken` from the `setAuthCookie` arguments at `routes/oauth.js:427` and `routes/oauthUser.js:806`.
   - Fix `server.js:826-829`: remove the `readAuthCookie(req)?.idToken` fallback. A logout after the session is already lost then reaches PingOne signoff without `id_token_hint`. `server.js:916` already warns that the PingOne SSO session may then stay active, so the next sign-in could go through without asking for credentials. That is the known cost of this decision. Verification step 5 measures it, and if SSO does survive, record it in TECH_DEBT as accepted degraded logout.
   - Cookies already issued still carry `it` until they expire, but nothing reads it any more.
4. **Resource Server Tester "Show Token"** returns the raw JWT.
   - Fix: in `services/resourceServerTesterService.js:404` `reveal()`, remove the `token` field and keep `source`, `label`, `header` and `claims`. Update its doc comment and the "Deliberately NOT scrubbed" comment in `routes/resourceServerTester.js:31-40`.
   - UI: remove the "Raw JWT" block in `demo_api_ui/src/components/ResourceServerTester.jsx:216-217`. The decoded header and claims are already shown.
5. **`POST /api/a2a/message`** returns `delegationResult.token`, a two-hop exchanged token that the UI never reads.
   - Fix: remove the `token:` line at `routes/a2aAgentRoutes.js:130`. `claims` stays.
6. **Token-chain SSE** (`routes/tokenChain.js:118-126`) passes `metadata`, `subjectToken` and `resultToken` through unscrubbed. No raw tokens are emitted today, but this is the one channel where a future emitter would leak to every subscriber.
   - Fix: `res.write(\`data: ${JSON.stringify(scrubRawJwts(payload))}\n\n\`)`. `scrubRawJwts` is already imported and used at `:37` and `:147`.

### To other services

7. **"Decode my token" chip (`jwt_decode_full`)**: `server.js:2316-2318` puts the raw session token (`getSessionBearerForMcp`) into the tool arguments, which then go to the gateway and the MCP JWT verifier.
   - Fix: delete that injection so `params: params`.
   - In `services/mcpToolPipeline.js`, right after `mcpAccessToken = resolved.token;` (`:283`), add: `if (tool === 'jwt_decode_full' && !params.token && mcpAccessToken) params.token = mcpAccessToken;` (`params` is the mutable object from `:232`).
   - Update the stale comment at `:243-246`. The display redaction there stays as it is.
   - The chip then shows the exchanged token (aud = MCP, `act` claim).
8. **Replayed-token attack sim** (`services/attackSimulatorService.js:1329` `_runReplayedToken`) presents the live session token to the gateway.
   - Fix: first exchange `subjectToken` to `_wrongAud()` (`:127`) with `oauthService.performTokenExchange`, the same way `_runWrongAud` does at `:866`. Then present that token to the gateway.
   - If `_wrongAud()` is not set or equals the gateway audience, return the same 503 `wrong_aud_not_configured` that `_runWrongAud` returns.
   - Change the event and narrative text to "replay a token minted for another audience". It still expects `invalid_aud` / 401.
9. **exchange-1token-401 flow** (`routes/pingoneTestRoutes.js:2342`): step 1 calls `probeMcp(userAccessToken)`.
   - Fix: exchange `userAccessToken` to a wrong audience first and probe with that token. For the wrong audience, use the same config keys `_wrongAud()` reads, and it must differ from `mcpResourceUri`. If none is set, mark step 1 skipped with a clear reason.
   - Change the step 1 label to "Probe MCP with a token for the wrong audience". Steps 2-4 stay as they are.
10. **`GET /api/authorize/test-introspect`** (`routes/authorize.js:1044-1076`) sends the user token, plus `PINGONE_USER_CLIENT_SECRET`, to the mock authz server at `:9001`.
    - Fix: replace the axios call with `introspectToken(token)` from `middleware/tokenIntrospection.js:20` (PingOne RFC 7662), and return `engine: 'pingone'`.
    - Check that the consumer `demo_api_ui/src/components/AuthorizeRulesPanel.jsx:239` still renders the new response shape.

## Guard

A new file, `demo_api_server/tests/userTokenCustody.regression.test.js`, with one small case per fix. Each case fails if its fix is reverted:

1. `toRecord` output has no `access_token`.
2. The OAuth callback no longer calls `trackToken` (mock `apiCallTrackerService` and assert it is not called).
3. `setAuthCookie` → `readAuthCookie` round-trip: the cookie contains no JWT-shaped string (`/eyJ[\w-]+\.[\w-]+\.[\w-]*/`) and no `it`.
4. `reveal()` result has no `token`.
5. In the `POST /api/a2a/message` response, `delegationResult` has no `token` (mock the orchestrator to return one).
6. When a `token_exchange` app event carries a JWT in `metadata`, the token-chain SSE output contains no JWT-shaped string.
7. The `jwt_decode_full` pipeline sends the exchanged token as `params.token`, never the session token (mock `resolveMcpAccessTokenWithEvents` and `callToolViaGateway`).
8. The replayed-token sim never passes the raw `subjectToken` to `callToolViaGateway`.
9. In the exchange-1token-401 flow, step 1's `probeMcp` never receives the session access token; its bearer is the wrong-audience token from a mocked `performTokenExchange`.
10. `test-introspect` calls `introspectToken` with the session token, makes no request to `:9001`, and returns `{ ok: true, engine: 'pingone', ... }` in the shape `AuthorizeRulesPanel.jsx:239` reads.

Existing tests to update where they assert the old behavior:

- `src/__tests__/authStateCookie.test.js` (idToken round-trip)
- `src/__tests__/resourceServerTester.test.js` (`reveal` token)
- `src/__tests__/attackSimulator.test.js` and `tests/attackSimDenyLabel.regression.test.js` (replayed-token)
- `src/__tests__/a2aOrchestratorService.test.js` and `tests/a2aVerticalParity.test.js` (if they read `delegationResult.token`)
- `src/__tests__/oauth-login-resilience.test.js` (trackToken or cookie args)

## Docs (same PR)

- `REGRESSION_PLAN.md` §1: add a "User token custody" row. It states the invariant, points to ADR 0006, and names the guard test.
- `REGRESSION_PLAN.md` §4: add a reverse-chronological entry (files, what was broken, what was fixed, do not break, verify).
- `TECH_DEBT.md`: one entry for what this plan leaves out on purpose (below).

## Out of scope (recorded, not fixed)

- `services/idJagService.js:85-95`: native ID-JAG mode posts the id_token to `enterprise_idp_base_url`. That URL defaults to the BFF itself, and the post happens only for the old flat session shape. The design needs an id_token here, so this goes in TECH_DEBT.
- `POST /api/pingone-test/token-exchange` (`pingoneTestRoutes.js:1154`) returns an exchanged token. Its subject token comes from the request body, not the session, and no UI calls it.
- `TokenExchangePanel.js:253` reads `accessToken` from `/status`. That branch never runs (`/status` doesn't return a token), so it doesn't leak. Fixing it to use `/api/auth/oauth/token-claims` is a separate UI fix.
- The raw token stored in the LMDB delegation store and in the session store stays inside the BFF, which is allowed.

## Do-not-break (regression-guard)

- The login callbacks still set `req.session.oauthTokens`, including idToken, the same way. The session-based logout `id_token_hint` path is unchanged.
- Delegation revocation (normal and admin hard revoke) still revokes the stored token at PingOne.
- `/api/auth/oauth/status` keeps leaving out `accessToken` (`oauthStatus.*.test.js`).
- Every other MCP tool call is unchanged. Only `jwt_decode_full`'s argument changes.
- The attack sims and the 401 flow still report 401 / `invalid_aud`.
- Emoji allowlist: no new glyphs.

## Execution

In a worktree (`EnterWorktree`), on branch `fix/user-token-custody`, with files staged explicitly. One PR.

## Verification

1. Scoped server run:
   `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/userTokenCustody.regression.test.js src/__tests__/authStateCookie.test.js src/__tests__/resourceServerTester.test.js src/__tests__/attackSimulator.test.js tests/attackSimDenyLabel.regression.test.js src/__tests__/a2aOrchestratorService.test.js tests/a2aVerticalParity.test.js src/__tests__/oauth-login-resilience.test.js tests/apiCallTrackerTokenIsolation.regression.test.js src/__tests__/oauthStatus.regression.test.js --forceExit`
2. Full server suite: this change touches auth, session and cookie middleware, which CLAUDE.md lists as a trigger. Run `CI=true npm test -- --forceExit`.
3. UI: `cd demo_api_ui && npm run test:unit && npm run build` (ResourceServerTester.jsx changed).
4. Prove the guard works: revert the `toRecord` change locally and confirm the new test goes red, then restore it.
5. After merge and deploy, with the stack generation pinned before and after, on `local.ping-devops.com:4000` with the Super Sports vertical:
   - Sign in, open DevTools, and check that no response body for `/api/delegation*`, `/api/a2a/message`, `/api/resource-server/test/reveal` or the SSE `/api/token-chain/events` matches `eyJ`.
   - Check that the `_auth` cookie value decodes with no `it` field.
   - Run the "Decode my token" chip: it shows `aud` = the MCP audience and an `act` claim.
   - Run the replayed-token sim: it reports 401 `invalid_aud`.
   - Normal logout: the PingOne signoff redirect still works, and the next sign-in asks for credentials.
   - Cookie-only logout: delete the server session from the session store but keep the `_auth` cookie, then log out. Check whether the next sign-in asks for credentials. If it signs in silently, the upstream SSO session survived. Record that in TECH_DEBT as the accepted cost of dropping the cookie id_token, and tell the user.
