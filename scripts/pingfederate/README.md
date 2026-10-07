# Local PingFederate (operator-run, outside Git)

PF is not part of the demo compose project. Start it from this directory with
two operator-supplied values that must never be committed:

```bash
export PINGFEDERATE_PROFILE_PATH="$HOME/pingfederate-profile"
export PINGFEDERATE_ADMIN_PASSWORD='<your admin password>'
docker compose -f docker-compose.local.yml up -d
```

The admin API (9999) and the runtime (9031) are published on `127.0.0.1` only. Other
containers still reach them through `local.ping-devops.com` (OrbStack forwards traffic to
the host gateway on to the Mac's loopback; checked by probing a loopback-only server from
inside the BFF container). To expose them on the network on purpose, set
`PINGFEDERATE_BIND=0.0.0.0`.

Recreating the container is safe for the configuration: `/opt/out` (the instance, the deployed
plugin JARs, the JDBC client storage setting) and the JVM trust store are named volumes. Check
`ls /opt/out/instance/server/default/deploy` afterwards.

## Rebuild a fresh PF in one command

A fresh PF volume has zero OAuth clients and file-based client storage. After
`up -d` (above), one command recreates everything the demo needs from Git:

```bash
PF_BASE=https://<host>:<admin-port>/pf-admin-api/v1 PINGFEDERATE_CONTAINER_NAME=<container> \
PINGFEDERATE_ADMIN_PASSWORD=... bash scripts/pingfederate/provision-all.sh
```

There is no default target. Both `PF_BASE` and `PINGFEDERATE_CONTAINER_NAME` are required, and only local demo
hosts (`localhost`, `127.0.0.1`, `*.ping-devops.com`, `*.ping.demo`) are accepted. Admin port 9999 or the container
`ai-demo-pingfederate` is the live PF and is refused unless `I_KNOW_THIS_IS_THE_LIVE_PF=yes`. The PF public base URL is
only changed when `PF_BASE_URL` is set. After the storage switch the script proves JDBC at runtime with a throwaway
client (served by the API, absent from the XML store).

It switches client storage to JDBC (and restarts PF), then runs
`provision-core.js` (base URL, signing keys, the three JWT token managers,
`aiDemoStandardTePolicy` and its ATM mappings, the four role clients, the
introspection client) and `provision-a2a-sp-connections.sh`. It is idempotent,
exits 0 only when the admin API lists the expected clients and token managers,
and never prints secrets: client secrets come from `<ROLE>_CLIENT_SECRET` env,
else `PF_SECRETS_FILE` (default `.pf-client-secrets.env`, gitignored), generated
once, for a new client only. If the secrets file is lost, an existing client keeps its old secret (PF never reveals
it): the script warns `secret for client X cannot be recovered` and writes nothing; set it by hand. Re-running warns
on stderr when an existing object's key fields (grants, ATM, policy, issuer/audience) differ from the desired shape;
it never edits it. The PingOne steps additionally need `PF_ALLOW_PINGONE_STEPS=yes`. The dependency order and every optional switch (`PF_USE_VAULT`,
`PF_STEP9`, `PF_AI_AGENT_FEATURES`, `PF_A2A_ENV_FILE`, and the PingOne steps,
skipped unless the `PINGONE_BOOTSTRAP_*` worker and friends are set) are in the
header of `provision-all.sh`. A profile-less volume has no admin user: set
`CREATE_INITIAL_ADMIN_USER=true` on the container (see `docker-compose.fresh.yml`).

Test (starts a separate `pf-fresh` project on ports 19999/19031, tears it down):

```bash
PF_FRESH_PROFILE_PATH=<dir with instance/server/default/conf/pingfederate.lic> \
PINGFEDERATE_ADMIN_PASSWORD=<throwaway> bash scripts/pingfederate/provision-all.test.sh
```

## Recovering the profile (2026-09-26 incident)

The profile directory is a prepared PF classic instance (must contain
`instance/server/default/conf/pingfederate.lic`). If the host profile copy is
lost, rebuild it from the persistent OUT volume — it holds the full
configured instance, license included:

