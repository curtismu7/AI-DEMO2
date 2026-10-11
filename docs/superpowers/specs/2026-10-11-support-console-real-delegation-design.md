# Support console — real RFC 8693 delegation for operator writes

**Date:** 2026-10-11
**Status:** approved in conversation; ready for implementation planning
**Actor decision:** (a) — the admin BFF client is the exchange actor
**Subject mechanism:** (B) — headless PingOne pi.flow sign-on for the customer
**Explicitly not used:** mayAct (removed from the platform — act is minted from the actor token's `client_id`; see `actAttributeValue()` in pingoneProvisionService.js), CIBA, dedicated support-operator client

## Problem

The `/admin/<vertical>` support consoles narrate delegation but demonstrate none of
it. Operator writes run as plain session-cookie BFF calls: the scope table is
advisory, the "verification" is a session flag, and the token chain showed nothing
until PR #1129 (which made the chain *honest* — session → verification → write →
audit — but those hops are still just session state, no tokens, no exchange).

The demo's central claim is acting **on behalf of** a customer under a verifiable
delegated token. This spec makes the support console prove it the same way the
agent pages do: a real customer sign-on, a real RFC 8693 exchange, a real `act`
claim, and a write executed under the delegated token.

## Design

### Flow

```text
Operator (signed-in admin) ──lookup──▶ customer found
   │
   ├─ 1. Verify customer (IdentityGate)
   │     POST /api/admin/<v>/verify/initiate { customerId }
   │       BFF resolves the customer's PingOne account (username → id,
   │       pingOneUserLookupService — same resolution mfaUserId uses)
   │       BFF opens a REAL PingOne pi.flow authorize for the USER client:
   │         login_hint=<customer username>, prompt=login, PKCE + nonce,
   │         redirect_uri = the registered user callback (consumed
   │         server-side via as/resume — no browser redirect)
   │       Headless server-side: piFlowDriver drives
   │         SIGN_ON → user.lookup → usernamePassword.check
   │         (password sourced from config — DEMO_PASSWORD — never typed
   │          into the UI; see "Password sourcing" below)
   │       ──▶ flow reaches OTP_REQUIRED (real SMS/e-mail OTP to the
   │            customer's real device)
   │       Response: { step: 'otp', maskedContact } — no tokens yet
   │
   │     POST /api/admin/<v>/verify/otp { otp }
   │       ceremony driver: otp.check → COMPLETED → as/resume → ?code
   │       BFF redeems the code with the USER client at the SAME registered
   │       redirect_uri the sign-in modal uses (/api/auth/oauth/user/callback
   │       — the flow is consumed server-side; nothing redirects the
   │       operator's browser)
   │       ──▶ REAL customer access token + id token
   │       Stored in req.session.support:
   │         { subjectToken, idToken, subjectClaims, customerUsername,
   │           pingOneUserId, expiresAt, verifiedUntil }
   │       Response: { verified: true, expiresAt, tokenEvent }
   │
   ├─ 2. Operator write (Approve / Deny / Complete / Resolve …)
   │     POST /api/admin/<v>/<resource>/:id/<action> { userId }
   │     requireCustomerVerified now demands a LIVE session customer token
   │       (still TTL-bounded, 15 min, keyed per customer — unchanged shape)
   │     On pass, BEFORE the mutator:
   │       actor_token = fresh client-credentials token for the ADMIN client
   │         (minted at exchange time, short TTL, never persisted)
   │       performTokenExchangeWithActor(customerToken, adminCCToken,
   │           audience=<resource audience>, scope=<write scope>)
   │       ──▶ REAL delegated token: sub = customer, act.sub = admin client,
   │            scope narrowed to the write scope, short lifetime (5 min)
   │     The mutator runs; the delegated token's claims are recorded on the
   │     audit entry (act.sub, jti) and on the response tokenChain.
   │
   └─ 3. Token chain (operatorTokenChain.js extended)
         operator-session        admin session (claims from session user)
         customer-signon         pi.flow step evidence: credentials step done,
                                 OTP step done (masked contact, no secrets)
         customer-token-issued   real token claims (sub, scope, acr/amr if
                                 present) — claims only, never the token value
         exchange                real RFC 8693: request shape (grant_type,
                                 audience, scope, hasActor) + response claims
                                 (sub, act.sub, scope, aud, jti/exp)
         operator-write          before/after status — done UNDER the
                                 delegated token
         operator-audit          operator + act.sub + jti
```

### Password sourcing

The customer's pi.flow password step is fulfilled by the BFF from config —
configStore key `demo_password` (env alias `DEMO_PASSWORD`, default
`Baseball123!`, the same value provisioning seeds — see configStore.js key map
and pingoneProvisionService.js's `DEMO_PASSWORD`). The operator never types a
customer password; the OTP step is the human moment. Rationale: the demo's
story is strong live identity proof of the customer witnessed by the operator —
the OTP delivers that; password entry would add nothing but friction and a bad
habit demonstration.

### Session shape (`req.session.support`)

```json
{
  customerUsername, pingOneUserId,
  subjectToken,            // real customer access token (server-side only)
  subjectClaims,           // decoded, sanitized
  idToken,
  expiresAt,               // token expiry
  verifiedUntil,           // 15-min TTL (existing SUPPORT_VERIFY_TTL_MS)
  pendingFlow?,            // { flowId, cookies, status } between initiate and otp
}
```

- Never sent to the browser. Browser sees `{ step, maskedContact }`, `{ verified, expiresAt }`, and token-chain events (claims only).
- Cleared when the lookup resolves a different customer (existing `verifiedCustomerRef` behavior on the SPA, mirrored server-side by keying on customer id).
- `pendingFlow` carries the in-flight pi.flow state between the two POSTs: `{ flowId, cookies, status, startedAt }` — the same fields piFlowDriver persists, but under the support ceremony's own session key (`req.session.support.pendingFlow`), never `oauthPiFlow` (that belongs to the operator's own sign-in flows).

