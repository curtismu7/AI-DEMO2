# Passwordless sign-in: design update (2026-10-18) — CIBA as proof of identity, not as the session

Status: DRAFT for approval. Supersedes the "CIBA as the login client" parts of
`2026-10-17-passwordless-login-design.md`. Nothing here is built yet.

## Why the design changed

The original design had a CIBA approval sign the user in: the BFF would use CIBA tokens from the login app as the session. Live
testing on 2026-10-18 showed that does not work on the existing login client:

- Assigning the two CIBA DaVinci flow policies to the User Login app made its DEFAULT sign-in request fail
  (`400 INVALID_REQUEST: The specified policy is not compatible with this authentication request`). It was reverted within
  about 30 seconds; sign-in is back to normal.
- A dedicated CIBA login app would work, but CIBA sessions would then hold tokens from a different client, forcing changes to
  refresh, introspection and token exchange.

The owner proposed a simpler shape, adopted here: **do not use CIBA for the session at all, only as proof of who they are.**

## The new flow (customer first)

1. The sign-in modal asks for a username, then offers two choices:
   - **Passwordless** (device or passkey): exactly today's path (`mfa_only`). Unchanged.
   - **Password + approval link:** the normal pi.flow password step with the NORMAL login client (default policy, password
     only), then an email/text approval link as the second factor.
2. For "password + approval link", when the password step returns a finished flow (`COMPLETED`), the server does NOT complete
   the sign-in. It PARKS the finished flow (the data `completePiFlow` needs) in the user's server session and answers
   "approval required". No session exists in the browser at this point.
3. The user picks email or text. The server starts a CIBA approval for THAT user (known from the password step, so no
   identifier is typed and no decoy logic is needed) using the EXISTING CIBA step-up apps (email app / SMS app, client_secret_basic,
   their DaVinci flows), with the 2-char vertical code + 6-char match code (8 chars) as today.
4. The waiting screen shows the match code with the same wording as step-up. The browser polls the server. On approval whose ID
   token `sub` equals the PingOne user the password step authenticated (through `pingOneUserIdFor` for PingFederate users), the
   server completes the PARKED flow (the existing `completePiFlow` → callback path), which creates the normal session with the
   normal client. Anything else (denied, expired, wrong subject, parked state expired) discards the parked flow and the user starts over.

Result: a normal session from the normal client; CIBA only proves identity. No token, refresh, introspection or exchange changes.

## Goals

- Customers can sign in with password + an emailed/texted approval link, with the same match-code experience as CIBA step-up.
- Passwordless (device/passkey) stays exactly as it is.
- No PingOne or PingFederate configuration change. The existing CIBA apps are reused as they are.

## Non-goals

- Admin: unchanged for now (password + device MFA). Admin gets the new option only after the customer path is proven and after
  a password-only policy for the Admin app has been checked.
- PingFederate: later, through the same server-side step (PF only authenticates the password; the BFF runs CIBA through
  PingOne for the mapped user: PF `demouser` → PingOne `demoUser` 1583af47, as step-up CIBA already does). No PF CIBA client,
  plugin or token mapping is needed.
- Removing the passwordless path or the password break-glass path.

## Anti-goals

- A session that exists before the approval. The browser must have NO authenticated session until both factors are done.
- Parked state that can be reused, hijacked from another browser session, or outlive its time limit.
- Breaking normal customer sign-in. The flag stays OFF until this is proven live; the live check that caught the earlier
  regression (open the customer flow with no credentials, compare the first status before and after) becomes part of rollout.

## Security properties the build must prove with tests

1. Parked flow is bound to the originating browser session, single-use, expires (about 150 s), and is discarded on any failure.
2. The approval's `sub` must equal the user the password step authenticated; a different person's approval never completes it.
3. No session is created, and no cookie set, before approval (assert on the response and session after the password step).
4. Prompt-bombing: a send cap per user (reuse the per-user cap and per-IP limit already built in `cibaLoginService`).
5. Replays: a second poll after success is rejected; a poll from a different session cannot see the parked flow.
6. Equal timing/shape where the existing floors apply (kept from the work already merged).

## What happens to the code already merged (flag off)

- `establishUserSession` / `establishAdminSession` (Tasks 2–3): kept, unused by this design. Harmless refactors with tests.
- `cibaLoginService` + `/api/auth/ciba/login/*` (Task 4, login-app CIBA): REWORKED into a pre-session second-factor service that
  uses the existing CIBA apps and the parked flow; the login-app credentials, decoys for unknown identifiers and the
  admin-signal guard go away (the password step already identified the user). The rate limits, floors, session binding and
  one-shot tombstones are kept.
- The sign-in modal choice screen and `CibaLoginPanel` (Task 5): REWORKED to the new two choices and the password→approval sequence.
- `scripts/pingone/enable-ciba-login.mjs` and Task 6: DROPPED (never merged; it stays on its local branch).
- Flag `ciba_login_enabled`: kept, default OFF.

## Decisions made by the owner

CIBA is proof of identity only, not the session; passwordless stays as it is; customer first; PingFederate and admin later.

## Calls made while writing this (builder: treat as decided unless the owner objects)

- The parked flow lives in the existing server session (`req.session`), as `oauthPiFlow` already does, not in a new store.
- The user for the approval is the password step's authenticated user, resolved to a PingOne user id once and stored with the
  parked flow; the approval's `sub` is compared to that stored id.
- Under the default policy a finished password flow may go through an agreement step before `COMPLETED`; the parked flow is
  created only at `COMPLETED`. If the policy shows another step, the existing `fallback:true` behavior applies.

## Left to the builder

Route names, the parked-state shape, modal states and copy, and the test plan.
