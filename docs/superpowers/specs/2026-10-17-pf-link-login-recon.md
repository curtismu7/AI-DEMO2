# PingFederate link-login recon (Task 8)

Read-only. Date 2026-10-17. Evidence: PF admin API GETs (local `https://local.ping-devops.com:9999/pf-admin-api/v1`,
SE via `kubectl port-forward svc/pingfederate-admin`), kubectl reads, one `curl` from inside each PF, PingOne
Management API user lookups (ids/emails/phones masked), repo files. Nothing was changed in PF, PingOne or the
cluster. Not verified: any live CIBA token issue through PF (needs the web approver switched on in the BFF, which
would be a config change).

## RECOMMENDATION (one minute)

**Proceed with Tasks 9-11 with these changes to the plan: no new Java plugin and no PF restart.**

1. The deployed web-approver JAR already does what a "bridge" needs. PF calls the BFF `POST .../requests`
   (subject, bindingMessage, transactionId) on initiate and `GET .../requests/:id` on every poll. The BFF can
   start the PingOne email/text CIBA itself when `register` arrives and answer `lookup` from the PingOne poll.
   Plugin unchanged, JAR unchanged, **no PF restart**, on local and on SE (both already have the JAR, the
   authenticator and the `-ciba-web` client).
2. Needed live PF changes are small and additive: one new CIBA login client (CIBA + refresh grants, scopes
   `openid profile email offline_access`) and probably one new OIDC policy plus access-token mapping for CIBA
   (see Q3: the existing mappings read attributes CIBA does not supply). All scriptable the way
   `enable-pf-passwordless.js` is.
3. Gate the PF work behind a first spike (start of Task 9): local PF only, enable the web approver in the local
   BFF, run one CIBA and read the issued tokens. If the id token or `sub` do not come out right, move PF
   link-login to a later phase; the PingOne milestone is unaffected.