```bash
mkdir -p ~/pingfederate-profile
docker run --rm -v ai-demo-pingfederate-out:/out:ro -v "$HOME/pingfederate-profile":/profile \
  alpine sh -c "cp -a /out/instance /profile/"
```

Then point `PINGFEDERATE_PROFILE_PATH` at `~/pingfederate-profile`.

## Notes

- `PING_IDENTITY_PASSWORD` on an existing OUT volume: the image re-applies the
  admin password on boot, so after a rebuild-from-volume you set a NEW value
  and it takes effect (verified 2026-09-26 — container healthy, engine
  answering on 9031).
- The demo stack (`demo_api_server`, oauth flows) must be able to reach PF on
  `https://localhost:9031` and the compose alias `pingfederate` on the
  `ai-demo_ai-demo` network — this compose file already joins it.
- `npm run demo:health-gate` checks the container is up and healthy and will
  print this recovery path when it is missing.

## oauth-mcp Banking API Step 9

`oauth-mcp` runs a second RFC 8693 exchange for banking data tools. PingOne
subjects continue through PingOne's existing Step 9 client and `resource`
selector. PF subjects use a separate PF policy and ATM mapping; they do not
reuse or modify `aiDemoStandardTePolicy`, which remains the BFF and
PingGateway standard-exchange policy.

The committed PF contract is in
`spiffe/pingfederate/pf-step9-te-policy.json` and
`spiffe/pingfederate/pf-step9-atm-mapping.json`. It requires an access-token
actor, targets `aiDemoPfJwtAtm`, retains the incoming subject's `act`, and
builds a nested actor chain for the PF MCP-service actor. The provisioner adds
`TOKEN_EXCHANGE` to the PF MCP actor client configured in
`demo_api_server/.env`, preserving its `CLIENT_CREDENTIALS` grant, default ATM,
and protected secret.

Preview the local PF changes, then apply and read them back:

```bash
python3 scripts/pingfederate/provision-pf-step9.sh
python3 scripts/pingfederate/provision-pf-step9.sh --apply
```

The script defaults to dry-run. It reads the admin password from the running
PF container unless `PINGFEDERATE_ADMIN_PASSWORD` is supplied, never prints
the password or client secret, and changes only the dedicated Step 9 policy,
its ATM mapping, and the existing MCP actor client.

`demo_api_server/scripts/refresh-service-envs.js` writes PF Step 9 settings
only to `oauth-mcp/.env`, sourcing the actor secret from the vault first and
the existing BFF PF setting as fallback. Restart `oauth-mcp` after refreshing
service environments. The PF request omits `resource` and `audience`; the
dedicated processor-policy mapping selects the Banking API ATM.

## PingOne user gate on the standard exchange

Without this, `aiDemoStandardTePolicy` has no conditions: any PingFederate user
can be acted for, and nothing a user or admin does in the demo can stop it.

The contract is `spiffe/pingfederate/pf-pingone-user-gate.json`. With it applied,
every exchange on an access-token subject looks up the PingOne account that has
the subject's username (REST data store `aiDemoPingOneUsersRest`, authenticated
as the PingOne worker) and is refused unless that account is enabled
(`user_disabled_in_pingone`) and its `mayAct` names the agent acting in that
exchange (`agent_not_authorized_by_user`). The grant rule names no particular
agent: it compares `mayAct` with the actor token's client on the first exchange
and with the subject token's existing `act` afterwards, so a user can grant any
agent that has a PingFederate client. PingOne is therefore the system of record
under both login providers: the BFF's agent grant, revoke and kill switch all
act on the PingOne account, and PingFederate honours the result on the next
exchange.

```bash
python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh            # dry-run
python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh --apply    # apply + read back
npm run pf:user-gate:check                                                # exit 1 on drift
python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh --remove   # take the gate off
```

Things to know:

- A PingFederate user with no PingOne account of the same username is refused.
- The PingOne worker's client secret is stored in PingFederate's config. The
  check cannot compare it; rotate the worker and you must re-run `--apply`.
