# Unified pi.flow sign-in service — design spec

Date: 2026-10-10
Status: approved in chat (approaches + sectioned design); this document pins the details.
Companion plan: written after spec review.

## Problem

Sign-in works, but it is not one thing:

- **22 components** render `SignInPrompt` and **6 surfaces** open `SignInModal`; all route through
  `authUi.js` dispatchers that *prefer* `PiFlowSignInModal` but silently fall back to a full-page
  redirect when the config fetch hasn't landed or the flag is off.
- **7 surfaces bypass the modal entirely** with raw `window.location` / `navigateWithOverlay`
  redirects to the BFF login endpoints: `LandingPage.js` (×2), `AIAgent.js` (×2, one sending a
  dead `use_pi_flow` param nothing reads), `OAuthTokenDisplayPage.jsx` (which carries a **whole
  duplicate pi.flow driver** via `embeddedPiFlow.js`), `PingOneProviderGuard.jsx`,
  `VerticalEditorPage.jsx`, `TokenExchangeTesterPage.jsx`, `PingFederateDownModal.jsx`.
- The modal asks for a **password first**; passwordless (device-only) is a secondary step even
  though the driver and the modal both support it (P1/P2 of the 2026-10-09 passwordless spec
  shipped).
- **login_hint** is derived per-request from the session (`services/loginHint.js`); nothing
  persists across sessions, so a returning user retypes their username every time.
- **Registration** enrolls only an email device (`ensureEmailDevice`), and accepts any email
  (including plus-addressed ones like `cmuir+p1@pingone.com`), so a freshly registered user may
  still be unable to sign in passwordless.

Result: two screenshot-visible sign-in experiences (the "Sign in required" card and the
"Sign in to continue" interrupt) that do not themselves look like the branded pi.flow modal they
actually hand off to, plus sign-in paths that never see the modal at all.

## Goal

Every sign-in in the app opens the pi.flow modal — Ping2026 branding, **passwordless-first**,
password one click away — through **one shared service**. PingFederate rides the same service
(one service, two provider backends; the BFF driver already speaks both). login_hint persists
per role in configStore. Registration enrolls **both** EMAIL and SMS devices under a strict
email rule, so a new user can sign in passwordless from day one.

## Non-goals

- Creating the PingOne `mfa_only` sign-on policy (console action; operator prerequisite — see below).
- Migrating *existing* users' devices (demoUser already has 4 usable devices).
- Redesigning `SignInPrompt` / `SignInModal` visuals — they keep their looks; only their buttons'
  target changes (to the shared service).
- The `/sdk-login` page's browser-driven flow (the page's purpose is demonstrating it).
- `/callback`, PKCE, session creation, step-up MFA (`/stepup`) internals.

## Operator prerequisite (PingOne console, not code)

`acr_values=mfa_only` currently fails with "Invalid sign-on policy provided in acr_values" — the
device-first policy does not exist yet. A prior session's unmerged worktree
(`worktree-passwordless-acr`, commit 369771055) already retargets `passwordless=1` from
`Multi_Factor` to `mfa_only`. This project **merges that branch** and treats the console policy
creation as an operator prerequisite:

- While `mfa_only` does not exist in PingOne, `passwordless=1` → 400 on open → the modal's
  existing `openFlow` failure path redirects to hosted login — **not acceptable for the default
  step**. Therefore the modal's default stays passwordless-first ONLY when the flow opens
  successfully; a 400/409 on open with `passwordless=1` snaps back to the password form inside
  the modal (not a redirect). See §2.

## Approach

### §1 The service — `signInService.js` (one service, both providers)

New `demo_api_ui/src/utils/signInService.js`:

```js
openSignIn({ role = 'customer', returnTo, force })   // opens the pi.flow modal
openAdminSignIn({ returnTo, force })                 // convenience: openSignIn({ role: 'admin', ... })
isSignInAvailable()                                  // true once config confirmed pi.flow drivable
```

- On first call (and eagerly at App mount via a one-line `<SignInServiceInit />` or an effect in
  `App.js`), it fetches `/api/admin/config` **once**, caches the availability
  (`PINGONE_USER_AUTHORIZE_PI_FLOW` / `PINGONE_ADMIN_AUTHORIZE_PI_FLOW` + provider in
  `['pingone','pingfederate']`), and exposes it. `PiFlowSignInModal`'s own gate
  (`setPiFlowSignInAvailable`) moves into the service; the modal subscribes instead of fetching.