4. PF "Sign in with passkey": keep it hidden unless the PF `mfa_only` branch (PR #1483, live on local only) is
   proven to present a passkey. Do not promise it.

Blocking facts to fix in the plan: the BFF web approver is hard-off in production (`NODE_ENV=production` returns
no secret), so the hosted BFF needs a separate, explicitly-enabled "link bridge" gate, not a reuse of that flag.
SE PF has no `mfa_only` branch and no `aiDemoPfIdFirst` adapter yet (local only).

## Q1. Where PF runs, what the app uses, reachability

- Local: Docker container `ai-demo-pingfederate`, image `pingidentity/pingfederate:13.1.3-...`, ports 9031/9999
  bound to 127.0.0.1, network `ai-demo_ai-demo` alias `pingfederate`. `/version` = `13.1.3.0`.
  Compose: `scripts/pingfederate/docker-compose.local.yml`.
- SE: StatefulSet `pingfederate` (1 replica, 9h old) in namespace `ping-devops-curtismuir`, same image digest,
  public engine host `cmuir-pf.ping-devops.com` (ingress), admin ClusterIP only. `k8s/pingfederate/README.md`.
- Which the app uses: local app -> local PF (`.env`: `PF_ISSUER=https://local.ping-devops.com:9031`,
  `PF_USER_CLIENT_ID=ai-demo-pf-user`, `PF_ADMIN_CLIENT_ID=ai-demo-pf-admin`). The SE `ai-demo-pf-user` client has
  `ai-demo.ping-devops.com` redirect URIs, so hosted is wired for SE PF. Whether hosted currently has the
  PingFederate provider toggled on is a runtime (LMDB) value I did not read: unverified.
- PF reaches the BFF:
  - Local: from inside the PF container `https://demo-api-server:3001/api/health` -> 200;
    `.../api/pf-ai-agent/ciba/web-approver/requests/x` -> 404 (route present, feature off). The authenticator is
    configured with Approval URL `https://local.ping-devops.com:4000/api/pf-ai-agent/ciba/web-approver`
    (`local.ping-devops.com` resolves to the host gateway in the container).
  - SE: from `pingfederate-0`, `https://ai-demo.ping-devops.com/api/health` -> 401 (hosted-access wall,
    unauthenticated) and the web-approver route with a Bearer -> 404 (reached the BFF; feature off or credential
    mismatch). The SE authenticator Approval URL is
    `https://ai-demo.ping-devops.com/api/pf-ai-agent/ciba/web-approver`. So the path works over the public URL; the
    wall lets a Bearer through (memory: PR #1235). Re-prove with a real secret in the spike.

## Q2. The OOB plugin

- Build: `scripts/pingfederate/plugins/ai-agent-ciba-approver/build.sh` (needs `PF_HOME`, JDK 17+) ->
  `build/pf-ai-agent-ciba-approver.jar`. Deploy: copy to `/opt/out/instance/server/default/deploy`, **restart the
  container**; keep exactly one copy (a `.bak` loads as a duplicate plugin). `scripts/pingfederate/README.md`
  "CIBA web approver" steps 1-2.
- It is already deployed on both: the local deploy dir lists `pf-ai-agent-ciba-approver.jar` (8710 bytes, Oct 5);
  SE `pingfederate-0` lists it too. Authenticators exist on both: `aiDemoPfCibaWebApprover` and
  `aiDemoPfCibaP1Mfa`. Request policies `aiDemoPfCibaPolicy` (P1 MFA) and `aiDemoPfCibaWebPolicy` (web approver)
  exist on both. PF's default CIBA policy is `aiDemoPfCibaPolicy` (P1 MFA), so a client must name the
  web-approver policy explicitly.
- Inert in production: yes, on the BFF side. `pfAiAgentCibaWebApproverService.js` `approverSecret()` returns `''`
  when `NODE_ENV=production`, so all three routes 404. The JAR itself is not gated; it just calls the URL.
- What the plugin sends/needs (Java source): `initiate` -> `POST {Approval URL}/requests` with JSON
  `{transactionId (uuid), subject, bindingMessage}`; `check` -> `GET {Approval URL}/requests/{transactionId}`
  expecting `{status}` (`ApprovalStatus` maps approved/denied/pending); 404 = FAILURE. Auth: `Authorization: Bearer
  <Approval Credential>` (the PF authenticator field), compared in constant time to `pf_ai_ciba_approver_secret`.
  Timeouts 3s connect / 5s call. It sends **no channel and no user-visible text**, so a bridge keeps channel and
  vertical in a BFF-side map filled when the BFF started the PF CIBA itself (the BFF is the PF CIBA client).
- A true "bridge variant" JAR is not required. If one is wanted later, deploying it means: build with `PF_HOME`,
  `kubectl cp`/volume copy, **restart PF**. Restart effect: PF sign-in (user and admin), ID-JAG UC40, A2A specialist
  exchanges and PF CIBA step-up are down for roughly 1-2 minutes locally and per pod restart on SE; PF config lives
  in the `ai-demo-pingfederate-out-classic` volume (SE: 5Gi PVC), so config survives. Avoid it while another
  session is mid-change on PF.

## Q3. CIBA grant on the login client

- Login clients: `ai-demo-pf-user` (customer) grants `AUTHORIZATION_CODE, REFRESH_TOKEN, TOKEN_EXCHANGE`, auth
  `SECRET`, ATM `aiDemoPfJwtAtm`; `ai-demo-pf-admin` grants `AUTHORIZATION_CODE, REFRESH_TOKEN`, `SECRET`,
  restrictedScopes empty. Neither has CIBA fields set (`cibaDeliveryMode` null).
- Existing CIBA clients: `ai-demo-pf-ciba` and `ai-demo-pf-ciba-web`: grant `CIBA` only, `SECRET`, POLL, interval
  3, **restrictedScopes `["openid"]`**, ATM `aiDemoPfJwtAtm`, no `REFRESH_TOKEN`. So today a PF CIBA token has no
  refresh token, no profile/email and no `offline_access`. They cannot be reused as login clients as-is.
- Recommended (additive, not editing the working login clients): new clients, e.g. `ai-demo-pf-user-ciba` and
  `ai-demo-pf-admin-ciba`, grants `CIBA, REFRESH_TOKEN`, POLL, scopes `openid profile email offline_access` (plus the
  banking scopes the user token uses), request policy = the web-approver policy. Enabling CIBA on `ai-demo-pf-user`
  itself is possible (a PUT adds the grant) but changes the working login client; avoid.
- Tokens: access token manager `aiDemoPfJwtAtm` (JWT). The access-token mapping for the CIBA path falls to the
  `DEFAULT` context: `sub = USER_KEY`, `Username = USER_KEY`, `scope = 'openid'` (fixed), `client_id = ClientId`.
  The auth-code mapping is `IDP_ADAPTER aiDemoPfJwtAtm` with the long scope string. So a CIBA access token as
  configured carries the wrong scope (`openid` only) and whatever `USER_KEY` resolves to: **needs a CIBA-specific
  mapping and a live check**.
- ID token: default OIDC policy `aiDemoPfOidcPolicy` (contract: name, phone_number, preferred_username, given_name,
  family_name, email) fulfils `sub` and `preferred_username` from `TOKEN: Username` and the rest from the PingOne
  users REST data store `p1profile` with filter `username eq "${Username}"`. A CIBA authenticator supplies
  `subject`, not `Username`, so this mapping will probably not resolve for CIBA: expect a second OIDC policy for
  CIBA clients. Unverified; this is the spike's first check.
- `sub`: auth-code PF sign-in gives `sub = Username` = the PF username (`demouser`, `demoadmin`), not a PingOne
  id. A CIBA `sub` depends on the mapping above (USER_KEY by default; with login_hint = PF username it should be
  the same string). The session builder must accept a PF username as subject, exactly as the PF auth-code callback
  does today.
- Does it carry what the session builder needs? Access + id tokens: yes once mapped. Refresh: only if the new
  client has `REFRESH_TOKEN` and scope `offline_access`. Not proven.

## Q4. PF user -> PingOne user mapping

- `demo_api_server/services/pingOneSessionUser.js` `pingOneUserIdFor(req, sessionId)`: for a PingOne session returns
  the id untouched; for a PF session (`oauthProvider === 'pingfederate'`) it uses cached
  `session.user.pingOneUserId` or calls `fetchPingOneUserByUsername(user.username || user.oauthId)` (SCIM
  `username eq "<pf username>"`, `pingOneUserLookupService.js`). No match -> returns `null`, never the PF subject.
  It needs a session, so before login the bridge must call `fetchPingOneUserByUsername` directly.
- PF users are the `aiDemoPfSimplePcv` list: `demouser`, `demoadmin`, `readiness-pingfederate-local`.
- Live lookups (PingOne, masked): `demouser` -> id `1583af47...`, email `cm***@pingone.com`, mobile `972***86`;
  `demoadmin` -> `85abea5b...`, email `de***@api.ping.demo`, mobile `972***12`; `readiness-pingfederate-local` ->
  `3689cfd9...`, email `re***@api.ping.demo`, no mobile. All in population `a7349e04`, enabled. So CIBA by
  email/text for PF `demouser` goes to PingOne user `1583af47` (the account step-up CIBA already uses for PF),
  which is NOT the PingOne demo login account `1aee74ae`. The UI/doc must say which account receives the link.
- PingOne CIBA expects the PingOne user id as `login_hint` (`routes/ciba.js:139-145`), so the bridge resolves
  username -> id first, then initiates on the email or SMS CIBA app (`cibaService.initiateBackchannelAuth`).
- A PF user with no linked PingOne user (or no phone for SMS): lookup returns null/no phone. The BFF must answer the
  PF side with a pending-then-denied that looks the same as a real send (same no-leak rule as the PingOne path).
  PF itself does not validate the CIBA `login_hint` against the PCV: any string reaches the plugin, so the BFF is
  the only gate and must not trust it.

## Q5. Passkey / FIDO2 on PF

- Adapters: `aiDemoPfHtmlForm`, `aiDemoPfIdFirst`, `aiDemoPfP1Mfa`. The PingOne MFA adapter contract includes
  `usernameless.flow.platform` / `usernameless.flow.userid`, so it can drive PingOne's device picker, which offers
  FIDO2/passkey to a user who enrolled one. PingID adapter and PingOne Verify JARs are present but no PingID or
  DaVinci adapter instance exists.
- Local default policy now has the `mfa_only` branch (`aiDemoPfIdFirst` then `aiDemoPfP1Mfa`, PR #1483 applied live
  today). SE default policy does NOT (only Multi_Factor / No Match / Not in Request).
- Answer: PF can offer a passkey only through that `mfa_only` branch and only for a user with a passkey enrolled in
  PingOne; whether the picker shows a passkey is unproven. Default stays: **hide "Sign in with passkey" on PF**
  until that branch is verified live (local first, then re-applied to SE).

## Q6. Admin under PF

- No PF policy/claim decides admin. The BFF decides after login: `routes/oauthUser.js:1031-1040` and
  `services/cibaLoginService.js:234-239` use `resolveEndUserAdminSignals` (`adminSignalResolver.js`): username
  allowlist (`admin_username`), PingOne population id, role claim, role-claim resolver; any one suffices. PF admin
  login uses client `ai-demo-pf-admin` and `establishAdminSession`. PF `sub`/`preferred_username` is `demoadmin`
  (lowercase) while the PingOne account is `demoAdmin`, so the allowlist match depends on case-insensitive
  matching I did not verify.
- A PF CIBA admin login needs: an admin CIBA client or a role marker kept in the BFF's own pending entry (as
  `cibaLoginService` does for PingOne), a positive admin-signal check on the PF claims (the existing guard carries
  over), and the PF username -> PingOne `demoAdmin` (85abea5b) lookup for the link recipient.

## Q7. Risks and rollback

Live PF changes for the recommended path (all additive):

1. CIBA login client(s): `POST /oauth/clients` (new ids). Revert: `DELETE /oauth/clients/<id>`. No effect on
   existing clients.
2. CIBA OIDC policy (new) and an access-token mapping for the new client: new objects only. Revert: delete them.
3. Optionally a separate authenticator instance + request policy so the bridge Approval Credential does not replace
   the one the existing web-approver demo uses. Revert: delete both.

Process: follow `scripts/pingfederate/enable-pf-passwordless.js` (on `origin/feat/pf-passwordless`): dry run by
default, `--apply`, backup JSON to `~/pingfederate-profile-backups/`, read-back after each write, `--revert`. No
restart, and no change to `aiDemoPfAcrSelector`, the default authentication policy, or the existing login clients,
so password/MFA login and the break-glass path are untouched. The highest risk is the BFF, not PF: the bridge routes
accept a shared secret from the network, so they must stay 404 unless an explicit gate is set and compare in
constant time (copy `authorize()` in `pfAiAgentCibaWebApproverService.js`).

Other risks: another session just changed the local default authentication policy (mfa_only); do not script against
it concurrently. SE and local PF have drifted (SE lacks that branch). The hosted wall must keep passing the Bearer.
The approval request lives 120 s; PF `transactionLifetime` is 120 on both policies, matching.

## Owner decisions needed

1. Accept "bridge in the BFF, plugin unchanged, no PF restart" instead of the design's "extend the plugin" (design
   section PingFederate)? This is the recommended change to the plan.
2. Allow a production-enabled bridge gate (separate from `PF_AI_CIBA_WEB_APPROVER_ENABLED`, which stays off in
   production) and a new shared secret on the hosted BFF plus the SE authenticator.
3. Local-only first for PF (spike), SE after? SE needs the extra PF steps (mfa_only branch, new clients) copied from
   local.
4. Is it acceptable that the PF link goes to the PingOne user with the same username (`demouser` -> `1583af47`, a
   different account from the PingOne demo login `1aee74ae`)?
5. Hide the PF passkey button until proven (recommended), or invest in proving the PF `mfa_only` passkey path?