### Enforcement change

`requireCustomerVerified` (middleware/requireCustomerVerified.js):

- Pass: `req.session.support` exists, matches the targeted customer, and `verifiedUntil > now`. (Same TTL rule as today; the difference is what's *behind* the flag — a real token ceremony.)
- Fail: same 403 `customer_not_verified`, same denial chain (session → not verified → audit). Unchanged client handling.

### Token lifetime & audience

- Delegated token: `token_lifetime: 300` (5 min), audience = the resource server audience the write scope lives on, scope = the single write scope for the action (from the same table `supportConsoleConfig.permissions` already declares — now the source of truth on the server side too, mapped in one place in `adminVerticals.js`).
- Actor CC token: minted per exchange via the existing admin-client token machinery (same client/token-endpoint auth the BFF already uses), default lifetime, discarded after the call.

### Server modules touched

| File | Change |
| --- | --- |
| `services/supportDelegationService.js` (new) | Owns the ceremony. Drives pi.flow **directly** — `fetch` against the authorize URL with `redirect: 'manual'` and the `usernamePassword.check` / `otp.check` / `as/resume` step posts, mirroring piFlowDriver's shapes rather than reusing its handlers (those are Express-coupled: they write `req.session.oauthPiFlow` and answer via `res`, and `completePiFlow` reads the user flow's `oauthState`/`oauthRedirectUri` — the wrong session state for a customer ceremony). The step POST shapes and cookie handling follow `piFlowDriver.js` as the reference implementation; `makePiFlowHandlers`' internals stay untouched. Redeems the code via `oauthUserService.exchangeCodeForToken`, exchanges via `oauthService.performTokenExchangeWithActor`, emits chain events. |
| `routes/adminVerticals.js` | `verify/initiate` → ceremony step 1; new `verify/otp`; `writeAction` → exchange before mutator; scope mapping table (vertical+action → scope). |
| `middleware/requireCustomerVerified.js` | Check live session customer token instead of only the TTL flag. |
| `services/operatorTokenChain.js` | Three new event builders: `customer-signon`, `customer-token-issued`, `exchange`. |

### Client modules touched

| File | Change |
| --- | --- |
| `supportConsole/IdentityGate.jsx` | Two-phase: "Send one-time code" → `verify/initiate` → OTP input (masked contact shown) → `verify/otp`. Copy updated: verifies the *customer* by having them complete a real sign-on. |
| `supportConsole/SupportConsole.jsx` | No flow change — `onVerified` already carries `expiresAt`; the write path now receives the extended `tokenChain`. |
| `operatorChainSteps.js` | Render the three new hop types (lanes: PINGONE for sign-on/token, BFF for exchange). |
| `TokenChainTraceRail` surfaces | No changes — the projection comes through the same store. |

### What "real" means here (acceptance)

1. The customer token in `req.session.support` is a genuine PingOne-issued JWT (decodable, `iss` = PingOne, `sub` = the customer's PingOne id).
2. The delegated token is a genuine PingOne-issued JWT with `act.sub` = admin client id, `sub` = customer id — produced by a real RFC 8693 call to the token endpoint.
3. The chain's `exchange` step displays the real request shape and the real response claims.
4. The audit entry records `act.sub` and the delegated token's `jti`.
5. A write without the ceremony fails 403 exactly as today.
6. No simulation flags, no stubbed hops in the live path (unit-test stubs mock at service seams only).

### Error handling

| Failure | Behavior |
| --- | --- |
| Customer has no PingOne account | `verify/initiate` → 409 `customer_not_linked` (clear message, no flow opened) |
| Customer has no MFA device / flow can't reach OTP | surface the flow's own error; 502 with `pi_flow_failed` + the flow status |
| Wrong OTP | 401 `invalid_otp` (piFlowDriver already maps this); flow stays open for retry |
| Flow expires between initiate and otp | 410 `flow_expired` → operator re-initiates |
| Token exchange fails | 502 `exchange_failed` (write does NOT proceed); chain records the failure event |
| Customer token expired mid-session | treated as unverified → next write 403s → operator re-verifies |

### Testing

- **Server unit (TDD seams):** stub `piFlowDriver` internals + `oauthUserService.exchangeCodeForToken` + `oauthService.performTokenExchangeWithActor` at module boundaries. Tests: initiate returns otp step; otp completes and stores session token; write without ceremony 403s; write performs exchange with expected subject/actor/audience/scope; chain carries real claim shapes; exchange failure aborts the write.
- **UI:** IdentityGate two-phase; chain renders the new hops.
- **Live (manual acceptance):** workforce console → verify as `demoUser` → real OTP → complete → write → inspect chain for the real `act` claim.

### Out of scope

- No PingOne tenant changes: no new apps, no schema attributes, no policy edits.
- No authz-policy (Rule 2.6-style) enforcement keyed to the support actor — the exchange + act claim is the demo; policy can key on `act.sub = admin client` later.
- No mayAct, no CIBA, no dedicated support-operator client.
- No changes to the agent demo paths or the write UI beyond IdentityGate.