- `openSignIn` dispatches the existing `PI_FLOW_SIGNIN_EVENT` with `{ returnTo, role, force }`.
  If the modal is unavailable (flag off / non-drivable provider), the service falls through to
  the current redirect behavior — the fallback lives in ONE place instead of N.
- `authUi.js`'s `navigateToCustomerOAuthLogin`, `navigateToCustomerOAuthForceLogin`,
  `navigateToAdminOAuthLogin` become thin wrappers over `openSignIn` (same signatures, same
  exports). The 22 `SignInPrompt` sites, 6 `SignInModal` sites, TopNav, UserMenu: **zero code
  changes**.
- `startRoleSwitch` keeps its POST `/api/auth/switch` (it clears the session first) but its
  final navigation asks the service for the modal when the target role's pi.flow is available;
  redirect otherwise. `RequireAdminLogin` and `AdminSideNav` keep calling `startRoleSwitch`.

**De-bypass (7 files):** replace each raw login redirect with `openSignIn`:
`LandingPage.js` (both redirects), `AIAgent.js` (admin action + customer default; the dead
`use_pi_flow` param is deleted), `OAuthTokenDisplayPage.jsx` (its inline embedded driver's
username/password form is replaced by the modal; its "tokens while signed out" pre-auth data
fetching is untouched), `PingOneProviderGuard.jsx`, `VerticalEditorPage.jsx`,
`TokenExchangeTesterPage.jsx`, `PingFederateDownModal.jsx`.

**Deliberate exceptions (stay redirects):** `useAuth.js` silent-reauth (credential-less
re-auth), `LogoutPage.js` live-id-jag mode, `/sdk-login` (embedded demo is the point).

**PF = one service.** The modal already opens PF flows (`drivable` includes `pingfederate`,
`begin()` routes admin/customer identically). This project extends the driver's
`respondAfterPiFlowStep` so PF MFA statuses drive in the modal instead of the `mfaRequested() &&
PF → hosted` detour: PF `OTP_REQUIRED` and `DEVICE_SELECTION_REQUIRED` already map; PF push /
TOTP confirm statuses map onto the same otp/device steps. The `mfaRequested() && PF` early
redirect in `begin()` is removed once the driver handles those statuses (behind the same
`fallback:true` safety net as PingOne). PF passwordless (username-only) stays out of scope
(= P3 of the prior spec) — the device step 409s for PF as it does today.

### §2 Passwordless-first default in the modal

- `PiFlowSignInModal`'s initial `step` becomes `'device'` (username-only) instead of `'password'`.
- The existing switch links already cover both directions ("Use your password instead" /
  "Use a device instead"). The username typed on the device form carries into the password form
  (already implemented); the reverse also pre-fills.
- Open-failure snapping: `openFlow({ passwordless: true })` failing with 400 (policy absent) or
  the first submit 409ing `passwordless_unavailable` switches to the password step **inside the
  modal** with the message — never a hosted redirect for the *default* step. The
  `passwordless=1` open attempt happens on mount; if the admin later creates the policy, the
  default path just starts working (no code change). Cost while the policy is absent: every
  sign-in pays one fast 400 round trip before the password form renders inside the modal.
  Accepted deliberately — the alternative (remembering "policy missing" in localStorage) goes
  stale the moment the policy is created and silently disables passwordless.
- Admin role: same default, `apiForRole()` already routes.

### §3 Registration enrolls both devices, strict email

Server — `routes/selfServiceUsers.js` + `services/mfaService.js`:

- **Email validation tightened** (express-validator chain + client mirror in `SelfServicePage.js`):
  domain must be `pingidentity.com` or `pingone.com`; the local part must not contain `+`
  (plus-addressing breaks device enrollment and hint matching). Error copy names the rule.
- **Phone required**: `body('phone')` loses `.optional()` (client form marks it required too),
  stays `isMobilePhone()`.
- **`ensureSmsDevice(userId, phone)`** in `mfaService.js`, modeled on `ensureEmailDevice`:
  list devices first; skip if an SMS device with the same phone exists (idempotent); otherwise
  `enrollSmsDevice(userId, phone)` with the **worker token** (registration precedes any session,
  and worker-token enrollment creates the device ACTIVE — no OTP verification loop at
  registration time). Non-fatal like the email enrollment: the user is created either way; the
  outcome lands in the response as `mfaSmsDevice`.
