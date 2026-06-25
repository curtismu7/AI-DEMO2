# Session Replan — PingOne SSO session ↔ browser session (SPA / BFF)

> Status: PLAN (no code yet). Scope: how the **browser session** and the **PingOne SSO
> session** are managed and kept in sync for the SPA. Owner decisions are baked in below.
>
> Out of scope (separate concerns, deliberately excluded): the server-side
> `CLEAR_SESSIONS_ON_BOOT` LMDB wipe-on-deploy behaviour, and back-channel logout /
> cross-tab logout sync.

## TL;DR

The architecture is already correct — this app uses the **Backend-For-Frontend (BFF)**
pattern, which is the current IETF-recommended model for SPAs (tokens stay server-side,
the browser holds only an httpOnly cookie). This is **not a rewrite**; it closes the gaps
in how the two sessions reconcile.

The fix is four things:
1. Add **seamless silent re-auth** (top-level `prompt=none`) so a lost browser session is
   re-established invisibly from a live PingOne SSO session — replacing the broken
   `_cookie_session` stub state.
2. Set a **deliberate, best-practice lifetime policy** (short access token, longer rotating
   refresh token, decoupled short SSO session).
3. Make **logout** reliably end the PingOne SSO session (RP-initiated `/as/signoff`).
4. **Lock** it with tests + skill updates.

## Owner decisions (locked)

| Decision | Value |
|---|---|
| Recovery UX when browser session lost but SSO maybe alive | **Seamless silent re-auth** (top-level `prompt=none`, one-shot) |
| Logout scope | **RP-initiated only** (revoke + destroy + `/as/signoff`) |
| `_auth` cookie role | **Demoted to a hint** (drives recovery; never satisfies `/status`) |
| Access token (AT) | **15 min** |
| Refresh token (RT) | **8 h absolute**, rotated on every use |
| PingOne SSO session | **1 h** (deliberately shorter than RT) |
| BFF cookie maxAge + LMDB TTL | **8 h** (tracks the RT, NOT the SSO) |

## Best-practice basis

- **BFF is the recommended SPA model.** IETF *OAuth 2.0 for Browser-Based Apps* names the
  BFF as the most secure architecture; tokens never reach the browser.
- **The classic hidden-iframe `prompt=none` silent renew is dead** for SPAs — Safari ITP
  and Chrome third-party-cookie removal break it. The BFF answer is server-side refresh +
  **top-level** `prompt=none` redirects (never iframes).
- **RFC 9700 — OAuth 2.0 Security Best Current Practice (Jan 2025):** mandatory PKCE,
  **refresh-token rotation with reuse detection** as standard, short access tokens.
- **Access-token lifetime:** sensitive/financial APIs 5–15 min → **15 min** is the correct
  ceiling for this demo.
- **Refresh-token rotation:** new RT issued on every use; a replayed old RT revokes the
  token family. PingOne supports this via `additionalRefreshTokenReplayProtectionEnabled`.
- **Absolute expiration anchored to initial issuance:** the 8 h RT cap is wall-clock from
  initial login and is **never** slid forward on rotation; force full re-auth at the cap.
- **Rotation concurrency:** a short grace window / in-flight lock prevents benign races
  (two simultaneous refreshes) from tripping reuse detection.

Sources:
- RFC 9700 OAuth 2.0 Security BCP (Jan 2025)
- IETF draft-ietf-oauth-browser-based-apps (BFF recommendation)
- IETF draft-ietf-oauth-refresh-token-expiration (absolute expiration)
- Auth0 / Duende refresh-token rotation + reuse docs
- Curity "Token Handler" pattern (closest BFF-for-SPA reference; `curityio/spa-using-token-handler`)
- Duende.BFF (canonical BFF security framework)
- PingOne docs: access-token lifetime, manage user sessions, grant types

## Why SSO (1 h) and RT (8 h) can safely differ

They govern different things:

- The **refresh grant is a back-channel token call** (`grant_type=refresh_token`) — it does
  **not** use the PingOne SSO browser session. So between hour 1 and hour 8 the SSO session
  is dead but the refresh middleware keeps minting 15-min ATs from the still-valid RT. The
  user stays logged in for the full 8 h.