- The ID-JAG subject mapping is deliberately not gated (see `notGated` in the
  contract): the lookup was proven for access-token subjects only.
- The grant rule is an OGNL expression, so it depends on PingFederate having
  expressions enabled (they are: the token mappings build `act` with one).
  PingFederate hands a subject token's `act` to OGNL as a string (`{}` when
  empty), not a map; calling `.get("sub")` on it throws and refuses everything.
- The lookup variable is `${subjecttoken.Username}`. A bare `${Username}` is an
  unknown key to PingFederate, the lookup throws, and every exchange is refused.
- Each exchange costs one PingOne Management API call, so a tool call makes two.
- Sign-in itself is not gated: a disabled user can still reach the PingFederate
  login page and get a session. What stops is every delegated token.

## PingOne profile in the PingFederate ID token (email, name, phone)

PingFederate's own user (`demouser` in the simple PCV) has no profile, so its ID token carried only `sub` and the
app showed a name with no email or phone. The same people live in the PingOne environment, which is already the
system of record (see the user gate above), so the OIDC policy `aiDemoPfOidcPolicy` now looks the PingOne account up
by username in the same REST data store and releases `email`, `given_name`, `family_name`, `name` and
`phone_number`. A claim PingOne has no value for is simply omitted. The logic is `oidc-profile-claims.js`.

`preferred_username` (the PingFederate username) is released with them, on purpose: the BFF names a user
`preferred_username`, then `email`, then `sub`. Releasing an email alone would store every PingFederate user under
their email address instead of `demouser`.

```bash
# 1. the data store learns the profile attributes (they are in the user-gate contract)
python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh            # dry run
python3 scripts/pingfederate/provision-pf-pingone-user-gate.sh --apply
# 2. the OIDC policy releases them
node scripts/pingfederate/provision-pf-oidc-profile.js                    # dry run
node scripts/pingfederate/provision-pf-oidc-profile.js --apply            # backs the policy up first
node scripts/pingfederate/provision-pf-oidc-profile.js --remove           # the way back
```

Things to know:

- The lookup key is the PingFederate username and PingOne's username filter is case-insensitive, so `demouser`
  finds PingOne's `demoUser`. A PingFederate user with no PingOne account of that username just gets no profile.
- The BFF reads `phone_number` for a PingFederate sign-in (a PingOne sign-in still looks the phone up by id).
- A new sign-in is needed to see the claims; an existing session keeps what it had.
- The OIDC policy is on every PingFederate sign-in's path. `--apply` saves the previous policy to the temp directory
  and `--remove` takes the profile claims off again without touching anything else in the policy.

## Token introspection client

The BFF introspects PingFederate-issued access tokens (the token preview at login,
`/api/introspect`) as a dedicated client, `ai-demo-pf-introspection`. PingFederate only
answers `/as/introspect.oauth2` for a client holding the Access Token Validation grant,
and no login or exchange client has it. One-time, idempotent, dry run by default:

```bash
node scripts/pingfederate/provision-introspection-client.js          # what would change
node scripts/pingfederate/provision-introspection-client.js --apply  # create it + vault entry
```

The secret goes straight into the vault as `PF_INTROSPECTION_CLIENT_SECRET` and is never
printed. A fresh PingFederate volume needs a re-run. Until it exists, PF introspection is
skipped ("not configured"), as before. The client is created through the admin API, so it
lives in the same client store as the others (see the database-storage note below).

## AI Agent RAR processor

The PF AI Agent page includes CIMD, third-party ID-JAG exchange, and a custom
`banking_transaction` RAR flow. PF RAR uses a custom SDK processor; it is not
the existing PingOne PAR/Authorize flow. Build the processor against the PF
installation and deploy it; `provision-ai-agent-features.js` (below) then creates
the processor instance, the authorization detail type and the RAR client. The
processor looks the signed-in user up at the BFF, so no user-attribute mapping
is needed:

```bash
PF_HOME=/path/to/pingfederate scripts/pingfederate/plugins/ai-agent-rar/build.sh
```

