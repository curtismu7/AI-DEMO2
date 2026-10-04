# Fresh PingOne environment: gap list (Phase 0 audit)

Audit date 2026-10-04. Target: the new, empty environment that will back the P1-AI-DEMO edition.

- Environment ID: `bd44a806-b6b2-4a42-b461-3a706dc9e33a` (name "clean", type SANDBOX)
- Worker app client ID: `357cb858-59f9-4b9b-ac71-39740963ce2c` (app name "clean-worker")
- Region: **com** (the token endpoint `auth.pingone.com` issued a token; eu, asia, ca and com.au were also tried in order but com answered first and the loop stopped there)

## Status of this audit

| Step | Result |
|---|---|
| Read-only probe (token, roles, inventory, licensed products) | DONE |
| Read bootstrap scripts | DONE (`bootstrapPingOne.js` and `services/pingoneProvisionService.js` read; `setupFresh.js` read at header and spawn points only, not run) |
| Run `pingone:bootstrap` against the new environment | **NOT RUN - blocked.** The auto-mode permission classifier refused the run ("Blind Apply": the script has no dry-run, so the classifier would not approve a mutating run it could not preview). Not worked around. Needs an explicit go-ahead from the user. |
| Super Banking sign-in plus one agent chip | **NOT RUN - needs the shared stack; blocked on go-ahead** (and depends on bootstrap) |
| Which tracked files tie to AI-DEMO2's environment | DONE (counts by area below) |

Because bootstrap did not run, the "what bootstrap created" section below is what the code **would** create, derived from reading the scripts, not an observed result. The new environment was not mutated at all. AI-DEMO2's own environment was not touched: no PingOne call of any kind was made against it.

## Worker role result

The worker obtains a client-credentials token. Role assignments (read via `GET /applications/{id}/roleAssignments`):

- Environment-scoped: Identity Data Admin, DaVinci Admin, PingFederate Administrator, PingOne Privilege Administrator. (The list contains many duplicate assignments of these roles; harmless.)
- Organization-scoped: **Environment Admin** and Organization Admin.

Environment Admin is present (at organization scope), so gateway and connection creation should not be blocked by role. Not exercised yet (no gateway created).

Read access verified with the worker token: applications, resources, populations, users, groups, schemas, sign-on and password policies, device authentication policies, risk policy sets, flow policies, verify policies, gateways, agreements, `billOfMaterials`. Two calls returned 403 with an API-gateway signature error and mean "wrong path", not "no permission" (`/dvFlows`, `/privilegeAgents`); DaVinci flows and Privilege agents are not reachable through the plain environment path.

## Licensed and enabled products (from `billOfMaterials`)

PING_ONE_BASE, PING_ONE_MFA, PING_ONE_VERIFY, PING_ONE_RISK (Protect), PING_ONE_AUTHORIZE, PING_ONE_PAM (Privilege), PING_ONE_DAVINCI, PING_ONE_RECOGNIZE.

So Authorize, Protect, MFA, DaVinci and Privilege are all enabled in this environment. None of the gaps below is "service not enabled". Not present in the bill of materials: no PingOne Credentials product; the demo does not need it for the paths above.

## State of the environment before any provisioning

- Applications (7, all PingOne defaults plus the worker): clean-worker, Getting Started Application, PingOne Admin Console, PingOne Application Portal, PingOne DaVinci Connection, PingOne Privilege, PingOne Self-Service - MyAccount.
- Resources (2): PingOne API, openid.
- Populations (1): Default. Groups: 0. Users: 0. Schemas: User (no custom attributes).
- Sign-on policies 2, password policies 3, device authentication policies 1, risk policy sets 2, flow policies 1, verify policies 1, gateways 0, agreements 0.

## Capability table

SCRIPTED = a script in the repo creates it against a fresh environment. MANUAL = a person must click or import.

