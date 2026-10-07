# Plan: finish the pi.flow sign-in in the page (no full reload)

Status: **closed 2026-10-07 — not built.** The §6 gate came back negative (see §9). Kept as the reference for what an in-page completion would take, if the numbers change.

## 1. Why this exists

A measured sign-in (2026-10-06, dev server, one run, user typing excluded) spends its time here:

| Step | Cost |
|---|---|
| `POST /api/auth/oauth/user/pi-flow/credentials` | 0.36 s |
| `GET /api/auth/oauth/user/callback?code=…` (token exchange, session) → 302 | 0.92 s |
| `/dashboard?oauth=success…` document | 24 ms |
| **Browser reboots the whole SPA before its first API call** | **1.2 s** |
| Boot API burst (about 55 calls, `/api/auth/session` queued to about 1.0 s) | about 1.5 s |
| Dashboard files finished loading | 8.1 s after submit |

The server-side sign-in is about 1.3 s. Most of what the user feels is the reload that follows it. `npm run ui:mode built` (PR #943) already cuts the reload itself (1,377 requests to 33), so §6 says to re-measure before doing this.

## 2. How it works today

- `PiFlowSignInModal.jsx:136` — on `res.ok && body.redirectTo` it calls `navigateWithOverlay(body.redirectTo, { assign: true })`: a full-page navigation.
- `oauthUser.js:429` `completePiFlow` — gets the authorization code, then returns `{ redirectTo: <callback>?code&state }`.
- `oauthUser.js:901` `GET /callback` — validates state, exchanges the code (PKCE), validates identity, **regenerates the session** (about line 1292), stores tokens, records the login trace, then `res.redirect(<app>/<returnPath>?oauth=success[&login_trace=<id>])` (line 1420). Step-up logins redirect to `stepUpReturnTo` instead (line 1401).
- `App.js:480-520` — reads `?oauth=success` and `?login_trace=` **from the URL on first render** (the success modal opens once; the login flow diagram loads once). `useOAuthUrlCleanup` strips them afterwards.
- `useAuth.js:59` — dispatches `userAuthenticated` once the session is established.

## 3. Precedent: an in-page sign-in already exists

`DavinciLoginWidget.jsx`, `DavinciSdkLoginPage.jsx` and `PrivilegeMcpClientPage.jsx` finish a login **without a reload**: they POST, then `window.dispatchEvent(new CustomEvent("userAuthenticated"))`, and 16 files listen for that event. So most of the app already tolerates a sign-in that happens in place. The open question is what only works after a reload.

## 4. Options

**A. Client-only (smallest).** In `PiFlowSignInModal`, instead of `assign(redirectTo)`: `fetch(redirectTo, { credentials: "include", redirect: "manual" })`, then dispatch `userAuthenticated` and navigate with react-router. No BFF change; the callback stays exactly as it is.
- Unproven: that the callback sets the regenerated session cookie on a `redirect: "manual"` fetch response, and that it does not depend on the request being a top-level document navigation (it logs an "Unexpected referer" warning at line 917 but does not reject). **This needs a one-off experiment with a real sign-in before anything else.**
- The `Location` of a manual redirect is opaque, so `login_trace` cannot be read from it; the trace id would have to come from another call.

**B. Server-side completion.** Extract the body of `/callback` into a function the credentials route can call, and return `{ ok, returnTo, loginTraceId }` as JSON. Cleanest contract, but it refactors about 500 lines of the most protected route (REGRESSION_PLAN §1 rows for OAuth user login, status expiry, admin role detection). Only worth it if A fails the experiment.

**C. Do nothing.** Rely on the built bundle. Valid if §6's re-measure shows the reload is cheap.

## 5. What a soft navigation would break (must be handled, in either A or B)

1. `freshLogin` and `loginTraceId` are captured from the URL on first render — pass them through state or an event instead of query params.
2. The **session id changes** at login. Anything opened as a guest keeps the old cookie: the `verticals/stream` EventSource, any in-flight request, and per-user caches (`/api/verticals/me`, `/api/user/nav-config`, conversation summaries, token chain). Each must refetch or reconnect on `userAuthenticated`. Check the 16 listeners against this list, not just that they exist.
3. Boot-once effects keyed on mount (providers that read the session once) will not re-run without a reload.
4. Admin versus customer is decided by the 4-signal check in the callback; the UI must pick up the role from the status endpoint after login, not assume.
5. Step-up (`stepUpReturnTo`), the passkey step, and every `fallback: true` path must keep using the plain redirect.

## 6. Decision gate (do this first)

1. Merge #943 and run `npm run ui:mode built`.
2. Re-measure sign-in on the built bundle: the user signs in once in the visible-window capture, or saves a HAR. Compare "submit to first data on screen" with §1.
3. **Build this only if the reload still costs more than about 1 s there.** If it does not, close this plan; the risk to the protected sign-in path outweighs the gain.

## 7. If it goes ahead

- Behind a flag, default off (`ff_*`, registered the way other flags are, and listed in `requiredDemoFlags.js` only if a chip needs it). Rollback is the flag; the redirect path is never deleted.
- Order: experiment for A (§4) → implement A behind the flag → verify with a real login in both a customer and an admin account, then step-up and passkey → decide on default.
- Regression plan (from `REGRESSION_PLAN.md`): state what is not being changed (the callback, `requireNotAdmin`, session regenerate, role detection); keep the diff to `PiFlowSignInModal.jsx` plus one small hook; run `cd demo_api_server && CI=true npx jest src/__tests__/oauthUser*` and the UI sign-in tests; add a vitest for the soft path asserting `userAuthenticated` fires once and the fallbacks still call `redirectLogin`; add an entry to REGRESSION_PLAN §4.
- Verification must be a real sign-in on `local.ping-devops.com:4000`, compared before and after with the same capture script, and pinned with `npm run stack:generation`.

## 8. Open questions

- Does the callback accept a `redirect: "manual"` fetch (experiment in §4A)?
- Does anything depend on `?oauth=success` beyond the success modal and the login trace (`AIAgent.js:2365` auto-opens the agent on it)?
- Should the overlay (`navigateWithOverlay`) stay for the whole in-page step, so the user still sees "Signing in…" while the callback runs?

## 9. Outcome of the §6 gate (2026-10-07)

PR #943 shipped `npm run ui:mode built` and the live stack was switched to it. One real sign-in was then captured the same way as §1 (visible window, user typing excluded; stack generation identical before and after). One run each, same machine, so read the ratios, not the decimals.

| Step | dev server (§1) | built bundle |
|---|---|---|
| Credentials POST | 0.36 s | 0.07 s |
| Callback (token exchange, session) | 0.92 s | 0.61 s |
| Dashboard document to first API call | 1.2 s | **0.22 s** |
| Submit to first API call | 2.5 s | **0.94 s** |
| Submit to account data on screen | about 3.3 s | **about 1.4 s** |
| Requests after the session exists | 1,100 | **57** |
| Everything settled after submit | 8.1 s | **about 2.0 s** |

**Result:** the reboot that an in-page completion would remove is now about 0.3 s (document plus time to the first API call). The data fetches after it (accounts, transactions, the boot API burst) happen with or without a reload. Best case saved: roughly 0.3 to 0.5 s, against a change to the most protected route in the repo. That is under the 1 s bar in §6, so this is closed.

Left on the table, in order of size:

1. The boot API burst — about 45 calls in about 1.1 s once signed in; `/api/auth/session` is called 5 to 6 times and queues up to about 0.8 s. Several of the callers are sign-in code, so dedupe needs care.
2. `POST /api/demo-agent/tools` takes about 2.5 s (it completed in the built-bundle run; the earlier "pending" was the capture ending).
3. The callback itself, about 0.6 s, mostly PingOne round trips.