See `plugins/ai-agent-rar/README.md` for policy fields, test instructions, and
PF admin-console setup. The processor requires PF 13.1 or newer and the
`transactions:write` scope. It uses only OAuth and JWT.

Deploying the JAR into the local `ai-demo-pingfederate` container:

- **Build as the `ping` user.** `docker cp` creates root-owned files, so run
  `docker exec -u root ai-demo-pingfederate chown -R ping /tmp/rar` before
  `build.sh`, or the build fails creating `build/classes`. The container's JDK is
  in `/opt/java/bin`; the host needs none to deploy.
- **Keep no other copy of the JAR in `deploy/`.** PingFederate loads every file
  containing `.jar`, so a `pf-ai-agent-rar.jar.bak` becomes a second definition of
  the processor (log: "Adapter ... is defined more than once"). Save rollbacks
  outside the container.
- **Restart PingFederate** after copying the JAR, then run the provisioner.

## CIMD and RAR: PingFederate setup

Two things are needed, in this order.

### 1. OAuth clients in database storage (one-time, by hand)

CIMD creates clients on the fly from a metadata URL, and PingFederate only does
that when its OAuth clients are stored in a database. With the default file
storage the admin API still accepts CIMD settings, and discovery keeps saying
`client_id_metadata_document_supported: false` — nothing warns you.

The local PingFederate was switched to its built-in database on 2026-10-02.
That change lives in the container's data volume, not in Git. To do it again:

1. Back up every client through the admin API (`GET /oauth/clients`) and export
   a configuration archive (`GET /configArchive/export`). `encryptedSecret`
   round-trips, so secrets survive the move.
2. In `server/default/conf/service-points.conf` change
   `client.manager=org.sourceid.oauth20.domain.ClientManagerXmlFileImpl` to
   `...ClientManagerJdbcImpl`. **The file has Windows line endings**: a `sed`
   pattern anchored with `$` matches nothing and reports no error. Check the
   line afterwards.
3. `docker restart ai-demo-pingfederate`. It comes up with zero clients —
   PingFederate does not migrate clients between storage types.
4. Re-create each backed-up client with `POST /oauth/clients`.

No SQL is needed: the built-in `PFDefaultDS` already has the client tables and
`config-store/org.sourceid.oauth20.domain.ClientManagerJdbcImpl.xml` already
points at it. Ping's documentation allows the built-in database for trial and
training use only.

Things to know:

- Rollback is the same line reversed plus a restart; the XML client files are
  never deleted.
- **A fresh data volume reverts to file storage.** The mounted profile still has
  `XmlFileImpl`, and the profile is applied only on a first start, not on a
  restart. It is left that way on purpose: database storage on an empty database
  would start with no clients at all.
- A client created after the switch exists only in the database.

### 2. Scope, trust, CIMD policy and the RAR type (scripted)

```bash
node scripts/pingfederate/provision-ai-agent-features.js            # dry run
node scripts/pingfederate/provision-ai-agent-features.js --apply
```

Idempotent; each step reads first and reads its change back. It adds the
`transactions:write` scope, trusts the mkcert root so PingFederate can fetch
the BFF's client metadata document, enables CIMD with one policy restricted to
that exact document URL (PKCE required), and sets up RAR: it creates the
`PF_AI_RAR_LOOKUP_SECRET` vault entry once (never replaced), creates or updates
the processor instance with its User Limits URL and credential, creates the
`banking_transaction` authorization detail type, and registers the public PKCE
client `ai-demo-pf-rar` that is allowed that type. It also registers `ai-demo-pf-rar-dpop`,
the same client with PingFederate 13.1's per-client DPoP setting required, which backs the
page's "bind the access token with DPoP" option (`PF_AI_RAR_DPOP_CLIENT_ID`). The plain client
is unchanged, so the normal RAR run is unaffected.

Check RAR at push time with no login. A well-formed detail is accepted (201); a
malformed one is refused (400 `invalid_authorization_details`):