| capability | created by script? | script/path or MANUAL | notes |
|---|---|---|---|
| Resource servers (Demo API, Demo MCP Server, MCP Invest, JWT Verifier, MCP Gateway, Agent Gateway, A2A intermediates) | SCRIPTED | `demo_api_server/scripts/bootstrapPingOne.js` via `services/pingoneProvisionService.js`; names in `scope-topology.json` `provisioning.resourceNames` | Non-interactive with `PINGONE_BOOTSTRAP_*` env vars. Idempotent. |
| Scopes (banking, admin, users, p1, mcp:invoke ...) | SCRIPTED | same | derived from `scope-topology.json` |
| Applications (Admin Login, User Login, MCP Server Client, Introspection Worker, Token Exchanger, MCP Gateway, AI Agent Actor, specialist agents, PingOne MCP Server, Claude Code Banking Gateway) | SCRIPTED | same | `appNames` in `scope-topology.json`. Redirect URIs derive from `PUBLIC_APP_URL`; the edition's real host must be set. |
| Scope grants, may_act and is_delegate token claims, password policy | SCRIPTED | same | |
| User schema attributes (bankingPrincipalUserId, isDelegate, mayAct, delegatedTo, agentRestrictions) | SCRIPTED | same | |
| Demo users demoUser, demoAdmin, demoDelegate, group BankDelegates | SCRIPTED | same | Passwords come from `DEMO_PASSWORD` or a default; the script prints them. |
| Vertical groups (Super Sports etc.) | SCRIPTED | `demo_api_server/scripts/provisionVerticalGroups.js` (`npm run pingone:provision-groups`) | Not part of bootstrap. |
| Agent Consent agreement and login | SCRIPTED | `demo_api_server/scripts/ensureAgentConsentAgreement.js` | Not part of bootstrap. |
| Autonomous agent registrations | SCRIPTED (dry-run default) | `demo_api_server/scripts/provisionAutonomousAgents.js` (`--apply`) | Reads configStore; needs bootstrap `.env` first. |
| Workload agent gateway resource | SCRIPTED (dry-run default) | `demo_api_server/scripts/provision-workload-agent-gateway.js` (`--apply`) | Runs inside the BFF container. |
| Writes `.env`, `oauth-mcp/.env.development`, `setup-config.md`, seeds config.db | SCRIPTED | same bootstrap | All gitignored. `setup-config.md` contains secrets by design. |
| TraT token-policy claims (reqctx, purp, azd, rctx) | MANUAL | `demo_api_server/scripts/setupTratClaims.js` only checks the app and prints that the claims must be set in the console; spec `docs/superpowers/specs/2026-05-20-transaction-tokens-trat-design.md` section 7 | The script is a check, not a creator. |
| Authorize decision endpoint and policy (Transactions, MCP first tool) | MANUAL | Snapshot `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`, generated by `snapshots/gen-authorize-snapshot.js`. Console: environment, Authorization, policy editor, kebab menu, Import (steps in `.claude/skills/p1az-import-generator/SKILL.md` step 11) | There is no API path for snapshot import. Authorize is enabled in the new environment. After import, the decision-endpoint IDs must be put into the edition's env. |
| Authorize policy as code (Super Banking Demo - Policy as Code endpoint) | MANUAL prerequisite, then SCRIPTED | `scripts/pac-deploy.sh` with `pac/policies/*.yaml`; needs Java 21, a Ping-supplied pac.jar, and a deployment endpoint created in the console | `pac/README.md` hard-codes AI-DEMO2's endpoint IDs and environment. The endpoint must exist before `pac deploy`. `pac deploy` replaces the whole package. |
| DaVinci flows (Transaction step-up, risk-adaptive login, MCP tool authorization) | MANUAL | Flow JSON `docs/Super_Banking_Transaction_Authorization_DaVinci.json` and `docs/Super_Banking_MCP_Tool_Authorization_DaVinci.json`, import in DaVinci Studio; status in `docs/DAVINCI_ORCHESTRATION_STATUS.md` ("DaVinci console setup - manual, not yet done") | Then create API credentials and set `PINGONE_DAVINCI_*` and `DAVINCI_WEBHOOK_URL`. The `DaVinci Admin` role is held by the worker, and a `PingOne DaVinci Connection` app already exists, so a future import script is feasible; none exists today. The risk-adaptive login flow has no export file at all. |
| Protect (risk policy, predictors) | MANUAL | Skill `.claude/skills/pingone-protect-ai-demo/SKILL.md`; runtime in `demo_api_server/services/pingOneProtectService.js`, `routes/protectAuthentication.js` | Two default risk policy sets already exist in the new environment. No script creates the demo's policy. |
| MFA policy and device enrollment | MANUAL (default exists) | Runtime `demo_api_server/services/mfaService.js` resolves the environment's default device authentication policy when `pingone_mfa_policy_id` is unset; skill `pingone/pingone-mfa/` and `scripts/test-mfa.js` for testing | The new environment already has one device authentication policy. Users enrol on first sign-in. |
| PingOne Privilege (agentic apps, MCP gateway, policy) | MANUAL (Helm for the gateway itself) | `privilege/` docs, skill `privilege-mcpgw-agent-k8s`, `scripts/set-privilege-frontend-oauth.sh`, `privilege/SE1-Privilege-Shared-Demo.md`; "PingOne Privilege" app exists by default | Needs a Kubernetes cluster for the gateway and console steps for Agentic Apps. Out of scope for a first edition run unless the Privilege use cases are required. PAM license is enabled. |
| PingFederate to PingOne gateway connection (type PING_FEDERATE) | SCRIPTED (dry-run default) | `scripts/pingfederate/create-pingone-connection.js` (`--apply`); read-only check `scripts/pingfederate/list-pingone-gateway-roles.js` | Needs a running PingFederate and Environment Admin (held). **PF edition only**; not needed by P1-AI-DEMO. Reads `PINGONE_BOOTSTRAP_*` from the repo-root `.env`. |
| PingFederate PingOne MFA adapter | SCRIPTED (dry-run default) | `scripts/pingfederate/create-pingone-mfa-adapter.js`, inputs from `list-pingone-mfa-inputs.js`, selector via `enable-pf-mfa-step-up.js` | PF edition only. Depends on the connection above. |
| PingFederate PingOne user gate | SCRIPTED (dry-run default) | `scripts/pingfederate/provision-pf-pingone-user-gate.sh` (`--apply`, `--check`) | PF edition only. Contract `spiffe/pingfederate/pf-pingone-user-gate.json`. |
| Hosts, mkcert, edition `PUBLIC_APP_URL` | MANUAL | `CLAUDE.md` Project table | Sign-in only works on `local.ping-devops.com:4000`; the redirect URIs bootstrap registers must match the host actually used. |