- The handler calls `ensureEmailDevice` (unchanged) then `ensureSmsDevice`, reporting both.

### §4 login_hint — configStore, per role

- New configStore keys `last_login_hint_customer` and `last_login_hint_admin` (LMDB rows;
  `FIELD_DEFS` entries so admin config UI can see them; no default values).
- **Write on successful sign-in**: the user callback (`routes/oauthUser.js`) sets
  `last_login_hint_customer`, the admin callback (`routes/oauth.js`) sets
  `last_login_hint_admin`, after token exchange, value = the authenticated username. Failure to
  write is logged, never fatal.
- **Write on modal edit**: the modal PUTs `PUT /api/auth/login-hint` (`{ role, value }`) 800 ms
  after the user's last keystroke in the username field (and on step switches away from the
  form), so a value typed then abandoned still prefills next time; on successful sign-in the
  callback write wins (same value in practice). The endpoint validates with the
  session-name rule (`cleanName`: non-empty, ≤256 chars, no control characters — NOT §3's
  registration email rule, because usernames like `cmuir+demo-user@pingone.com` legitimately
  contain `+`); role is
  `customer` (default) or `admin`. Convenience prefill only — never an auth decision.
- **Read at flow open**: `openPiFlow` in `services/piFlowDriver.js` adds the role's stored hint
  to the authorize URL (PingOne only — PingFederate *binds* the flow to the hint, so a stored
  username would lock a shared machine to the last signer-in), and the open response's
  `usernameHint` (currently PF-only) is returned for PingOne too, so the modal prefills from
  storage. On a **forced** re-auth (`force=true`) the stored hint is dropped (a different
  person may be signing in; the session-derived `loginHintFor` still applies, fresher wins).
  [Amended during the final review: the original text said the stored hint goes to both
  providers and survives force — both were wrong against PF's binding behavior and the
  pinned admin test.]
- Same-browser different-role stays correct because the keys are per role.

### §5 Branding

No new branding work. The modal already renders `SignInBrand` + vertical manifests (Montserrat /
2026 palette landed). Making the modal the only sign-in surface is what makes branding uniform.

## Testing

- **UI (vitest)**
  - `signInService` unit: eager config fetch once; availability caching; role/force mapping;
    dispatch + redirect fallback.
  - `PiFlowSignInModal`: default step is device (username-only); open-failure with
    `passwordless=1` snaps to password inside the modal (no redirect); 409 snap-back preserves
    username; PF MFA statuses now driven (no hosted detour for `?signin=mfa` + PF).
  - De-bypass files: LandingPage, AIAgent, OAuthTokenDisplayPage, PingOneProviderGuard,
    VerticalEditorPage, TokenExchangeTesterPage, PingFederateDownModal each assert
    `openSignIn`/modal dispatch instead of `window.location` to the BFF login.
  - Existing suites stay green (40 modal + 9 embedded + the rest).
- **Server (jest)**
  - `selfServiceUsers`: email domain allowlist + plus-sign rejection (client and server), phone
    required, `mfaSmsDevice` in the response, idempotent re-registration.
  - `mfaService.ensureSmsDevice`: creates when absent, skips when same-phone SMS exists, worker
    token used.
  - login-hint: callback writes per role; `PUT /api/auth/login-hint` validation; `openPiFlow`
    sends stored hint for both providers; forced re-auth still prefills; session-derived hint
    precedence unchanged for redirect paths.
  - Driver suites (43 + 11) stay green; new PF MFA mapping tests added.
- **Live drive after deploy**: passwordless default with demoUser's devices once `mfa_only`
  exists (or 409-snap-back before that); registration → both devices enrolled → passwordless
  sign-in as the new user; hint persistence across a container restart (LMDB).

## Success criteria

1. No surface in the app performs a raw redirect to a BFF login endpoint, except the three
   named exceptions.
2. The modal's first screen is the device-only (passwordless) step; password is one click away;
   policy-absent never dead-ends or redirects.
3. A newly registered user (valid email + phone) has an EMAIL and an SMS device enrolled and can
   complete a device-only sign-in once the `mfa_only` policy exists.
4. login_hint for the last customer login and the last admin login survives a BFF restart and
   prefills the modal on the next sign-in for that role.
5. PF sign-in drives MFA in the modal for the statuses the driver can serve; the hosted page
   remains only the `fallback:true` safety net.
6. All existing UI + driver suites green; new tests red→green.