- The **SSO session** governs interactive `/authorize` — i.e. initial login and `prompt=none`
  silent re-auth.

This is what `offline_access` exists for: an **offline (session-independent) refresh token**
that outlives the interactive session. (Already requested — see `config/scopes.js`.)

### The cookie tracks the RT, not the SSO

The BFF cookie *holds* the RT, so its maxAge must track the RT (8 h). Matching the cookie to
the 1 h SSO would discard the 8 h RT and force a login at 1 h — defeating the point.

### The one consequence to accept

`prompt=none` silent re-auth only works while the SSO session is alive (first hour):

| Window | Browser session | Result |
|---|---|---|
| Hour 0–1, session lost | gone | silent re-auth works → invisible recovery |
| Hour 1–8, session intact | alive | refresh keeps it alive; silent re-auth not needed |
| Hour 1–8, session lost | gone | SSO dead → **explicit login** (the 8 h RT was in the lost session) |
| After 8 h | — | RT expired → full login |

The only painful cell (hour 1–8, session lost) is driven by the BFF session being destroyed
mid-session — which is the separate `CLEAR_SESSIONS_ON_BOOT`-on-deploy topic.

## Lifetime policy (final)

| Clock | Value | Governs | Notes |
|---|---|---|---|
| Access token | **15 min** | API calls | Refresh fires ~5 min before expiry → renews ~every 10 min of activity |
| Refresh token | **8 h absolute** | Durable app session | Rotated on every use; cap anchored to initial login, never slid |
| PingOne SSO session | **1 h max** | Interactive `/authorize` + silent re-auth window | Deliberately shorter; shrinks cross-app SSO + walk-up risk |
| BFF cookie + LMDB TTL | **8 h** | Holds the RT | Tracks the RT (NOT the SSO) |

## The state machine (the core change)

Today `/status` returns a binary `authenticated: true|false`, and `false` means "bounce to
full login." Add a **third state** — "logged out *here*, but maybe recoverable from a live
PingOne SSO session":

| Session reality | `/status` returns | SPA action |
|---|---|---|
| Real tokens, not expired | `authenticated: true` | render |
| Real tokens, near expiry | (refresh middleware renews first) → `true` | render |
| No BFF session **but** signed hint cookie present, silent not yet tried | `authenticated: false, canSilentReauth: true` | one-shot top-level `prompt=none` |
| No hint cookie, or silent already tried | `authenticated: false` | explicit login |

The `_auth` cookie stops being a *fake session* (`accessToken='_cookie_session'`) and becomes
a **hint** — "this browser was authenticated as `oauthType=user`, return to `/dashboard`."
It feeds recovery; it never satisfies `/status` itself.

**Refresh is the inner loop** (BFF session alive, AT aging). **Silent re-auth is the outer
loop** (BFF session gone, SSO alive). Neither touches the other.

---

## Phase 0 — Confirm (no code)

Record the real numbers and verify the load-bearing assumptions before changing anything.

- [ ] PingOne: read & record the User app's **access-token lifetime**, **refresh-token
      duration**, and whether RT duration is **absolute-anchored or sliding** (we want
      absolute 8 h — may need the rolling-grant / max setting).
- [ ] PingOne: read & record the environment **SSO session timeout** (idle + max).
- [ ] PingOne: confirm `additionalRefreshTokenReplayProtectionEnabled` state.
- [ ] **CRITICAL — offline RT survives SSO expiry:** empirically confirm that after the SSO
      session lapses (or is ended), a `grant_type=refresh_token` call still succeeds. If
      PingOne binds the RT to the session, the 1 h SSO would kill the 8 h RT and the split
      is invalid — escalate before proceeding.
- [ ] Confirm the User app actually grants `offline_access` + `refresh_token`.
- [ ] Check current **CSRF posture** on state-changing BFF routes (matters once prod is
      `sameSite=none`).
- [ ] Reproduce one "bounced to login" event; capture which seam fired from logs
      (`[session-store]`, `Session saved OK`, `[auth-cookie] Session restored`,
      `invalid_grant`).

**Done =** the four lifetime numbers, the offline-RT verdict, CSRF posture, and the failing
seam are written down.