Tally of the 22 rows: 14 SCRIPTED, 8 MANUAL (TraT claims, Authorize snapshot, Authorize PaC endpoint, DaVinci, Protect, MFA policy, Privilege, hosts/URL). Three of the SCRIPTED rows are PF-edition only.

## What bootstrap would create (NOT RUN, predicted from the code)

From `scope-topology.json` and `pingoneProvisionService.js`:

- Up to 21 resource servers named in `scope-topology.json` (Demo API, Demo MCP Server, Demo MCP Invest, Demo MCP JWT Verifier, Demo MCP Gateway, Demo Agent Gateway, Demo A2A Intermediate and the specialist A2A intermediates, plus the A2A MCP Gateway; the provisioner may create fewer) with roughly 25 or more scopes.
- Up to 22 applications named in `scope-topology.json`, named `Demo AI App - *` (Admin Login, User Login, MCP Server Client, Introspection Worker, Token Exchanger, MCP Gateway, AI Agent Actor, Fraud Watch, Balance Sweep, nine specialist agents), plus `PingOne MCP Server` and `Claude Code - Banking Gateway`.
- 3 users (demoUser, demoAdmin, demoDelegate), group BankDelegates, 5 custom user-schema attributes, token claims, one password policy, one agreement.
- It also deletes and recreates an application whose type changed; on a fresh environment that path is not taken. The `--recreate-apps` and `--wipe-environment` flags exist and must not be used.

Every call goes to `https://api.pingone.<region>/v1/environments/<envId>` built from the supplied env ID, so the target environment is whatever `PINGONE_BOOTSTRAP_ENV_ID` holds.

## Step 4 status: Super Banking sign-in plus one agent chip

**NOT RUN - needs the shared stack; blocked on go-ahead.** No sign-in or chip result exists. Preconditions and commands for the later run:

