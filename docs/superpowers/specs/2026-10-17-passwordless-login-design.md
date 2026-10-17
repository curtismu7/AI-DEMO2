# Passwordless sign-in: passkey or approval link (customer + admin, PingOne + PingFederate)

Status: DRAFT for approval. Nothing here is built.

## Intent

Today the customer signs in device-first (SMS code or passkey, no password) and the admin signs in with a
password and then MFA. The demo should show two ways to sign in with **no password at all**, for both customers
and admins, on both identity providers:

1. **Sign in with passkey** (device/passkey, as customers have today).
2. **Sign in with CIBA (email or SMS)**: the user is sent an approval link, checks a match code, approves on any
   device, and the original screen signs them in.

Why: the approval-link flow was just built and verified for transaction step-up (email + text, per-vertical
branding, match code). Reusing it at sign-in tells one passwordless story across step-up and login, and shows
CIBA as an authentication method and not only an MFA step.

## What the user decided

- Sign-in screen: two buttons up front, "Sign in with passkey" and "Sign in with CIBA (email or SMS)".
- Link channel: the user picks email or text. Both are always shown and the app answers identically for unknown
  users (no account-existence leak); it only really sends on a channel the user has. (Decided after review; this
  replaces the earlier "only offer channels the user has".)
- Confirmation: the original screen shows a match code and waits; the user opens the link on any device, checks
  the code and approves; the original screen then signs in (same pattern as CIBA step-up).
- Admin: a link or a passkey alone is enough. No password, no extra factor.
- Customer and admin both get both options.
- Both identity providers are in scope together.
- PingFederate: the link option is delivered through the **app-initiated CIBA** path: the existing PF CIBA
  out-of-band plugin is extended to bridge to the PingOne email/text approval already built, and the app signs
  the user in from the CIBA result. (Chosen over delegating PF sign-in to PingOne.)
- PingOne: **app-initiated CIBA for both providers** (decided after review; this replaces the earlier
  "DaVinci login flow first"). The DaVinci login flow is the fallback only if the first-task spike fails.

## Goals

- A customer and an admin can each sign in on PingOne and on PingFederate without typing a password, by passkey
  or by approving an emailed/texted link.
- The match code, channel choice and per-vertical branding behave exactly as in CIBA step-up.
- A user who has no email or no phone is only offered what works; a failure never dead-ends the sign-in (the
  existing fallback to the ordinary redirect login stays).

## Non-goals

- Removing passwords from the identity providers. Passwords stay available as a hidden break-glass path (an
  admin must still be able to get in if the approval channel is down).
- Changing transaction step-up (it is finished and verified).
- Real money-style security review. This is a demo environment; dropping admin password + MFA is a deliberate
  demo choice and should be called out as such in the UI copy/docs.

## Anti-goals (would make this a failure even if it technically works)

- Breaking the existing customer device-first sign-in, or locking the demo admin out.
- A PF change that cannot be rolled back (live PF edits must be scripted, backed up and reversible).
- A second, different-looking approval experience: the match code and wording must match step-up.

## Current state (from repo scouting + live checks)

- Entry point: `demo_api_ui/src/utils/signInService.js` `openSignIn({role})` opens `PiFlowSignInModal.jsx`
  (pi.flow, redirect-free) when `PINGONE_*_AUTHORIZE_PI_FLOW` is on, else redirects. Hosted SE has it on.
- Customer: modal opens on the device step and passes `passwordless=1`, which makes the BFF request the PingOne
  sign-on policy `mfa_only` via `acr_values` (`routes/oauthUser.js` ~600-604). Admin: modal opens on the
  password step, no acr override. The pi.flow BFF routes are in `oauthUser.js` ~351-370, implemented in
  `services/piFlowDriver.js`, which covers both providers; its passwordless-start step explicitly refuses
  PingFederate (409 `pi_flow_step_unsupported`).
- PingOne login app ("Demo AI App - User Login") has four assigned sign-on policies: `Agent-Consent-Login`
  (password), `Multi_Factor`, `mfa_only`, `AIC_Login`. Which policy the admin app has is not known.
- PingFederate: one IdP policy "Password, plus PingOne MFA for acr_values=Multi_Factor" with adapters
  `aiDemoPfHtmlForm` and `aiDemoPfP1Mfa`. It lives in PF admin, not the repo. PF CIBA exists
  (`scripts/pingfederate/provision-ciba.js`) with two authenticators: PingOne-MFA-backed (needs a mobile-SDK
  app) and a local-only web approver plugin (`scripts/pingfederate/plugins/ai-agent-ciba-approver`, inert in
  production). Neither sends an email/text link.