### Phase 0 results (2026-06-15)

Live environment: `Banking PingOne Core for AI - Amtrust - Dev`
(`d02d2305-f445-406d-82ee-7cdbf6eeabfd`, region NA). User app `Demo User App`
(`b7d00976-405f-4c55-914a-a3ebe8f369d8`).

**Confirmed via PingOne Management API (MCP):**
- User app grants: `AUTHORIZATION_CODE` + `REFRESH_TOKEN`. ✓
- `pkceEnforcement: S256_REQUIRED`. ✓
- `additionalRefreshTokenReplayProtectionEnabled: true` — rotation/replay protection is ON.
  (This is exactly why the middleware's aggressive 10-min blacklist must become a grace +
  bounded retry — Phase 2 / G4.)
- `tokenEndpointAuthMethod: CLIENT_SECRET_POST`.
- `idpSignoff: false` — **relevant to Phase 3**; logout currently does not force IdP signoff
  via the app flag (we drive `/as/signoff` explicitly instead).
- App requests `offline_access` (`config/scopes.js`). ✓

**CSRF posture:** No CSRF-token or origin-check middleware found. Mutating BFF routes rely on
the session cookie + `SameSite` + the OAuth `state` param (CSRF for the auth flow only). Once
prod is `sameSite=none`, this is a real gap — address in Phase 3.

**Read via PingOne Management API (worker token, `/applications` + `/resources`):**
- **Access-token TTL = 3600 s (1 h)** on every resource, including the user-facing
  `Demo API` (`enduser.ping.demo`) and `Super Banking API` (`banking_api_enduser`).
  → **Delta: 3600 → 900 (15 min)**, set per-resource (`accessTokenValiditySeconds`).
- **Refresh-token settings on Demo User App are all `null`** (`refreshTokenDuration`,
  `refreshTokenRollingDuration`, `refreshTokenRollingGracePeriodDuration`) → the app is on
  **PingOne defaults: ~30 d duration / ~180 d rolling**. The live RT is effectively 30 days,
  not 24 h. → **Delta: set `refreshTokenRollingDuration` = 28 800 (8 h absolute cap) +
  `refreshTokenDuration` = 28 800**. (The `86400`/24 h in `pingOneClientService.js:169` is
  the CIMD dynamic-registration path, not this app.)
- Sign-on policies in env: `Single_Factor` (default), `Multi_Factor`.

**Still open — Environment SSO session timeout (needs console/your confirmation):**
- Not exposed by the Management API endpoints probed (`/sessionSettings` is not a route here;
  `/signOnPolicies` carries no timeout field). PingOne **Core** may not expose an arbitrary
  SSO idle/max timeout the way PingFederate / AIC do.
- **Important:** the plan does **not** depend on SSO = 1 h being achievable. The 8 h durable
  session (via RT) works regardless; the SSO timeout only bounds how long `prompt=none`
  silent re-auth can rescue a *lost* session. If PingOne Core fixes the SSO session at a
  platform default, that simply sets the silent-recovery window — everything else stands.
  Confirm the actual SSO session behaviour in the console; treat 1 h as a target, not a
  hard dependency.

**Offline-RT investigation — EXECUTED 2026-06-15. Two real findings + one method correction.**

Harness: `demo_api_server/scripts/offlineRtCheck.js` (+ `_getUserRt.js`, a self-driven
auth-code flow to mint a fresh end-user RT). Drove a real `demoUser` login, ran the test.

**Finding 1 (real gap, FIXED live):** the Demo User App did **not** grant `offline_access`.
Its only grant was the `Demo API` resource (`enduser.ping.demo`) banking scopes; there was
**no `openid`-resource grant**, and the minted token came back `scope="openid"` only. Without
`offline_access` PingOne never issues a session-independent RT at all.
→ **Action taken (live config change):** created an `openid`-resource application grant with
`offline_access` + `openid` (grant id `d1f98a48-1fe7-474e-8d2c-aaa1a51f743c`). Re-mint now
returns `scope="openid offline_access"`. This is a genuine improvement and should stay.