1. Bootstrap (needs go-ahead, because the classifier refused an unattended run): from the worktree, with a mode-600 env file outside the repo holding

   ```text
   PINGONE_BOOTSTRAP_ENV_ID=bd44a806-b6b2-4a42-b461-3a706dc9e33a
   PINGONE_BOOTSTRAP_REGION=com
   PINGONE_BOOTSTRAP_CLIENT_ID=357cb858-59f9-4b9b-ac71-39740963ce2c
   PINGONE_BOOTSTRAP_CLIENT_SECRET=<from the secret file, never on a command line>
   PUBLIC_APP_URL=<edition's real app URL>
   ```

   run `node --env-file=<that file> demo_api_server/scripts/bootstrapPingOne.js --non-interactive` (or `npm run pingone:bootstrap` with those variables exported). The worktree needs `node_modules` (the main checkout's, symlinked temporarily). It writes `demo_api_server/.env`, `oauth-mcp/.env.development` and `setup-config.md`, all gitignored.
2. Then `npm run pingone:provision-groups`, `node demo_api_server/scripts/ensureAgentConsentAgreement.js`.
3. Import the Authorize snapshot by hand (row above).
4. Point the shared stack at the new environment (`npm run serve:worktree here` and the generated `.env`), which only the stack's owner may do; pin the generation with `npm run -s stack:generation` before and `--check` after.
5. Sign in as the Super Sports customer on `https://local.ping-devops.com:4000` and send one agent chip. Expect missing-capability failures from steps 3 (Authorize decision endpoint unset) and from MFA enrolment on first sign-in.

## Ties to AI-DEMO2's environment (tracked files)

Method: the AI-DEMO2 environment ID was read from the main checkout's `demo_api_server/.env` only to confirm it differs from the new one (it does) and to run `git grep -l -F` over the tracked tree of this worktree. Paths and counts only; no value is recorded here. Counts below are for the environment ID alone (82 tracked files). The Task 6 gate, which also matches client IDs, counted 121 files; the extra files are client-ID-only hits and fall in the same categories.

| Category (82 files by environment ID) | Count | Recommended handling |
|---|---|---|
| `demo_api_server/tests` and `demo_api_ui/tests` fixtures | 11 | Fix in AI-DEMO2 source: replace with an obvious placeholder UUID. |
| Service `.env.example` / templates (agent_token_service, compliance_agent, demo_agent_service, demo_api_resource_server, demo_api_server, demo_hitl_service, demo_mcp_gateway, demo_mcp_jwt_verifier, demo_mcp_resource_server, demo_mcpgw, jwt-verifier-mcp-server, langchain_agent, librechat, oauth-mcp, ping-gateway, ping-mcpgw, standalone/*) | about 22 | Placeholder via the edition's env: replace with `<your-environment-id>` at export. |
| `demo_api_server` code and `demo_api_ui/src` (enterpriseIdp, setupFresh, configStore, idJagService, UI components, recorded runs) | about 10 | Fix in AI-DEMO2 source: read from env or config, not a literal. Largest risk of a real behavioural tie. |
| `docs/` (incl. `docs/superpowers`, `docs/user-guide`) and `planning/`, `claudSkills/` | about 24 | Drop from the edition manifest (internal planning and session notes). |
| `k8s/` and `k8s/helm` values | 5 | Placeholder via the edition's env at export. |
| `privilege/` docs, postman collections, `ai-demo-whole-stack` | 10 | Drop from the P1 edition manifest (Privilege material is AI-DEMO2 specific); placeholder if kept. |
| `scripts/` (incl. `scripts/pingfederate`), repo root file | 3 | Fix in AI-DEMO2 source (script defaults); repo-root file drop from manifest. |
| `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json` (reported by Task 6) | 1 | Placeholder via the edition's env (the snapshot is imported by hand and carries environment-specific IDs). It did not match the environment-ID grep in this worktree, so the tie is through client or policy IDs. |

Other tied tracked files from Task 6 not in this grep (client-ID hits): `.claude/` handoff notes, `REGRESSION_PLAN.md`, `TECH_DEBT.md`, `docker-compose.yml`, `dev_mcp/banking-dev/src/tools/pingone.ts`, `standalone/mcp-inspector/server/lib/pingone.js`, `scripts/cleanup-pingone-apps.sh`, `scripts/pingone/write-a2a-sot.js`. Handling: drop `.claude/` notes and the two root docs from the manifest; placeholder `docker-compose.yml` via env; fix the code and script literals in AI-DEMO2 source.

Nothing here was changed in this task.

## Concerns

1. Bootstrap was refused by the permission classifier. A decision is needed: grant the go-ahead, or accept that "what bootstrap created" stays predicted.
2. `bootstrapPingOne.js` prints the demo users' passwords to stdout and writes `setup-config.md` with worker and app secrets (gitignored). Redirect output to a file outside the repo when running it.
3. Region is `com`. Bootstrap defaults to `com`, so no override is needed.
4. The worker role assignment list has many duplicates; cosmetic.
