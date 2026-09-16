# /sdk-login: pop-out and embedded sign-in beside the centralized redirect

**Status:** approved design, 2026-09-14
**Page:** `demo_api_ui/src/pages/SdkLoginPage.jsx` (`/sdk-login`), callback `SdkLoginCallback.jsx` (`/sdk-login/callback`)

## Goal

The `/sdk-login` sandbox teaches browser-side OIDC with `@forgerock/oidc-client`: authorization code + PKCE, tokens held in the browser. Today its only sign-in is a full-page redirect to PingOne's hosted login. Add two more sign-ins **on the same page, using the same PKCE app and the same SDK token store**, so a developer can compare them:

1. **Redirect** (existing, unchanged) — `client.authorize.url()` then `window.location.href`.
2. **Pop-out** — PingOne's hosted login in a popup window; the page never navigates.
3. **Embedded** — the page's own username/password form driving PingOne's native flow (`response_mode=pi.flow`) from the browser.

## Measured facts this design rests on (2026-09-14)

- PKCE app `160cc22f-ccc4-4fef-8470-c9094c8a9afa` "Demo AI App - PKCE": `WEB_APP`, `tokenEndpointAuthMethod: NONE`, `pkceEnforcement: S256_REQUIRED`, redirect URIs `https://local.ping-devops.com:4000/sdk-login/callback` and `https://ai-demo.ping-devops.com/sdk-login/callback`. Sign-on policies in order: `Single_Factor` (LOGIN), `Multi_Factor` (LOGIN + MFA). A plain sign-in therefore asks only for username and password.
- `@forgerock/oidc-client` 2.x has `authorize.url()` and `authorize.background()` (silent, needs an existing session) — **no popup API**. `@forgerock/sdk-oidc` keeps state and the PKCE verifier in **`sessionStorage`** (per tab).
- Native flow from a browser origin, before any change: preflights on `/as/authorize`, `/flows/{id}`, `/as/resume` answer with our origin and `allow-credentials: true`. `GET /as/authorize?…&response_mode=pi.flow` returns `USERNAME_PASSWORD_REQUIRED` with `_links["usernamePassword.check"]`. `POST /flows/{id}` with `Content-Type: application/vnd.pingidentity.usernamePassword.check+json` returns `COMPLETED` and sets `ST` / `ST-NO-SS`. **But** the credentialed `GET /as/resume` returned 200 with `authorizeResponse.code` and **no `Access-Control-Allow-Origin`**, so a browser read failed ("Failed to fetch"). Without the `ST` cookie, resume instead 302s to PingOne's hosted sign-on page with `?error`.
- **PingOne change made (user-approved):** the PKCE app's `corsSettings` set from `null` to `{ behavior: ALLOW_SPECIFIC_ORIGINS, origins: [https://local.ping-devops.com:4000, https://api.ping.demo:4000, https://ai-demo.ping-devops.com] }` — the same list the DaVinci SDK app uses. Every other field verified unchanged; rollback copy saved. After it, all three legs return our origin with credentials, and a real headless-Chromium run on our origin read resume's `authorizeResponse.code` with the matching `state`. `ST` was stored as `SameSite=None`, not partitioned.
- `/flows/{id}` takes **no** Authorization header (it is served by `auth.pingone.com`; see `routes/nativeFlowSample.js`).

## Design

### Shared: one SDK client, one token store

All three sign-ins build their authorize request with `client.authorize.url()` so the SDK generates and stores `state` + the PKCE verifier, and all three finish with `client.token.exchange(code, state)` **in the `/sdk-login` tab**, which owns that `sessionStorage`. The page then calls its existing `refresh()`. Nothing about token storage, revoke, logout, step-up or the token inspector changes.

### Pop-out

1. `handlePopupSignIn`: `url = await client.authorize.url()`; `popup = window.open(url, "sdk-login-popup", "popup,width=520,height=720")`.
   - `popup === null` → message "Your browser blocked the pop-up. Allow pop-ups for this site, or use another sign-in." Reset busy.
2. PingOne's hosted login runs in the popup and redirects to the existing `/sdk-login/callback` (already a registered redirect URI; no PingOne change).
3. `SdkLoginCallback` detects the popup case — `window.name === "sdk-login-popup"` **and** `window.opener` exists **and** is same-origin — and then, instead of exchanging, posts `{ type: "sdk-login-popup-result", code, state, error, errorDescription }` to `window.opener` with target origin `window.location.origin`, and closes itself. Existing redirect behaviour (exchange, then navigate to `/sdk-login`) is unchanged when not in the popup.
4. The page listens for `message`: accepts only `event.origin === window.location.origin` and `event.source === popup`; on a code, runs `client.token.exchange(code, state)` then `refresh()`; on an error, shows it.
5. A 500 ms `popup.closed` check resets busy with "The sign-in window was closed before it finished." if no result arrived. Listener and timer are removed on result, close, or unmount.

