# POST /api/demo/spiffe/privilege/call: require a signed-in session

**Status:** agreed (owner: "do as follow up PR", page is only used signed in, guests not needed, 2026-11-22)   **Owner:** Curtis
**Stacked on:** PR #3675 (input lock + rate limit). Base this branch on it; retarget to `main` once #3675 merges.

## Goal
After #3675 an anonymous caller can no longer choose the audience, scopes, path or method, but can still obtain one canned token of each `token_mode`, including a PingFederate `client_credentials` token minted with the server-held secret. Require a session so only signed-in users can trigger a mint.

## Acceptance criteria
1. No session: `POST /api/demo/spiffe/privilege/call` returns 401 `unauthenticated` and the service is never called, for any body (including the exact page body).
2. With a session (`req.session.user` set): behaviour is exactly as in #3675 (page body 200, locked inputs 400, rate limit 429).
3. The session check runs before the rate limiter, so anonymous traffic cannot use up a shared per-IP bucket (`trust proxy` is 1; visitors can share one) and lock signed-in users out.
4. `auth-requirements.json` declares `/spiffe-privilege` as `user`; `App.js` shows `SignInRequired` for a signed-out visitor on `/spiffe-privilege`; `npm run authz:verify` passes (it checks the file and the route guard agree).
5. The page's own fetch still works signed in: same-origin `fetch` sends the session cookie, no change to `SpiffePrivilegePage.jsx`.

## Unhappy paths
- Session expires mid-demo: the page's `fetch` gets 401; the page already shows non-OK responses as an error row (verify, do not assume).
- Flag `ff_spiffe_privilege` off: unchanged (signed-in callers get the service's 503).
- Signed-out visitor opens `/spiffe-privilege`: sees the sign-in prompt, not a page whose buttons all fail.

## Out of scope
- Sibling `/pingfederate/exchange` and `/svid`, `/verify` (separate decision; `/pingfederate/exchange` is the same class of exposure and is worth its own PR).
- Restricting `token_mode` (still all three, the page needs them).
- Any change to token minting, exchange or session code. The only protected area touched is route gating (`REGRESSION_PLAN.md` §1 auth), and it only gets stricter.

## Verification plan
New 401 tests (fail on #3675's code); existing `spiffePrivilegeCallRoute` tests updated to send a session and stay green; `authz:verify`; page opened signed out and signed in in a browser; independent review before merge; owner says go.