**Method correction (important — supersedes an earlier overstated "session-bound" verdict):**
the harness terminates the SSO session by **DELETING it via the Management API**. That is a
**forced sign-off = full token revocation** (the Phase 3 RP-initiated-logout behaviour), which
is **NOT** the same as a natural idle/max SSO timeout. PingOne's own docs state the **Refresh
Token Rolling Duration is measured "after the most recent user authentication event"** — i.e.
the RT's life is anchored to the *login event*, not to the live session. So:
- Forced delete revoking the RT (observed, both before and after granting `offline_access`) is
  **expected and correct for logout**, and good news for Phase 3.
- It does **NOT** prove the RT dies on a natural 1 h timeout. The doc's wording implies the
  opposite (RT survives a timeout), but PingOne docs do not state it explicitly.

**Net (RESOLVED):** the 1 h SSO / 8 h RT split is **VALID.** `offline_access` was the real
missing piece and is now granted. Timeout-survival **confirmed by owner (2026-06-15): a PingOne
`offline_access` RT survives a natural SSO idle/max timeout** (RT anchored to the auth event);
only a forced sign-off/logout revokes it. So: natural 1 h SSO timeout → RT still refreshes →
app session lives to 8 h; deliberate logout → RT revoked (Phase 3, correct).

Still TODO: reproduce one "bounced to login" event and capture the firing seam from logs.

**Phase 0 verdict:** posture is correct and supports the plan (refresh grant on, replay
protection on, PKCE S256, offline_access requested). The three exact lifetime numbers and the
offline-RT verification remain open and gate Phase 2 — they require console read access or a
short runtime test, not the available MCP tools.

## Phase 1 — Seamless silent re-auth

Files: `routes/oauthUser.js`, `routes/oauth.js`, `services/authStateCookie.js`,
`services/pkceStateCookie.js`, SPA `hooks/useAuth.js`, `components/UserDashboard.js`.

- [ ] **Add the third `/status` state:** when there are no real tokens but the signed hint
      cookie is present, return `{ authenticated:false, canSilentReauth:true }`.
- [ ] **Demote `_auth` to a hint:** stop fabricating `accessToken='_cookie_session'` in
      `restoreSessionFromCookie` (`services/authStateCookie.js`). The cookie carries only
      `oauthType` + `return_to` (+ last `sub`) to drive recovery; it never satisfies `/status`.
- [ ] **New BFF route** `GET /api/auth/oauth/user/silent?return_to=<path>`:
      build the authorize URL with `prompt=none`, dual-write PKCE/state to session **and**
      the signed cookie, set a short-lived (~30 s) `silent_attempt` cookie, redirect to PingOne.
- [ ] **Callback success path unchanged** (normal code → session mint, no UI).
- [ ] **Callback error branch (anti-loop, non-negotiable):** if `silent_attempt` cookie is
      present and PingOne returns `login_required` / `interaction_required` / `consent_required`,
      redirect the SPA with `?oauth=needs_login`, **clear** `silent_attempt` + the hint cookie,
      and **never** re-issue `prompt=none`. One-shot guard, same discipline as the existing
      `REAUTH_KEY`.
- [ ] **SPA:** on `canSilentReauth`, one-shot top-level navigate to the silent route. Keep the
      existing `REAUTH_KEY` rule (never clear on the `oauth=success` URL param). The hint
      cookie's `oauthType` selects admin-vs-user client.
- [ ] Note: the **signed PKCE cookie fallback is now load-bearing** — during recovery the BFF
      session is often absent, so the callback must read state from the cookie. (Already
      dual-written.)

**Done =** killing the BFF session (or a deploy wipe) while the SSO session is alive restores
the user with no visible login; a dead SSO session yields exactly one clean fall-through to
explicit login, with no loop.

**Teaching add-on — refresh visible in the token chain (IMPLEMENTED 2026-06-15).**
The silent RT→AT refresh was invisible in the token-chain UI: `middleware/tokenRefresh.js`
minted a new access token but never recorded a token-chain event, and although
`tokenChainService` defines `eventType:'refresh'` (+ a `generateTokenDescription` case) and
`getTokenChain()` returns all event types, **nothing ever emitted one**. Fix: after minting the
new AT, `middleware/tokenRefresh.js` now calls `tokenChainService.trackTokenEvent({ eventType:
'refresh', token: <new AT>, userId: req.session.user.id, ... })` (non-fatal). The new AT's
decoded `sub`/`aud`/`scope`/`exp` now appear in `TokenChainDisplay` as a refresh step. Keyed by
`req.session.user.id`, which equals the token `sub` the route + other emitters use.