The popup never exchanges the code: its own `sessionStorage` copy of the verifier is not guaranteed across browsers, and keeping the exchange in the opener keeps one code path.

### Embedded form (username + password)

New module `demo_api_ui/src/lib/embeddedPiFlow.js` — fetch only, no React:

- `startEmbeddedSignIn(client)` → `url = await client.authorize.url()`; append `response_mode=pi.flow`; `fetch(url, { credentials: "include" })`; returns `{ flowId, status, checkUrl }`. Status other than `USERNAME_PASSWORD_REQUIRED` → typed error `unsupported_step`.
- `submitPassword(flow, username, password)` → `POST checkUrl` with `Content-Type: application/vnd.pingidentity.usernamePassword.check+json`, `Accept: */*`, `credentials: "include"`, body `{ username, password }`.
  - `COMPLETED` → `GET` the flow's resume URL (`resumeUrl` if present, else `/as/resume?flowId=`) with `credentials: "include"`, read `authorizeResponse.{code,state}` → return them.
  - A PingOne validation error (wrong password) → typed error `invalid_credentials` carrying PingOne's message.
  - Any other status (e.g. `MFA_REQUIRED`, `PASSWORD_EXPIRED`, `FAILED`) → typed error `unsupported_step` with the status.
  - A resume that throws, returns no code, or redirects → typed error `resume_blocked` ("this browser did not send PingOne's session cookie — third-party cookies are blocked here").
- The page's embedded form submits, calls `client.token.exchange(code, state)`, then `refresh()`. On `unsupported_step` or `resume_blocked` it shows the reason plus **Use the pop-out** and **Use the redirect** buttons. The password is cleared from state after every submit.

The password goes from the browser **directly to PingOne** and never to the BFF. No `login_hint` prefill in the form (it is visible, the user types it).

### Page layout and copy

The signed-out card becomes three options in order — Redirect, Pop-out, Embedded — each with one sentence on what happens and the SDK/API calls involved. Embedded's sentence states the two requirements: explicit CORS origins on the PingOne app, and a browser that keeps PingOne's third-party session cookie (Chrome yes; Safari and private windows block it). The flow timeline and the "Different from the main app" note are unchanged.

### Styling

The page already styles everything inline with its own `PALETTES` object (a pre-existing THEMING H3 gap this change does not sweep). New controls take their colours from a new `SdkLoginPage.css`, which reads CSS custom properties that the page root sets once from the active palette (`--sdk-panel`, `--sdk-text`, `--sdk-muted`, `--sdk-blue`, `--sdk-border`, `--sdk-red`). No new inline colour, background or font-size. Font sizes from the scale, radii from `--radius-*`.

### Recording the PingOne requirement

No provisioning script manages this app (`scripts/cleanup-pingone-apps.sh` only references it), so a re-created app would come back with `corsSettings: null` and the embedded sign-in would fail at resume. Add a `TECH_DEBT.md` entry naming the required `corsSettings`, and state the requirement in the page copy.

## Out of scope

- MFA or any second step in the embedded form (it falls back to pop-out/redirect).
- Making embedded sign-in work where third-party cookies are blocked.
- Changing the BFF, the main app login, or the DaVinci pages.

## Testing

- **Unit (vitest):**
  - `embeddedPiFlow` with a fake fetch: start expects `USERNAME_PASSWORD_REQUIRED`; submit sends the vendor content type and no Authorization; `COMPLETED` → resume → `{code,state}`; wrong password → `invalid_credentials`; `MFA_REQUIRED` → `unsupported_step`; resume throw/no-code → `resume_blocked`; every call uses `credentials: "include"`.
  - `SdkLoginCallback` popup branch: with `window.name` set and a same-origin opener it posts the result with target origin `location.origin`, closes, and never calls `token.exchange`; without it the existing redirect path still exchanges and navigates (extend `SdkLoginCallback.test.jsx`).
  - `SdkLoginPage`: three sign-in options render when signed out; popup blocked → message; a message from another origin or another window is ignored; a valid popup result calls `token.exchange` then refresh; embedded `unsupported_step` / `resume_blocked` show the reason and both fallback buttons; the password field is cleared after submit.
  - Existing `SdkLoginPage.*.test.jsx`, `sdkLoginHeadingMatchesNav.test.js`, theming ratchet, test-conventions ratchet stay green; `npm run build` exits 0.
- **Live (Playwright, stack generation pinned, 1440x900):** embedded sign-in with the E2E customer ends signed-in on `/sdk-login` with no navigation; pop-out sign-in via `page.waitForEvent("popup")` ends signed-in with no navigation of the main page; redirect sign-in still works. Credentials read from `.env`, never printed.