```bash
curl -sk -X POST https://local.ping-devops.com:9031/as/par.oauth2 \
  -d response_type=code -d client_id=ai-demo-pf-rar \
  --data-urlencode redirect_uri=https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/callback \
  --data-urlencode "scope=openid profile email transactions:write" \
  -d code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM -d code_challenge_method=S256 \
  --data-urlencode 'authorization_details=[{"type":"banking_transaction","user_id":"demouser","actions":["transfer"],"source_account":"a","destination_account":"b","amount":125,"currency":"USD"}]'
```

Change `amount` to `-1` to see the refusal. The user-bound checks (the user's own
accounts and limit) only run after sign-in, so exercise those from the page.
PingFederate's sign-in name can differ in case from the banking user (`demouser`
vs `demoUser`); the BFF's lookup ignores case when the match is unambiguous.

Check the result where it matters, in what PingFederate advertises:

```bash
curl -sk https://local.ping-devops.com:9031/.well-known/openid-configuration \
  | grep -o '"client_id_metadata_document_supported":[a-z]*'
```

The BFF's switches (`PF_AI_CIMD_ENABLED`, `PF_AI_RAR_ENABLED`,
`PF_AI_RAR_CLIENT_ID`, `PF_PAR_ENDPOINT`) are set for the local stack in
`docker-compose.yml`.

## Cross-domain exchange: PingFederate issues an ID-JAG, a third party redeems it

The AI agent page's third path sends the signed-in user's PF access token to
PingFederate's token endpoint (RFC 8693) for an ID-JAG, then redeems that ID-JAG at a
third-party token endpoint with the JWT-bearer grant. The BFF does both hops
server-side. The page requires the audience, the resource and the third-party token
endpoint to be `https`.

```bash
node scripts/pingfederate/provision-cross-domain-exchange.js            # dry run
node scripts/pingfederate/provision-cross-domain-exchange.js --apply
```

Idempotent; each step reads first and reads its change back. It creates the two client
secrets in the vault (`PF_AI_CROSS_DOMAIN_CLIENT_SECRET`, `PF_AI_THIRD_PARTY_CLIENT_SECRET`;
created once, never replaced), the `tp:read` scope, a token exchange processor policy that
takes a PF access token as the subject **with no actor** (the existing
`aiDemoStandardTePolicy` and `aiDemoPfStep9TePolicy` both require one, and this exchange
sends only a subject), an ID-JAG SP connection whose entity ID is the audience, and the
client `ai-demo-pf-xdomain`. The subject token is validated by the existing
`aiDemoPfAccessSubjectProcessor`, so the user must be signed in through PingFederate; a
PingOne session token is not accepted by this policy.

The third party on the local stack is the BFF's own opt-in stand-in,
`POST /api/pf-ai-agent/mock-third-party/token` (`PF_AI_THIRD_PARTY_MOCK_ENABLED=true`, 404
otherwise). It authenticates the client, requires the JWT-bearer grant, the configured scope
and resource, and verifies the ID-JAG (PingFederate's signature, issuer, audience, expiry and
`typ=oauth-id-jag+jwt`). It issues an opaque token. To redeem at a real third-party
authorization server instead, leave the mock off and set `PF_AI_THIRD_PARTY_TOKEN_ENDPOINT`
and the matching client, resource and scope.

The values live in `docker-compose.yml` (`PF_AI_CROSS_DOMAIN_*`, `PF_AI_THIRD_PARTY_*`); keep
the constants at the top of the script in step with them.

## CIBA: a human approves the agent's request on their PingOne MFA device

PingFederate 13.1's CIBA (client-initiated backchannel authentication) lets a client start an
authentication for a named user and poll until that user approves it elsewhere. Here the approval
goes to the user's PingOne MFA device through the installed **PingOne MFA CIBA Authenticator**
(PingFederate calls authenticators "out-of-band auth plugins").

```bash
node scripts/pingfederate/provision-ciba.js            # dry run
node scripts/pingfederate/provision-ciba.js --apply
```