### Refresh gets its own CARD in the token chain — [IMPLEMENTED 2026-06-15, both surfaces]

> Implemented as described below. Files: `middleware/tokenRefresh.js` (markers
> `refreshedAt` + `req._didRefresh`), `services/agentMcpTokenService.js`
> (`buildRefreshTokenEvent` + `prependRefreshEvent` helpers; session-preview card),
> `routes/demoAgentRoutes.js` (prepend on init + message responses),
> `demo_api_ui/src/components/TokenChainDisplay.js` (`STEP_SUB_LABELS` +
> `CLAIMS_STRIP_IDS` += `token-refresh`). Verified: BFF `node --check` clean, exports
> load, pre-existing circular warning unchanged; UI `npm run build` clean. Tests TODO.

Decision: render the refresh as its own card in **both** the session-preview (idle) view and
the live tool-call chain. Note: the committed `trackTokenEvent({eventType:'refresh'})` emit
populates the **persisted** `/api/token-chain` store — but `TokenChainDisplay`'s main chain
does **not** render that store; it renders live `ctx.events` or `GET /api/tokens/session-preview`.
So the card needs wiring into those two display arrays. The display keys cards by a stable
`event.id`, so the refresh card uses **`id: 'token-refresh'`** (not the persisted UUID).

**Shared card shape** (via `agentMcpTokenService.buildTokenEvent`):
```
buildTokenEvent(
  'token-refresh',
  'Refreshed Access Token (RFC 6749 §6)',
  'active',
  { header: null, claims: <decoded NEW access token: sub, aud, scope, exp, iat> },
  'A new access token was silently minted from the refresh token (RFC 6749 §6). Same sub; '
   + 'the refresh token rotates and exp is extended. Tokens never reach the browser.',
  { rfc: 'RFC 6749', refreshedAt: <ts> }
)
```

**BFF — surface 1: session preview (idle).**
- `middleware/tokenRefresh.js`: on a successful refresh, stamp a marker —
  `req.session.oauthTokens.refreshedAt = Date.now()` (next to the new-token write). Already
  emits the persisted event; just add the marker.
- `services/agentMcpTokenService.js` → `buildSessionPreviewTokenEvents(req)` (~line 412): right
  after `appendUserTokenEvent(...)`, if `req.session.oauthTokens?.refreshedAt` is set, push the
  `'token-refresh'` card (claims decoded from the current — i.e. refreshed — session access
  token). Positions the refresh card directly under the user token.

**BFF — surface 2: live tool-call chain.**
- `middleware/tokenRefresh.js`: when it refreshes, stash the built card on the request —
  `req._refreshTokenEvent = buildTokenEvent('token-refresh', …)`.
- Find the single point where the NL/agent response's `tokenEvents` array is finalized (the
  collectors that do `tokenEvents.push(...exchangeEvents)` — `bffMcpToolExecutor.js`,
  `agentMcpTokenService.js`, and the agent service that returns `bankingResult.tokenEvents`).
  Prepend `req._refreshTokenEvent` if present so the refresh shows ahead of the exchange steps.
  (TODO at implementation: confirm the one finalize point to avoid double-inserting.)

**UI — `TokenChainDisplay.js` (REGRESSION-PROTECTED — apply regression-guard):**
- `STEP_SUB_LABELS` (~line 2220): add `'token-refresh': 'Refreshed Token'`.
- `CLAIMS_STRIP_IDS` (~line 2060): add `'token-refresh'` so the sub/aud/scope/exp strip renders.
- `'active'` status already maps to the green bucket — no STATUS_VISUAL change.
- Optional: an `EventRow` explainer block for `event.id === 'token-refresh'` (mirroring the
  other id-specific sections) describing RFC 6749 §6 refresh: same `sub`, rotated RT, extended
  `exp`, custody preserved.
