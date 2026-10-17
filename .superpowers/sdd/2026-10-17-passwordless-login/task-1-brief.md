### Task 1: CIBA-login spike and decision record

**Files:**
- Create: `scripts/spike-ciba-login.mjs`
- Create: `docs/superpowers/specs/2026-10-17-ciba-login-spike-result.md`

**Interfaces:**
- Produces: a written decision, either **R1** (CIBA grant directly on the User Login / Admin Login apps) or **R2** (token exchange of a CIBA token for a login-audience token via the existing token-exchanger client), or **R3** (fall back to the DaVinci login flow). Tasks 3–7 read this decision.

Facts found while planning: User Login (`83572007…`) and Admin Login (`8a711944…`) are `AUTHORIZATION_CODE` (+ `REFRESH_TOKEN`; Admin also `TOKEN_EXCHANGE`) with `CLIENT_SECRET_POST` and PKCE required; the working CIBA apps are `CIBA` grant with `CLIENT_SECRET_BASIC`. A PingOne CIBA request picks its DaVinci flow policy from `acr_values` (a policy ID), or the app's assignment.

- [ ] **Step 1:** Write `scripts/spike-ciba-login.mjs` (read-only by default; `--apply` adds the grant to a **throwaway copy** of the User Login app, never the real one). It tries, in order: (a) create a throwaway confidential app with `CIBA` + `REFRESH_TOKEN`, scopes of the login app, `CLIENT_SECRET_POST`, assign the `CIBA - EMAIL` flow policy; (b) `POST /as/cibaAuthorization` with client-secret-post and `acr_values=<CIBA - EMAIL policy id>`; (c) after approval, inspect the tokens.
- [ ] **Step 2:** Record in the result doc, with evidence: does PingOne accept CIBA with `CLIENT_SECRET_POST`? Does the access token carry the audience/scopes the BFF needs (compare to a normal login token)? Is a refresh token issued? Can the admin role be derived from the claims the callback uses (read how `/callback` derives `authedUser.role` first)? Does `acr_values` select the email vs SMS policy on one app?
- [ ] **Step 3:** If (b) fails on auth method, try R2: CIBA token from the existing CIBA app → RFC 8693 exchange with the token-exchanger client to the login audience. Record the outcome.
- [ ] **Step 4:** Decide R1, R2 or R3 in the result doc, with the cost of each. Delete the throwaway app. Commit the script and doc. **Gate:** the owner reads the decision before Milestone 2 starts; R3 means revising the design first.

---

## Milestone 2 — PingOne