Idempotent; each step reads first and reads its change back, and PingFederate's own validation
messages are printed if it refuses a body. It creates the vault secret `PF_AI_CIBA_CLIENT_SECRET`
(once, never replaced), an authenticator instance `aiDemoPfCibaP1Mfa` that reuses the PingOne
environment and application of the sign-in adapter `aiDemoPfP1Mfa`, a request policy
`aiDemoPfCibaPolicy` that treats the `login_hint` as the user, and the confidential client
`ai-demo-pf-ciba` (CIBA grant, poll delivery, that request policy).

The admin API paths are not the obvious ones: `oauth/cibaServerPolicy/requestPolicies` for the
policy and `oauth/outOfBandAuthPlugins` for the authenticator. The spec is at
`/pf-admin-api/v1/openapi.json`. The client calls `POST /as/bc-auth.ciba` with a `login_hint`
and gets `auth_req_id`, `interval` and `expires_in`, then polls the token endpoint with the CIBA
grant until the user approves, denies, or the request expires.

Things learned live (2026-10-05):

- **PingOne sign-on policy.** The app's own policies start with a password step, which this
  authenticator cannot answer (PingOne replies `PASSWORD_REQUIRED`, PingFederate returns a 500).
  Create a PingOne sign-on policy with only a Multi-Factor Authentication step (here `mfa_only`),
  **assign it to the application** (Policies tab), and name it in the authenticator's
  "PingOne Authentication Policy" field (`P1_POLICY` in `provision-ciba.js`). The name works; the id
  does not. Unassigned, PingOne answers "Invalid sign-on policy provided in acr_values".
- **Binding message:** 1 to 20 characters from `a-zA-Z0-9-._+/!?#`, no spaces
  (`invalid_binding_message` otherwise).
- **The approval needs a mobile app built on the PingOne Mobile SDK**, not the PingID app, with the
  PingOne user paired to it. A user with no device gets `500 User has no usable devices`.

### CIBA web approver (local demo only, off by default)

When no SDK-built app is available, `--web-approver` runs PingFederate's real CIBA flow with a
stand-in authenticator. The plugin `plugins/ai-agent-ciba-approver` registers each request with the
BFF and polls it; a person approves or denies on the AI agent page. It proves PingFederate's flow,
not PingOne MFA.

1. Build the plugin: `PF_HOME=<a PF install or copy of its lib dir> plugins/ai-agent-ciba-approver/build.sh`
   (JDK 17+), and run `plugins/ai-agent-ciba-approver/test.sh`.
2. Copy `build/pf-ai-agent-ciba-approver.jar` into PingFederate's deploy dir
   (`/opt/out/instance/server/default/deploy`) and restart the container. Keep only one JAR of it
   there; a `.bak` copy loads as a duplicate plugin.
3. `node scripts/pingfederate/provision-ciba.js --web-approver --apply` creates the vault secret
   `PF_AI_CIBA_APPROVER_SECRET`, the authenticator `aiDemoPfCibaWebApprover`, the request policy
   `aiDemoPfCibaWebPolicy` and the client `ai-demo-pf-ciba-web` (same client secret as above).
4. Set `PF_AI_CIBA_WEB_APPROVER_ENABLED=true` for the BFF and restart it. The page then shows
   "Approve (web approver)" and "Deny (web approver)" while a request is pending. It overrides the
   mock phone, and it is inert when `NODE_ENV=production`.

## SSO session: sign in once, not on every authorize

With PF's global authentication sessions off, every authorize request (CIMD, RAR, sign-in) re-prompts, and PF logs `no session ID was found in request`. `node scripts/pingfederate/provision-pf-sso-session.js` is a dry run; `--apply` sets `enableSessions: true` on `session/authenticationSessionPolicies/global` **and** adds a session policy (`aiDemoPfSso`) for the `aiDemoPfHtmlForm` adapter. Both are needed: the global switch alone creates no session, because PF only creates one for an authentication source that has a policy. Backup is written to the temp dir and both are read back; `--remove` undoes both. Every client of that adapter now gets SSO, and a logout in the app does not end the PF session.
