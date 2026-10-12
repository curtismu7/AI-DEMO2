# Bootstrap hosted-access wiring — design

**Status:** draft (Curtis requested 2026-10-12 after a live sign-in hit
`group_not_allowed` on the SE demo; audit of `bootstrapPingOne.js` +
`pingoneProvisionService.js` against the running stack).

## Problem

The hosted-access wall (PR #1191) gates SE sign-ins on PingOne group
membership (`HOSTED_ACCESS_REQUIRED_GROUP_ID` → "Hosted Registration
Complete" `4ceb747c…`). None of that exists in bootstrap:

- The gate's sign-in app (`HOSTED_ACCESS_CLIENT_ID` = `17d8cbac…`) is
  manually registered — bootstrap never creates it.
- The groups it depends on ("Hosted Registration Complete" for approved
  users, `39f52348…` for pending/partial registrations) exist only in the
  console and in hand-added `.env` lines — bootstrap neither creates nor
  references them.
- **No token ever carries a `groups` claim**: the sign-in apps request only
  `openid profile email`, bootstrap's `mapped-claims`/SPEL-claim steps never
  map groups, and `scope-topology.json` has no groups entry. The gate reads
  `claims.groups` (`hostedAccessPolicy.js:131`), so the group check can
  never pass by design — which is why `demoAdmin` needed an allowlist entry
  (observed live 2026-10-12, comment already in
  `hostedAccessPolicy.js:127-130`).
- The invite flow (`POST /send-invite`) and `provisionWizardUser` provision
  users but never put them in an approval group; only the hosted-registration
  **approval** flow does (`hostedRegistrationProvisioningService.approve` →
  `addUserToGroup` via `HOSTED_ACCESS_USER_GROUP_ID`). An admin who invites
  through the new invite form creates a user who still cannot sign in.

Net effect: a fresh `setup:fresh` bootstrap produces an environment where
the hosted wall either locks everyone out or depends on hand-made console
state that no script can reproduce.

## Verified API facts (live, 2026-10-12)

- `POST /environments/{env}/users/{id}/memberOfGroups` with body
  `{ "id": "<groupId>" }` → **201** with the worker token. The worker CAN
  manage demo-tenant group membership. (My earlier "console only" conclusion
  in `docs/runbooks/p1-invite-investigation-2026-10-12.md` was about the
  other tenant, `0428ba4f`, and about the group-centric endpoint
  `/groups/{id}/members`, which 403s — the user-centric endpoint works.
  Caveat: some membership **reads** still 403 for this worker —
  `GET /users/{id}/memberOfGroups` returned `[]` right after the 201 — so
  bootstrap must not treat read-back as its success check; the 201 body is
  the truth.)
- `cmuir@pingone.com` (user `5415b936…`) is now a member of
  `4ceb747c…` (added live during this audit).
- **The hosted-access app already carries the groups claim.** Attribute
  mapping on `17d8cbac…`: `groups = ${user.memberOfGroupIDs}` with
  `idToken: true, userInfo: true` (openid scope). The gate compares
  `claims.groups` to the required group **UUID**, and `memberOfGroupIDs`
  emits UUIDs — direct match. The live `group_not_allowed` Curtis hit was
  simply missing membership at sign-in time (added after). The **User Login**
  app (`83572007…`) has no groups mapping — only the gate's app needs one
  today, but bootstrap should mirror it onto both for consistency.
- PingOne SPEL for group claims: `${user.memberOfGroupIDs}` (UUIDs — what
  the gate wants) or `${user.memberOfGroupNames}` (names). No reserved
  `groups` OIDC scope exists on this tenant; the claim rides `openid`.
  ID-token multivalue limit is 25 — fine for demo groups; userinfo is the
  fallback.

## Design

Bootstrap gains a **hosted-access phase** — one new phase group in
`bootstrapPingOne.js`'s `PHASE_GROUPS` and corresponding steps in
`pingoneProvisionService.js`, reusing existing patterns (`bankDelegates-group`
step for group create, `addTokenClaim` for claims, `pushGrantResultStep` for
grants). Idempotent throughout, same `✅/⚠️/❌` step contract.

### 1. Hosted-access sign-in app (public, PKCE)

Create the hosted-access SPA app the way `user-app`/`admin-app` are created
(PKCE, `token_endpoint_auth_method: NONE`):

- name "Hosted Access Sign-In", type WEB_APP (or NATIVE_APP per what the
  current `17d8cbac` app uses — match its live config during implementation)
- redirect URI: `${PUBLIC_APP_URL}/api/auth/hosted-access/callback`
- grant: `authorization_code` + `refresh_token`
- scopes granted: `openid`, `profile`, `email` (+ whatever the live app has)
- write `HOSTED_ACCESS_CLIENT_ID` (+ auth method `none`) into the generated
  `.env` and echo it into the setup summary

### 2. Groups

Create-if-missing (reuse-on-match by name, like `bankDelegates-group`):

| Group | Env var | Purpose |
|---|---|---|
| "Hosted Registration Complete" | `HOSTED_ACCESS_USER_GROUP_ID` = `HOSTED_ACCESS_REQUIRED_GROUP_ID` | approved users |
| "Hosted Registration Pending" | `HOSTED_ACCESS_PARTIAL_GROUP_ID` | pending registrations |

Bootstrap writes both IDs into `.env`. `HOSTED_ACCESS_REQUIRED_GROUP_ID`
stays an alias of the user group so the gate config needs no separate value.

### 3. The groups claim (load-bearing — spike-resolved)

**Spike result (2026-10-12, live):** the hosted-access app ALREADY has the
correct mapping — `groups = ${user.memberOfGroupIDs}`, idToken + userinfo,
openid scope. The gate compares UUIDs and `memberOfGroupIDs` emits UUIDs.
**Remaining work is bootstrap mirroring only:**

1. Bootstrap's hosted-app creation step adds the same application attribute
   mapping (`name: groups`, `value: ${user.memberOfGroupIDs}`, `idToken:
   true`, `userInfo: true`, no `oidcScopes` restriction — the live mapping
   rides openid), via
   `POST /applications/{appId}/attributes` (idempotent by name check, same
   pattern as `_ensureGroup`).
2. Mirror the same mapping onto the User Login app for consistency.
3. Verification step: after bootstrap, sign in as a group member and decode
   the ID token — `groups` must contain `4ceb747c…`. A configured mapping
   that produces tokens without the claim is a ❌ failure, not a ⚠️.

No SPEL guessing remains: the exact value is `${user.memberOfGroupIDs}`,
copied from the live mapping. The old `addTokenClaim` no-op path is
irrelevant — claims ride application attribute mappings.

### 4. Approval/invite wiring

- `provisionWizardUser` / `POST /send-invite`: after provisioning, add the
  new/reused user to `HOSTED_ACCESS_PARTIAL_GROUP_ID` (pending), mirroring
  what the registration flow already does at partial-approval time.
- `hostedRegistrationService.approve` already moves users pending → complete
  via `addUserToGroup`; no change there beyond confirming it runs on the
  worker credential (it does — same `pingoneManagementService`).

### 5. Allowlist hygiene

The configmap allowlist (`HOSTED_ACCESS_ALLOWED_IDENTIFIERS`) has drifted to
5 entries while `deploy.sh` pins 3. Cleanup, not new behavior:

- deploy.sh's pinned default gains the two stray entries **or** the stray
  entries are removed from the live configmap — decide during
  implementation by checking whether `demoAdmin@api.ping.demo` /
  `demoUser@example.com` are actively used by any vertical/e2e
  (grep first; if used, pin them; if not, remove).
- The gate log line for `group_not_allowed` should include the subject and
  required group (it currently doesn't log denials at all — debugging today
  required kubectl + API calls). Small: add a `logger.warn` in
  `evaluateHostedIdentity`'s `denied()` path.

### 6. Demo-readiness audit hook

`demoReadinessAuditService.js` already probes `/users/{id}/memberOfGroups`.
Add a check: "hosted-access group contains N approved users; gate config
matches `HOSTED_ACCESS_USER_GROUP_ID`" so a future bootstrap-vs-console
drift shows up in the readiness report instead of a locked-out human.

## Out of scope

- The `0428ba4f` (AI Agent/Privilege) tenant — its console-only invite
  limitation is real and documented (worker genuinely has no admin role
  there).
- Changing the gate's logic — only its inputs become reproducible.
- The invite email/registration UX (shipped separately, PRs #1196/#1197).

## Success criteria

1. Fresh `setup:fresh` on a wiped environment ends with: hosted-access app
   exists, both groups exist, claim verified by a decoded-token test, IDs in
   `.env`, and a sign-in by an approved user passes the gate with **no
   allowlist entry**.
2. The invite form's newly invited user can register and (after approval)
   sign in with zero console steps.
3. `group_not_allowed` denials are visible in BFF logs with subject + group.
4. The p1-invite investigation runbook's "console only" note is corrected to
   scope it to the `0428ba4f` tenant only.

## Open items for implementation

- ~~SPEL path~~ resolved: `${user.memberOfGroupIDs}` (read off the live app).
- ~~Reserved `groups` scope~~ resolved: none on this tenant; claim rides openid.
- ~~Live `17d8cbac` config~~ resolved: WEB_APP / AUTHORIZATION_CODE /
  responseTypes CODE / auth method NONE / PKCE S256_REQUIRED / single
  redirect URI `${PUBLIC_APP_URL}/api/auth/hosted-access/callback`.
- Which of the two stray allowlist entries are load-bearing (grep verticals
  + e2e) — implementation-time grep, no live dependency.
- Worker scope-read gap: `GET /applications/{id}/grants` returns scope
  objects with null names for this worker (grant reads work, scope names
  don't resolve). Bootstrap's idempotency checks should match on grant
  resource IDs, not scope names, or handle the null-name shape.