- The CIBA email/text flows on PingOne exist and are deployed (see `docs/ciba-handoff.md`).
- Known open bug unrelated to this design: a "Sign in with SMS" attempt reportedly ended in a redirect asking
  for a password. Undiagnosed (hosted config has pi.flow on and the AIC toggle off; passwordless SMS succeeded
  at 13:53 and 17:17 UTC). It must be understood before this work changes the sign-in code.

## Design

### Shared: the sign-in modal

Two buttons: "Sign in with passkey" and "Sign in with CIBA (email or SMS)". The link button asks for the
username/email, then offers only the channels the user has (email on file, mobile phone on file), then shows the
match-code waiting screen. The passkey button keeps today's behavior. Admin and customer see the same two
buttons; admin no longer opens on the password step. A small "use a password instead" link stays as the
break-glass path.

### PingOne

The link option signs the user in from a CIBA approval on the **User Login** app (and the Admin app): the BFF
sends a CIBA request for the user, polls, and builds the same session the authorization-code callback builds
today. This requires the CIBA grant on those apps and the existing CIBA flow policies assigned to them (a flow
policy assignment is separate from the sign-on policies, so existing login is not displaced). The passkey button
uses the existing `mfa_only` passwordless path.

### PingFederate

Same BFF endpoints, but the CIBA request goes to PF `bc-auth.ciba`. The PF out-of-band plugin is extended
(or a sibling plugin added) so its `initiate` asks the BFF to start the PingOne email/text approval for that
user and its `check` polls the BFF. PF then issues the CIBA tokens and the BFF builds the session. The passkey
button on PF depends on what PF can offer; see open items.

### Session from CIBA

After approval the BFF must hold a session equivalent to an authorization-code login: user claims, an access
token for the banking APIs, refresh behavior, admin vs customer role. CIBA step-up deliberately avoids this
(`cibaProof` never becomes the banking token). Login needs the opposite, so tokens must come from a CIBA grant
on the **login** app so their audience and scopes match.

## Decision record

PingOne uses the same app-initiated CIBA path as PingFederate. Reasons: one code path, one match-code waiting
screen in the app's own modal, and everything already built (initiate, poll, vertical branding, wording) is
reused. The cost is building a real banking session from the CIBA result; the first-task spike de-risks that.
The DaVinci login flow would hand off to a PingOne-hosted redirect page (pi.flow cannot render DaVinci screens)
and was rejected for that reason.

## Constraints

- PingOne `binding_message` max 8 characters; the first two are the vertical code (already in place).
- The approval request lives 120 s.
- Live PingOne/PF changes are applied via scripts with backups; DaVinci edits save drafts that a person deploys.
- Merge/deploy flow: worktree, PR, owner merges, focused deploy.

## Calls made while writing this (builder: treat as decided unless the owner objects)

- **Order:** milestone 0 is diagnosing the SMS-to-password regression (a blocking prerequisite: the modal is
  not touched until it is understood). Milestone 1 is PingOne (customer + admin). Milestone 2 is PingFederate.
  Both stay in scope; PF is last because it is the riskiest and least reversible.
- **First task is a spike, not a build:** prove that a CIBA grant on the User Login app (and Admin app), with
  the existing CIBA flow policies assigned, returns an id token, a banking-API access token and refresh token
  whose claims can drive the session (including admin vs customer). If the spike fails, the PingOne path falls
  back to the DaVinci login flow and the doc is revised.
- **Admin lockout guard:** policy/app changes are additive only (nothing is removed or reordered). The cutover
  is gated on the demo admin signing in successfully by each new button AND by the password break-glass path
  (the "use a password instead" link and the plain redirect login), checked before and after.
- **PF passkey button:** shown only if PF can actually offer a passkey; otherwise hidden on PF. It does not
  silently defer to PingOne MFA.
- **PF plumbing questions** (where PF runs, whether the plugin can reach the BFF and be deployed, whether PF
  users map to PingOne users for email/phone) are answered in the PF milestone's first step before any live PF
  change; the existing PF-to-PingOne user mapping (`pingOneUserIdFor`) is the starting point.

## Left to the builder

Exact BFF route names, the session-building refactor, modal states and copy, plugin packaging, test plan, and how
the PF passkey button is satisfied.

## Still open (owner)

- The SMS-to-password regression needs a repro (hosted or local, which username, what the screen said). It is
  milestone 0 and blocks any change to the sign-in modal.