- Changes are additive (new id in two maps); classic behaviour for existing ids is unchanged.
- Gate: `cd demo_api_ui && npm run build` must be clean; no emojis beyond ⚠️/✅/❌.

**Reconciliation:** keep the committed persisted `eventType:'refresh'` emit (audit/history record)
AND add these display cards — they serve different views (persisted store vs live/preview render).

**Done =** after a silent refresh, the idle token-chain shows a "Refreshed Token" card under the
user token; and when a refresh coincides with an agent call, the live chain shows it ahead of the
exchange steps — both with the new AT's decoded sub/aud/scope/exp.

## Phase 2 — Lifetimes + rotation

Files: PingOne config (Phase 0 numbers), `server.js` (cookie maxAge), `services/lmdb/sessionStore.js`
(TTL), `middleware/tokenRefresh.js`.

- [x] **DONE — grant `offline_access`** (openid resource) to the Demo User App. Phase 0 found
      it was missing (no openid-resource grant); created grant `d1f98a48`. Token now returns
      `scope="openid offline_access"`. Required for any session-independent RT.
- [x] **RESOLVED — timeout-survival confirmed by owner (2026-06-15):** a PingOne `offline_access`
      RT survives a natural SSO idle/max timeout (anchored to the auth event); only a forced
      sign-off revokes it. The 1 h SSO / 8 h RT split is valid.
- [ ] Set **AT = 15 min**, **RT = 8 h absolute** in PingOne; ensure rotation + replay
      protection are on; ensure the RT cap is absolute-anchored.
- [ ] Set **BFF cookie maxAge = 8 h** and **LMDB session TTL = 8 h** (track the RT).
- [ ] Set **PingOne SSO session = 1 h**.
- [ ] **Fix the rotation/blacklist edge (G4):** with a 15-min AT the refresh path runs far more
      often, so the current immediate **10-min blacklist on `invalid_grant` is too aggressive**.
      Replace it with the in-flight lock (already present) **+ one bounded retry / ~5-min grace**
      before blacklisting, per the concurrency guidance. Confirm `session.save()` ordering can't
      race a benign reuse.
- [ ] Document the four lifetimes as one policy in the `bff-sessions` / `oauth-pingone` skills.

**Done =** a session past AT expiry refreshes silently; rotation never self-locks; cookie/LMDB
= 8 h, SSO = 1 h, RT = 8 h, AT = 15 min — all deliberate and documented.

## Phase 3 — Single logout (RP-initiated)

Files: `routes/oauth.js`, `routes/oauthUser.js`, `services/oauthService.js`,
`services/sessionCookies.js`.

- [ ] Guarantee logout does all three, in order: RFC 7009 **revoke** (access + refresh) →
      **destroy** BFF session + clear all cookies (`connect.sid`, `_auth`, `_pkce`) →
      **`/as/signoff`** with `id_token_hint` so the PingOne SSO session ends too.
- [ ] Address any CSRF gap found in Phase 0.

**Done =** deliberate logout ends the PingOne SSO session — the next visit is a real login,
not a silent re-auth.

## Phase 4 — Lock

- [ ] Regression + integration pair per seam:
      - premature session-loss (hour 0–1) recovers silently
      - dead SSO session falls through to explicit login exactly once (no loop)
      - rotation under load does not self-lock
      - logout ends the SSO session
      - offline RT still refreshes after SSO expiry (guards the 1 h/8 h split)
- [ ] Update `bff-sessions` skill: retire the `_cookie_session` limbo from the failure-mode
      table; add the silent-reauth state machine + the lifetime policy.
- [ ] Update `oauth-pingone` skill: document the top-level `prompt=none` recovery and the
      lifetime policy.

**Done =** all seams covered by tests; both skills reflect the new model.

## Success criteria (overall)

1. A browser session lost within the first hour is restored with no visible login.
2. A session stays alive for the full 8 h via refresh, with 15-min ATs, no bounces.
3. After 8 h (or a dead SSO + lost session), the user gets exactly one clean explicit login,
   never a loop.
4. Deliberate logout ends the PingOne SSO session.
5. The 1 h SSO / 8 h RT split is verified: refresh still works after the SSO session expires.
