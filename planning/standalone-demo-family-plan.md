# Standalone Demo Family: Plan and Catalog

Date: 2026-10-20 (catalog expanded) · Status: plan agreed; only the ID-JAG kit exists as a standalone repo, the rest is planned; the catalog expansion and the first-release cut are PROPOSED, awaiting the owner's approval · Owner: cmuir

## Goal

Use AI-DEMO2 (31 GB, ~40 services) as the code and skills source for many **small, completely standalone
demos**. Each demo:

- lives in its **own GitHub repo** (`cmuir_pingcorp/<name>-demo`, private; the `cmuir_pingcorp` gh account only)
- has its **own authentication**, picked at setup time: PingOne (P1), PingFederate (PF) or AIC
- has its **own user registration**
- runs with a handful of containers on OrbStack (never Docker Desktop), not the full stack
- is **cheaper and faster**: scoped CI, small images, reused code, reused skills

## Decisions already made

| Decision | Answer |
|---|---|
| First use case | **`~/Development/id-jag-standalone`**, finished first, then used as the template |
| Primary user | **SEs presenting live** |
| Setup path | **One command, run locally** (clone, run `setup`, pick P1/PF/AIC, Docker starts) |
| Pain to remove | Explaining what's happening; customizing for a customer; demos breaking mid-session |
| Scope | **All** demos in the catalog below |
| Phase 0 additions | Presenter mode, talk-track panel, `customer.config`, `doctor`, one-click Reset |
| Distribution of shared code | GitHub **template repo + hash-manifest sync** (as `scripts/sync-to-app.mjs` does today). No npm registry, no `git subtree` |

## Decisions settled 2026-10-20

1. **ID-JAG demo is PF-token-only.** PingFederate issues tokens; P1 or AIC are only the sign-in IdP behind it (ID-JAG and DPoP are PF-only in the Ping stack). The full P1/PF/AIC picker applies to the other demos.
2. **Repo names:** `cmuir_pingcorp/<name>-demo`, private. Testers grouped into suite repos by area, except the MFA tester (own repo).
3. **Source of truth:** once a standalone exists, edit it directly. Shared pieces flow through the base sync. AI-DEMO2 is not where standalones are regenerated from, except the initial extract.
4. **Cedar:** the **Privilege demo uses Cedar for authorization, in its AI Policies tab, using the token from PingFederate.** So Cedar is a policy engine inside the Privilege demo (B3/B5 below), with PF as the token issuer, not a separate positioning exercise. Cedar is built as "lane B" in `standalone-research/cedar.md`: our own AI Policies engine, Cedar evaluated server-side, fed by the PingFederate token, with policy text kept pasteable into the real Privilege console. Lane A (driving the real console) is an optional later extra. The Authorize side-by-side also stays as a possible extra.


## Decisions recorded later on 2026-10-20

Passed in by the owner's workflow task; they answer questions that were open or unwritten.

| Decision | Answer |
|---|---|
| Runner and CI | **Local self-hosted runner per repo.** Node 22 only on pull requests (the kit's PR #37 implements this and is open) |
| Mock sign-in | A **guarded persona picker** (the exact guard rule is not yet written) |
| Issuer sign-in | Must become **pi.flow** (consistent with the no-redirect-logins rule) |
| Project tracking | **No GitHub Project board** |
| Repo creation | A repo is created **when it has a working slice**, not up front |

## Still open

See also "Open questions and owner decisions" below, which merges these with the catalog-expansion decisions.

1. AIC and pi.flow: AIC waits for pi.flow, or a documented redirect exception for AIC only. Default: wait (rule: no redirect logins).
2. Cedar: whether a live Amazon Verified Permissions variant is wanted (default: local open-source engine only).

## Phase 0: Finish ID-JAG standalone and make it the template

Work in a worktree of `id-jag-standalone`. Local `main` is 2 PRs behind origin (#28 inspector-reveal and its follow-up).

| # | Work | Done when |
|---|---|---|
| 0.1 | Pull pending PRs; clean-clone baseline | Fresh clone builds, tests pass, mock mode runs with no network |
| 0.2 | **Phase 3B:** sign-in and self-registration, IdP chosen at setup; admin rights for the Trusted IdPs registry | A new user registers, signs in; an admin approves a trusted IdP |
| 0.3 | Rest of Phase 3: real `pf-pf` setup; adapt `pingfederate/sync-id-jag-trusted-idps.js` | `pf-pf` runs end to end on a fresh PF |
| 0.4 | **Presenter mode** | Fullscreen, larger type, step counter, admin UI hidden; playground runs start to finish |
| 0.5 | **Story engine + vertical packs** | Stories are data (`stories/<id>.json`): goal, obstacle, control, per-step tell/say/why with optional blocked wording, proof. Panel with Allowed/Blocked switch and a vertical picker. **Built** on `feat/story-engine` (757555e): S11 for byo mode; generic, airlines, banking, healthcare, retail packs; 294 web tests. Still to do: a story for each other mode, and `customer.config` choosing the vertical |
| 0.6 | **`customer.config`** | Brand, vertical, IdP, persona; validated; one file re-skins the demo in under 2 minutes |
| 0.7 | **`doctor` command** | Checks tenant, ports, certs, env, backend reachability; names the fix; green on a good setup |
| 0.8 | **One-click Reset** | Clears users, sessions, held states, trusted-IdP registry; result identical to fresh setup |
| 0.9 | **Phase 4:** one `setup` command, CI, secrets handling, README without "Phase" language | One command from clone to running |
| 0.10 | Forbidden-string gate | grep for AI-DEMO2 environment IDs, client IDs and secrets returns nothing |

Verification: clean clone, full run in each mode, deliberate-failure tests for `doctor` and Reset.

## Phase 1: Extract `demo-kit-base`

A GitHub template repo plus `sync-to-base.mjs [--check]` (hash manifest, CI-enforced). Contents:

- setup wizard and P1/PF/AIC picker
- auth, registration, admin group
- presenter mode, talk-track panel, `customer.config`, `doctor`, Reset
- app shell, Ping brand (Montserrat, official 2026 logo, Ping Red), ReactFlow diagram components (movable boxes, Simulate, Reset, speed control), Learn plumbing, token decode and redaction
- Docker, CI, hygiene gates (forbidden-string, no-secrets)
- **Mock mode** and **preflight checks** as base requirements for every demo
- A **`mock-authorize` profile** (`--profile mock-authorize`) that returns PingOne Authorize decision and sideband shapes from editable rules, built from AI-DEMO2's `demo_authz_server` (`demo_authz_server/routes/decision.js`, `demo_authz_server/routes/sideband.js`, `demo_authz_server/routes/rules.js`, `demo_authz_server/ruleStore.js`; parity test `demo_authz_server/decision.mockCloudParity.test.js`). This is base work, not a catalog item (retired id G4)

ID-JAG is rebased onto the template as proof.

## Base requirements for every demo

Every demo repo must ship all of these:

1. Mock mode (the safe fallback when a tenant or network fails live)
2. Preflight check before each live step (names the fix; sends nothing while failing)
3. `doctor`, Reset, presenter mode, talk track, `customer.config`
4. Decoded tokens and redacted requests (raw tokens never reach the browser)
5. A ReactFlow diagram per flow (never mermaid) with movable boxes, Simulate, Reset, speed control
6. A Learn pack (glossary, sources) in the Learning Hub content-pack format
7. Own short `CLAUDE.md` and only the skills it needs
8. Its own CI scoped to its own tests
9. The diagram, demo and Learning Hub entry stay a synced trio
10. Ships the **story engine** and **vertical packs**: every story is data with `{{cast}}`/`{{vocab.*}}` tokens, and a test fails if any token is undefined in any shipped vertical
11. Draws its flow diagrams from the shared **diagram data** (E3), never hand-drawn per demo
12. Offers **seeded demo users and groups** next to live IdP login (P1/PF/AIC picked at setup), so every demo runs offline in mock mode with fixed users and runs live with real ones; the header shows which mode is active
13. Emits the shared **trace envelope** (F2) for every hop and renders the built-in trace timeline (F3); optional `--profile otel` for the OTel and Grafana view (F4)
14. Any demo that depends on PingOne Authorize can run its decisions against the base **`mock-authorize` profile** when no tenant is available

## Catalog: standalone apps we can build

Legend. **Seed** = existing code in AI-DEMO2 or a sibling folder. ✅ = substantial code exists, 🟡 = partial, ❌ = nothing yet.
**Kind**: **Demo** = a story for customers. **Tester** = a small utility an SE uses to prove or debug one thing. Rows added on 2026-10-20 also use **Tool** (SE-facing utility), **Skin** (theme pack) and, in group G, a live-tenant-only marker.

A row's "What it shows" may carry an **Overlaps** note naming catalog ids it shares ground with; that is a cross-reference, not a merge. Rows added 2026-10-20 keep their survey ids, so ids are not contiguous: retired and backlog ids are listed below and are never reused. Seed markers on new rows follow the independent checker's downgrade list; paths are relative to `/Users/cmuir/Development/AI-DEMO2` unless a full path is given, and the checkout may be behind origin.

**Catalog counts** (computed from the id ranges in the tables; commands in the commit report): **134 active items** = 96 original ids (A1 to A23, B1 to B11, C1 to C19, D1 to D26, E1 to E7, F1 to F10) plus 38 added on 2026-10-20. The 134 by whole group, which is not the added breakdown: A 25, B 13, C 25, D 40, E 9, F 10, G 8, H 4. The 38 added, by group: A 2 (A25, A26), B 2 (B13, B14), C 6 (C20 to C25), D 14 (D29 to D53, as listed), E 2 (E10, E11), G 8, H 4. Plus **12 in the Backlog** and **10 retired ids** (folded into other rows). The id-bearing survey rows are 60 = 38 active + 12 backlog + 10 retired. An earlier draft said 94 original, 41 added and 62 survey rows; those did not reproduce from the ids and are replaced.

### A. Identity and authentication: Ping products

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| A1 | **MFA tester** | Tester | Enroll and test every PingOne MFA method (SMS, email, TOTP, FIDO2/passkey, push), policy by policy, with the policy decision visible | ✅ MFA pi.flow work, mock phone |
| A2 | **Passkey / FIDO2 tester** | Tester | Register and authenticate a passkey; shows the WebAuthn request and attestation | 🟡 `fido2-fix` |
| A3 | **Passwordless sign-in** | Demo | Passkey, OTP, magic link, CIBA approval as sign-in | ✅ passwordless CIBA work |
| A4 | **CIBA lab** | Tester | Decoupled approval on a phone; binding-message limits (8 chars on PingOne), error cases | ✅ CIBA on PingOne+DaVinci, consent mock phone |
| A5 | **Step-up auth** | Demo | Policy-driven step-up on a sensitive action | ✅ |
| A6 | **PingOne Protect / Risk** | Demo | Risk score changes the experience: allow, step-up, block; signal simulator | 🟡 Protect policies |
| A7 | **Risk signal simulator** | Tester | Fire fake risky signals (new device, impossible travel, bot) and see the evaluation | 🟡 |
| A8 | **PingOne Recognize** | Demo | Authentication by recognition | 🟡 service stubbed |
| A9 | **PingOne Verify / Credentials** | Demo | ID verification, issue and present a verifiable credential | ❌ |
| A10 | **DaVinci flow runner** | Demo/Tester | Run a DaVinci flow through pi.flow with the flow state visible | ✅ DaVinci kit, `pingone-sample-apps` skill |
| A11 | **pi.flow native sign-in kit** | Demo | Embedded sign-in with no redirect; the architecture explained | ✅ |
| A12 | **User registration and self-service** | Demo | Registration, verification, profile, password reset | ✅ `user-registration` samples |
| A13 | **Population / group / attribute explorer** | Tester | Users, groups, populations and the claims they produce | ✅ vertical groups |
| A14 | **AIC journeys** | Demo | Advanced Identity Cloud journeys, with PingOne behind it | ✅ AIC external IdP work |
| A15 | **PingFederate token factory** | Demo | Access-token managers, mappings, exchange policies, token translation | ✅ much already in the ID-JAG kit |
| A16 | **PingFederate SAML SP/IdP lab** | Demo/Tester | SAML SSO, SLO, assertion inspection | 🟡 SAML playground |
| A17 | **PingDirectory / consent and attribute access** | Demo | Attribute-level access and consent | ❌ |
| A18 | **PingAccess rules lab** | Demo | Policy-based web and API access | ❌ |
| A19 | **PingGateway route lab** | Demo/Tester | Route conditions, WWW-Authenticate shape, introspection | ✅ `ping-gateway` |
| A20 | **Social / external IdP login** | Demo | Bring an external IdP into PingOne or PF | ✅ AIC and external-IdP work |
| A21 | **Branding / theming** | Demo | Per-customer login and app branding | ✅ THEMING.md, PF login theme |
| A22 | **Session, SSO and logout tester** | Tester | Front-channel and back-channel logout, id_token_hint, session lifetime | ✅ auth recovery logout fix |
| A23 | **Email / SMS delivery tester** | Tester | Whether OTP and notification messages actually arrive | ❌ |
| A25 | **PingFederate + PingOne MFA wiring kit** | Demo | Customers on PingFederate add PingOne MFA (OTP, FIDO2, passwordless, step-up) without replacing PF: wire connection, adapter and policy, then run each flow. Overlaps A15 (PF token factory) and A1 (MFA tester): shares the PF setup scripts with A15 and reuses A1 for the MFA methods | 🟡 `scripts/pingfederate/create-pingone-mfa-adapter.js`, `create-pingone-connection.js`, `enable-pf-mfa-step-up.js`, `enable-pf-passwordless.js`, `scripts/test-mfa.js`, `docs/MFA_TEST_PLAN.md`, `docs/PINGFEDERATE_MFA_STATUS.md` (scripts and docs, no standalone app). Live-only for the wiring step (needs PF plus PingOne MFA); the exemption is listed under group G. Mock path to be built, not existing: A1's mock phone plus seeded users for the MFA methods |
| A26 | **PingFederate + DaVinci integration kit** | Demo | A PF authentication policy runs a DaVinci flow while PF stays in control of the session. Overlaps A10 (DaVinci flow runner) and A15 | 🟡 `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`, `demo_api_server/routes/pfDavinciAuth.js`, `docs/use-cases/pingfederate-davinci-integration-kit.md` (kit page, no standalone app). Live-only for the wiring step (needs PF plus DaVinci); exemption listed under group G. Mock path to be built, not existing: a canned DaVinci flow state |

### B. Authorization and policy

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| B1 | **PingOne Authorize (P1AZ)** | Demo | Fine-grained decisions with an explainer ("why was I denied") | ✅ group-policy board, p1az predictor |
| B2 | **Authorize policy playground** | Tester | Edit a policy, pick a request, see the decision and the deciding rule. Folded in from retired B12: type rules in plain words and get an importable PingOne Authorize snapshot (import stays a manual console step; there is no API to import or evaluate a P1AZ policy, so the loop is edit, import, publish, replay) | 🟡 `se-skills-export/p1az-import-generator/SKILL.md` + `reference/example-import.snapshot.json`, `se-skills-export/pingone-authorize-ea-api-build/scripts/walk_policy_tree.py`, `docs/P1AZ_TOKENACTIVE_RULE_SETUP.md` |
| B3 | **Cedar demo** | Demo | Cedar vs PingOne Authorize on the same request, side by side | ❌ |
| B4 | **Cedar policy playground** | Tester | Edit Cedar policy locally (open-source engine), see permit/forbid | ❌ |
| B5 | **Cedar for agent tool calls** | Demo | Permit and forbid rules on MCP tool calls; forbid overrides permit; default deny | ❌ |
| B6 | **Amazon Verified Permissions variant** | Demo | Same, against live AVP (only if confirmed) | ❌ |
| B7 | **Group Policy** | Standalone | Decided 2026-10-20: its own standalone repo. Group membership drives a PingOne Authorize decision: add or remove a user from a group and the same request flips between permit and deny, with the deciding rule shown. Four parts: (1) group-driven decisions with the statement code that answered; (2) a rule per industry vertical, using the vertical packs; (3) group-to-tool mapping for agents (allow / hold for approval / deny per MCP tool), which is the mapping still owed from the Privilege steps; (4) how group changes reach the token (`groups` claim) and why a stale token still shows the old group. Engine: PingOne Authorize, with mock mode for offline. Users: **seeded demo users and live IdP login (P1/PF/AIC at setup)**, an admin edits membership in the demo. Folded in from retired B12: an offline deny predictor that says which P1AZ deny rules would fire; offline decisions come from the base `mock-authorize` profile | ✅ AI-DEMO2 `/group-policy` board (UC9A, PRs #1212 and #1215: one decision per load via `?verticalId=`, two subjects on the page), group/vertical policy board, p1az predictor (`scripts/predict-p1az-denies.mjs`) |
| B8 | **Policy-as-code drift checker** | Tester | PAC policy drift against the tenant | ✅ `check-pac-policy-drift` |
| B9 | **Consent and delegation** | Demo | Act-only consent, `may_act` | ✅ act-only consent |
| B10 | **AuthZEN PDP tester** | Tester | Send one standard Access Evaluation request (subject, action, resource, context) to Cedar, PingOne Authorize and an OPA-style PDP and compare decisions; fetch `/.well-known/authzen-configuration`. Standards-lab flavour: whether PingOne Authorize exposes an AuthZEN endpoint is UNVERIFIED, so P1AZ may need an adapter. AuthZEN status: verify before customer use. Pairs with B3/B4 (Cedar) | 🟡 `docs/education-panels.md` (AuthZenPanel section), `docs/PINGONE_AUTHORIZE_PLAN.md`, `docs/pingauthorize-policy-parity.md` |
| B11 | **API access management side-band (PingGateway + P1 Authorize)** | Demo | An API owner gets permit/deny decisions without touching the API: PingGateway asks PingOne Authorize side-band using age and region headers, proxies to a content API, decision shown per request. 3 containers (gateway, api, page). Overlaps A19 (PingGateway route lab) and B1 | ✅ `/Users/cmuir/Development/content-api-aam-demo/` (README.md, `content-api-aam-demo/policy/restrictions.yaml`, ping-gateway, content-api, demo-page; jest tests). Live needs an AAM gateway credential (console setup half done per its docs); mock = local evaluator of the YAML rules. Also `se-skills-export/pingauthorize-aam-ai-demo/SKILL.md`, `docs/p1az-vs-gateway-token-checks.md` |
| B13 | **Intent-bound transactions (PAR + RAR + intent token)** | Demo | A user authorizes "transfer up to X to payee Y" via a pushed request; the agent tries more or a different payee and is denied at the gateway; tampered or expired intent tokens are caught. Merges the money-movement demo, the tamper tester and the TraT/intent-binding demo. Overlaps C7/C8 (PAR, RAR testers) and C22 | 🟡 `demo_api_server/services/intentTokenService.js`, `demo_mcp_gateway/src/rarEnforce.ts`, `demo_mcp_gateway/src/intentTokenValidator.ts`, `demo_authz_server/decision.intentTamper.test.js`, `decision.confused-deputy.test.js`, `demo_api_ui/src/pages/IntentInspectorPage.jsx`, `demo_api_server/routes/intentBinding.js`, `docs/INTENT_AUTHORIZATION_GUIDE.md`. UC15 (intent-token tampering) is `needs-build` per the usecases survey. Real PAR/RAR needs live P1 or PF; RAR support on PingOne UNVERIFIED |
| B14 | **Multi-party (caregiver) delegation** | Demo | A consumer authorizes a caregiver and the caregiver's agent within purpose, scope and expiry; low-risk reads pass, treatment changes are denied or approval-gated. Different from B9: a third-party delegate. Healthcare flavour of the vertical packs (E5) | 🟡 `demo_api_ui/src/pages/StandaloneDemoLauncherPage.jsx` (scenarios), `demo_api_ui/src/learning/lessonCatalog.js`, `demo_mcp_resource_server/seed/healthcare.seed.json` |

### C. Tokens and protocols (teaching tools)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| C1 | **ID-JAG** | Demo | Identity Assertion JWT Authorization Grant: issue, check, redeem, call. Planned modes, not built: **enterprise-managed MCP access** (IT pre-approves MCP servers, one-console revocation; from retired D28, PF needed) and the **SAML-to-ID-JAG bridge** (`scripts/pingfederate/configure-saml-idjag.js`, `outside-agent.js`) | ✅ `id-jag-standalone` (Phase 0) |
| C2 | **Token-flow workbench** | Demo | PAR, RAR, DPoP, mTLS, JAR, PKCE side by side with pass/fail | 🟡 `par` skill |
| C3 | **Token decoder / inspector** | Tester | Decode and validate any token type (ID, access, ID-JAG, SAML) | ✅ ID-JAG Inspector |
| C4 | **OIDC discovery checker** | Tester | Fetch and sanity-check `.well-known` metadata and JWKS | 🟡 |
| C5 | **JWKS / key-rotation tester** | Tester | Kid handling, rotation, missing-kid failure modes | ✅ PF missing-kid findings |
| C6 | **Token exchange / OBO** | Demo | RFC 8693 delegation with `act` and `may_act` | ✅ OBO demo and runbook |
| C7 | **PAR tester** | Tester | Pushed Authorization Request flow against a tenant | ✅ `par` skill |
| C8 | **RAR tester** | Tester | Rich Authorization Requests (`authorization_details`) | 🟡 |
| C9 | **DPoP tester** | Tester | Sender-constrained tokens (PF only in the Ping stack) | 🟡 |
| C10 | **mTLS tester** | Tester | Certificate-bound tokens | ❌ |
| C11 | **Device authorization grant tester** | Tester | RFC 8628 flow | ❌ |
| C12 | **Introspection and revocation tester** | Tester | RFC 7662, RFC 7009; revoke and prove it | ✅ step 6 of ID-JAG |
| C13 | **Client-authentication matrix** | Tester | secret, `private_key_jwt`, mTLS per client | 🟡 |
| C14 | **SCIM tester** | Tester | Provisioning calls and responses | ❌ |
| C15 | **CORS / redirect-URI tester** | Tester | Why a redirect or origin is rejected | ❌ |
| C16 | **Webhook / event viewer** | Tester | Receive and show PingOne notifications and audit events | ❌ |
| C17 | **PingOne API explorer** | Tester | Management API with the MCP-first rule | 🟡 `pingone-mcp` skill |
| C18 | **SPIFFE / workload identity** | Demo | Agent or service identity with no secrets | ✅ `spiffe` |
| C19 | **JWT claim mapping lab** | Tester | SpEL and attribute-mapping recipes (e.g. the act-object recipe) | ✅ OBO recipe |
| C20 | **OAuth profile checker (RFC 9700 BCP + FAPI 2.0 pack)** | Tester | Point at any authorization server and get pass/fail on: exact redirect-URI match, PKCE required and downgrade rejected, ROPC/implicit off, single-use code, `iss` response param, S256 only, metadata published. A second rule pack scores FAPI 2.0 (PAR, S256, sender-constrained tokens, no implicit). FAPI 2.0 status and whether PF/P1/AIC meet it: verify before customer use (UNVERIFIED). Overlaps C4 (OIDC discovery checker) and D35 (MCP conformance): same scorecard engine, different rule packs | 🟡 `/Users/cmuir/Development/oauthplayground/src/flows2/flows/oidcDiscovery.flow.tsx`, `/Users/cmuir/Development/oauthplayground/src/flows2/flows/par.flow.tsx`, `/Users/cmuir/Development/oauthplayground/src/pages/PARvsRAR.tsx`, `docs/RFC-STANDARDS.md`, `standalone/mcp-scanner` (pattern for a scanner CLI) |
| C21 | **Step-up challenge tester (RFC 9470 + MCP insufficient_scope)** | Tester | An API answers 401 `insufficient_user_authentication` (acr_values, max_age) or 403 `insufficient_scope`; the client re-runs authorization; the new token carries the acr/auth_time or the unioned scopes. Tests the protocol shape against any AS. Which acr PingOne issues is UNVERIFIED. Overlaps A5 (step-up demo) and C23 (the insufficient_scope branch) | ✅ UI: `demo_api_ui/src/utils/wwwAuthenticate.js` (+ test; flag `ff_rfc9470_challenge`). The flag also appears in `demo_api_server/routes/featureFlags.js`, `demo_api_server/services/configStore.js` and `demo_api_server/tests/services/transactionAuthorizationService.rfc9470.test.js`, so server-side use exists (how far it is wired: UNVERIFIED). `docs/MFA_TEST_PLAN.md` |
| C22 | **Stolen-token lab (bearer vs DPoP / mTLS at the gateway)** | Demo | An attacker replays a captured agent token; audience binding and key binding (DPoP `cnf.jkt` + proof with htm/htu/ath/nonce, or mTLS) make it unusable; an over-broad `authorization_details` request is clipped. DPoP is PingFederate-only in the Ping stack (plan decision); mock-able otherwise. **Overlaps C9 (DPoP tester), C2 and D33: candidate merge into C9, owner decision 3 below.** Kept as its own row because it is an attack story at an MCP gateway | 🟡 `demo_mcp_gateway/src/dpopVerify.ts`, `mtls.ts`, `rarEnforce.ts`, `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, `demo_api_server/services/dpopKeyService.js`, `/Users/cmuir/Development/oauthplayground/src/flows2/flows/dpop.flow.tsx` |
| C23 | **Wrong-token rejection tester** | Tester | "What happens when my agent sends the wrong token?" Sends wrong-scope, wrong-audience, expired and user-vs-agent tokens (plus RFC 8707 passthrough) to an MCP resource server and shows each educational error. Overlaps C21 (insufficient_scope branch) and D33 (wrong scope, bad client): C23 owns token-shape errors, D33 owns multi-step attacks, C21 owns the step-up challenge | ✅ `demo_api_ui/src/components/TokenSecurityTester.jsx`, `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js`, `AIAgent.wrongScope.test.js`, `demo_mcp_gateway/src/tokenValidator.ts`, `docs/RFC8707_RESOURCE_INDICATORS.md` |
| C24 | **JWT and SAML bearer grant tester (RFC 7523 / 7522)** | Tester | Send a SAML or JWT bearer assertion to a token endpoint and read the result; the legacy-SSO-to-API story. PF-side is own knowledge. The "SAML to ID-JAG bridge" is a mode of C1, not this item | 🟡 `/Users/cmuir/Development/oauthplayground/src/flows2/flows/samlBearerAssertion.flow.tsx`, `/Users/cmuir/Development/oauthplayground/src/pages/flows/JWTBearerFlow.tsx`, `scripts/pingfederate/configure-saml-idjag.js` |
| C25 | **Transaction Token (txn-token) lab** | Demo | An external request enters; a token service exchanges (RFC 8693 profile, `requested_token_type` txn_token) for a short-lived token carrying subject, transaction id, scope and context; downstream services see immutable context. Pitched as "the internal-hop token under OBO". No Ping product issuing txn-tokens was found (UNVERIFIED). **Standards lab: verify before customer use.** The repo's own summary doc cites an older draft (-09 per a critic's read) while a survey fetch reported a newer one (-11) with renamed claims; neither is verified here, so the repo docs need a diff against the current draft before any customer sees this | 🟡 `docs/TRANSACTION-TOKEN-RFC-SUMMARY.md`, `docs/TX-AT-TOKEN-MODEL.md`, `docs/IETF-AGENT-AUTH-DRAFTS-2026.md`, `demo_api_server/scripts/setupTratClaims.js`, `docs/superpowers/specs/2026-05-20-transaction-tokens-trat-design.md` |

### D. Agents, MCP and AI security

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| D1 | **PingOne Privilege (AI gateway)** | Demo | MCP allow/deny, agent keys, rug-pull defense | ✅ `Privilege-standalone`, `privilege/` |
| D2 | **MCP auth lab** | Demo/Tester | RFC 9728 metadata, DCR/CIMD, what ChatGPT and Claude require. Planned **CIMD mode** (from retired D36): generate a client-ID metadata document, fetch by URL, validate (https path, no redirects, client_id match, no secrets, SSRF block of RFC 6890 ranges), show why a gateway refuses it, then register a partner agent by publishing it. Overlaps D35 | ✅ ChatGPT login work, mcpgw wildcard metadata; CIMD mode seeds (🟡): `demo_api_ui/src/components/CimdSimPanel.js`, `demo_api_ui/src/components/cimdPrivilege/`, `demo_api_server/services/personalAgentCimdService.js`, `demo_api_server/routes/cimdAgentMetadata.js`, `docs/2026-10-07-cimd-privilege-client-documents.md` |
| D3 | **MCP inspector** | Tester | Connect to an MCP server and inspect tools and auth | ✅ `standalone/mcp-inspector` |
| D4 | **MCP scanner** | Tester | Scan an MCP server for risky tools | ✅ `standalone/mcp-scanner` |
| D5 | **MCP toolkit / discovery agent** | Tester | Discover and enumerate servers | ✅ `standalone/mcp-toolkit`, `mcp-discovery-agent` |
| D6 | **Hostile MCP / rug-pull** | Demo | Ungoverned vs governed side by side. Overlaps D33, D42 | ✅ `standalone/hostile-mcp-server` |
| D7 | **Hostile A2A agent** | Demo | Malicious agent card and tasks | ✅ `standalone/hostile-a2a-agent` |
| D8 | **Prompt-injection side by side** | Demo | Same attack against ungoverned and governed agent | 🟡 |
| D9 | **A2A** | Demo | Agent-to-agent with delegated auth | ✅ A2A page and workbench |
| D10 | **A2A agent-card validator** | Tester | Validate cards, scopes, auth schemes | 🟡 |
| D11 | **Agent Registry / onboarding** | Demo | Register, scope, rotate, retire an agent | ✅ privilege agent-key facts |
| D12 | **AI Guard** | Demo | Guardrails and prompt-guard decisions | ✅ `demo_mcp_promptguard` |
| D13 | **Caught errors** | Demo | Every denial and block, explained. Overlaps D33 (the gallery launches the attacks that D13 explains) | 🟡 |
| D14 | **Kill switch / runaway agent** | Demo | Rate and cost caps, revoke and watch it stop | ✅ killswitch plan |
| D15 | **HITL approvals** | Demo | Hold, approve, retry. Planned **receipt-binding mode** (from retired D40): a sensitive call gets 401 with a WWW-Authenticate challenge and transaction id, the agent retries with a receipt bound to caller, agent, tool and arguments, and replaying a $10 approval for $5000 is refused | ✅ OpenSearch HITL demo, `demo_hitl_service`; receipt mode seeds (🟡): `demo_hitl_service/src/receiptVerification.js`, `demo_hitl_service/tests/challenges.verify.test.js`, `/Users/cmuir/Development/NotFlux-MCP-main/docs/HITL.md` (not read in full) |
| D16 | **Shadow-agent discovery** | Demo | Find ungoverned agents | 🟡 |
| D17 | **Audit trail** | Demo | Who did what through which agent | ✅ `demo_mcp_audit` |
| D18 | **Cost and token usage** | Demo | Per-agent LLM spend and timings | ✅ PostHog work |
| D19 | **LLM gateway** | Demo | Provider routing, custom and OpenRouter lanes, secured | ✅ `Privilege-standalone/llm-gateway`, `demo_llm_proxy` |
| D20 | **AI gateway client** | Tester | Client for the AI gateway | ✅ `standalone/ai-gateway-client` |
| D21 | **Personal agent (Dot)** | Demo | A user's own agent with consent | ✅ Dot |
| D22 | **Worker agent** | Demo | Autonomous agent under policy | 🟡 `PLAN-autonomous-vs-worker-agents.md` |
| D23 | **Digital worker** | Demo | Unattended agent; UC38 live run | ✅ digital worker demo |
| D24 | **Standard AI use cases** | Demo | A curated subset of the 87 use cases (corrected from 84: `demo_api_server/config/useCases.js` has 87 top-level entries, counted by grep on 2026-10-20; Learning Hub copy still to update) | ✅ needs a manifest |
| D25 | **ChatGPT / Claude connector login** | Demo | OAuth for remote MCP from real clients | ✅ |
| D26 | **Banking/MCP REST adapter** | Demo | Existing REST API exposed to agents | ✅ `demo_mcp_banking_rest` |
| D29 | **Progressive trust ladder** | Demo | A bank customer's personal agent starts public (no sign-in), then needs sign-in, in-app step-up and CIBA approval as risk rises; each rung gated by Ping. Uses A5 and A4 pieces | 🟡 `docs/planning/PLAN-progressive-trust-demo.md` (a plan doc is the lead seed, so the marker is partial), `demo_api_server/services/agentModeResolver.js`, `demo_api_server/data/publicBranchCatalog.js`, `demo_api_server/routes/ciba.js` |
| D30 | **Consumer agent booking** | Demo | "Book a flight under $800": the price must pass a transaction policy and a human must approve; token exchange, PingOne Authorize, HITL receipt. Overlaps D24 (it would otherwise be a subset), D21 and D15; airlines flavour of the vertical packs | ✅ `demo_mcp_resource_server/src/tools/airlinesToolHandler.ts`, `demo_mcp_resource_server/src/db/airlinesDb.ts`, `demo_api_server/services/mcpToolAuthorizationService.js`, `demo_api_server/config/verticals/airlines/manifest.json` |
| D31 | **No tool, no promise (tool set as authorization boundary)** | Demo | A chat agent is asked to waive a fee and would promise it; no waive tool exists, so no commitment can be made. Fully mock-able, no tenant (UC28; the "Air Canada pattern" is named in the UC title only) | ✅ `oauth-mcp/src/tools/BankingToolRegistry.ts`, `oauth-mcp/src/tools/handlers/commitmentHandlers.ts` (path-checked, not read), `demo_api_server/services/intentTokenService.js`, `docs/use-cases/unauthorized-commitment-fee-waiver.md` |
| D33 | **Agent attack gallery (including MCP authorization attacks)** | Tester | An SE launches named attacks (wrong scope, other user's account, bad client, rogue actor in `act`, impersonation, raw token forwarding) and sees each refused with the reason. Second pack, folded in from retired D34: issuer mix-up (RFC 9207, good vs evil AS), token passthrough and audience confusion (RFC 8707), confused deputy via static client plus DCR, SSRF via metadata, each blocked by a named control (the MCP security-considerations section was linked, not fetched: UNVERIFIED; mix-up needs two mock AS containers). **Overlaps D13 (explains denials; this launches them), D6/D7 (hostile servers), C22 and C23** | 🟡 `demo_api_server/routes/attackSimulator.js`, `demoAttackSeeds.js`, `demo_api_server/services/attackSimulatorService.js` (simulator routes; no gallery UI yet), `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`, `demo_authz_server/routes/decision.js`, `docs/use-cases/confused-deputy-actor-injection.md`; pack 2: `standalone/hostile-mcp-server`, `standalone/mcp-scanner`, `docs/RFC8707_RESOURCE_INDICATORS.md`, `docs/adr/0002-mcp-resource-server-skips-token-introspection.md` |
| D35 | **MCP authorization conformance scorecard** | Tester | Give a URL; score PRM (RFC 9728), WWW-Authenticate scope, AS metadata, CIMD/DCR, PKCE S256, `resource` param, `iss`, 403 insufficient_scope, and spec-version negotiation (2025-11-25 vs the 2026-07-28 RC claimed by a repo doc, UNVERIFIED externally). CI-able spec scorecard, unlike D3 (inspect) and D4 (risky tools). **Overlaps D2 (MCP auth lab), D3, D4 and C20 (same scorecard engine)** | 🟡 `docs/RFC9728_COMPLIANCE_AUDIT_REPORT.md`, `docs/MCP_SPEC_2025_11_25_GAP_ANALYSIS.md`, `docs/MCP_2026_07_28_PHASE1.md` (gap analyses and docs, not a scorecard engine), `standalone/mcp-inspector`, `standalone/mcp-scanner`, `/Users/cmuir/Development/mcp-resource-server/src/modernNegotiation.ts` (exists, checked by the fact-checker) |
| D37 | **MCP elicitation lab** | Demo | An MCP server mid-call needs more input or URL consent; the client shows a form or URL dialog; accept/decline/cancel and error -32042 are mapped. Spec version claims come from a repo doc, UNVERIFIED externally | ✅ `demo_mcp_gateway/src/elicitationStore.ts`, `demo_api_ui/src/components/ElicitationDialog.jsx`, `ElicitationModal.js`, `docs/MCP_ELICITATION_IMPLEMENTATION.md` |
| D38 | **A2A in-task auth (AUTH_REQUIRED) and extended card** | Demo | A remote agent returns task state AUTH_REQUIRED; the client obtains a delegated token and resumes; the extended agent card appears only after auth. A2A spec: only the first 100k chars were fetched, auth sections 7 and 8.4 NOT read (UNVERIFIED). Overlaps D9 and D10 | 🟡 `docs/A2A_ARCHITECTURE.md`, `docs/a2a-card-discovery.mmd` (a mermaid file: convert to ReactFlow data, family rule), `standalone/hostile-a2a-agent` |
| D39 | **A2A trust tester (unauthorized caller, signed card, verified-trust assertion)** | Tester | Three probes: an unauthorized agent drives a specialist over A2A JSON-RPC with no bearer (gateway verdict shown); a signed agent card verifies with real jose; a signed assertion lets a receiving org verify the sender where a bearer cannot. Flag `ff_verified_trust_a2a`. Absorbs the signed-card verifier candidate; overlaps D10 (card validator) | ✅ `demo_api_ui/src/components/InterAgentAbuseTester.jsx`, `demo_authz_server/decision.a2a.test.js`, `demo_api_server/scripts/verifyCardSigningInterop.mjs`, `demo_api_server/services/verifiedTrustService.js`, `a2aAgentCardService.js`, `standalone/hostile-a2a-agent` |
| D42 | **Ungoverned agent: before and after (session riding)** | Demo | An agent drives the user's logged-in browser session and moves money, looking identical to the user in logs; the governed path shows a distinct actor and scope. The standalone "before" picture to pair with any governed demo. No tenant needed for the "before" half. **Overlaps D6 (ungoverned vs governed, but for a hostile server) and D8 (prompt injection side by side); kept because the threat (session riding) differs** | ✅ `demo_ungoverned_agent/agent.js` (+ `run-with-token.sh`), `demo_api_ui/src/components/UngovernedAgentPage.js`, `docs/use-cases/ungoverned-agent.md`, `docs/runbooks/ungoverned-agent-opencli.md`, `standalone/hostile-mcp-server` |
| D43 | **Agent-token broker and JIT tool-bound credentials** | Demo | A Copilot Studio agent needs a PingOne AI_AGENT identity but must never hold the client secret; a broker holds it and callers hold one API key; rotate in one place. Second mode, folded in from retired D51: a broker mints short-TTL tool-bound credentials so the static backend API key leaves the wire, and replaying one against another tool fails (no Ping product tie-in confirmed for that mode: UNVERIFIED, frame it carefully). Copilot Studio behaviour is from the repo runbook, UNVERIFIED | ✅ `agent_token_service/README.md`, `agent_token_service/src` (README only checked), `docs/COPILOT_PART3_RUNBOOK.md`, `demo_api_ui/src/components/CopilotAgent.jsx`; JIT mode: `demo_api_server/services/jitCredentialBroker.js` (107-line service), `schemas/jit-credential.contract.json`, `demo_api_resource_server/server.js`, `demo_mcp_gateway/src/apiKeyDispatch.ts` |
| D49 | **Delegated-agent commerce lifecycle** | Demo | A shopper registers an agent, claims it with a code, consents, the agent buys through a protected MCP call, CIBA approves the big one, the shopper revokes. Overlaps D21, D22, D24 and B9 (retail flavour) | ✅ `demo_api_ui/src/pages/DelegatedCommercePage.jsx`, `demo_api_ui/src/config/delegatedCommerceDiagram.js`, `demo_api_server/routes/delegatedCommerce.js` |
| D50 | **SaaS-embedded worker** | Demo | A SaaS site embeds a worker that acts for a signed-in customer (miles redemption, CRM-style accounts and cases) under delegated identity while keeping its own workload identity. Distinct from D22 (autonomous worker); overlaps D22 and D23 | ✅ `demo_api_server/routes/embeddedWorker.js`, `demo_api_server/services/agentBuilderService.js`, `demo_api_ui/src/pages/EmbeddedWorkerPage.jsx`, `demo_api_ui/src/components/aiFootprintMocks` |
| D52 | **Agent red-team runner** | Tester | Run promptfoo correctness, routing and red-team suites against any agent endpoint, signed in, and read a pass/fail matrix. Overlaps D33 (gallery launches named attacks; this runs eval suites) | ✅ `demo_api_server/promptfoo/redteam-eval.yaml`, `agent-eval.yaml`, `auth-cookie.js`, `demo_api_server/scripts/promptfoo-eval-authed.sh`, `demo_api_server/routes/promptfoo.js` |
| D53 | **Overscoped agent auditor** | Tool | Compare the scopes an agent holds with what its tools need and flag overscoped agents (UC4/UC5). Agent-level, unlike G3 (tenant-level) | ✅ `scope-topology.json`, `ping-gateway/config/scope-topology.json`, `demo_api_server/config/scopes.js`, `oauth-mcp/src/auth/TokenIntrospector.ts`, `oauth-mcp/src/auth/BankingAuthenticationManager.ts` (both define `validateTokenScopes`; no file of that name exists) |

### E. Learning and enablement

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| E1 | **Learning Hub standalone** | Demo | Glossary, sources, Learn index, RAG Q&A; content-pack format that every demo contributes to. Planned pages folded in from retired E8, E9, E12: an OWASP agentic-threats map (threats T1 to T15 and KC1 to KC6 linked to the demo showing the control; the guide itself was not fetched, UNVERIFIED), an OAuth teaching agent (conversational teacher that can run a real flow; code location UNVERIFIED) and Jev lessons (fast typed judgments vs generative) | ✅ Learning Hub, Tika-RAG plan; folded-page seeds (🟡): `demo_api_ui/src/components/OwaspLearnerPage.js`, `OWASPBadge.jsx`, `OAuthAcademyPage.jsx`, `docs/OAUTH_TEACHING_AGENT_PLAN.md`, `demo_api_server/services/jevService.js`, `JevLearningPage.jsx`, `jevLessons.js` |
| E2 | **SE demo shelf (launcher)** | Tool | One page: every demo, status light (ready / needs setup / broken), start button | ❌ |
| E3 | **Diagram studio** | Standalone | Decided 2026-10-20: diagrams are their own standalone. Every flow diagram as a data file, ReactFlow only (never mermaid), shared by all demos through the base. Movable boxes, Simulate, Reset and a speed control on every one. Embeddable in a demo page and usable in presenter mode; each diagram step links to its story step and trace hop; exports PNG/SVG for decks | ✅ `/diagrams` index (PR #1457), 22 diagram configs (PR #1145), the ID-JAG kit's per-mode diagrams |
| E4 | **Talk-track library** | Tool | Searchable talk tracks across demos | ❌ (comes from the Phase 0 panel) |
| E5 | **Verticals (industry packs)** | Base feature | Decided 2026-10-20: verticals are part of every standalone. A vertical pack is one JSON file (display name, tagline, brand colors, vocabulary, cast roles). Stories are written once with `{{cast}}` and `{{vocab.*}}` tokens and the pack fills them, so a story re-skins with no copy. AI-DEMO2 has 16 vertical manifests to seed from (airlines, banking, government, healthcare, investment, manufacturing, retail, sporting-goods, university, walbuy, workforce, plus admin and teaching ones). Built so far in the ID-JAG kit (branch `feat/story-engine`): generic, airlines, banking, healthcare, retail. Next: the rest, a sync script that refreshes brand/identity from AI-DEMO2 manifests without touching the hand-written vocabulary, and applying brand colors through `customer.config` (0.6) | ✅ AI-DEMO2 `demo_api_server/config/verticals/*/manifest.json`, United docs; 🟡 packs in the kit |
| E6 | **Customer-specific packs** | Theme packs | e.g. the United engagement, applied via `customer.config` | ✅ United docs |
| E7 | **Demo health dashboard** | Tool | Readiness across the whole family | ✅ demo readiness catalog |
| E10 | **Sign-in portal skin pack** | Skin | Per-customer branded login portals and screens (PF login theme, PingOne MFA theme, DaVinci consent/approved/declined screens branded by a 2-char vertical code, config-driven mock company portals). Use fictional brands by default (owner decision 6). Overlaps A21 (branding and theming) and E6 | ✅ `scripts/pingfederate/apply-login-theme.sh` + `scripts/pingfederate/assets/login-theme-ping.css`, `scripts/davinci-brand-ciba-flows.mjs`, `/Users/cmuir/Development/oauthplayground/company-portal-mocks/shared/companies.json`, `/Users/cmuir/Development/oauthplayground/src/pages/protect-portal/themes/` |
| E11 | **Client-chrome costume shells** | Skin | Show the personal agent inside familiar client chrome (terminal, code editor, chat, SaaS); avoid imitating real vendor branding in a published repo. Overlaps D21 (personal agent) | ✅ `demo_api_ui/src/components/aiFootprintMocks/` (ShellTerminalView, ShellVsCodeView, ShellDesktopView), `demo_api_ui/src/pages/FootprintMockGalleryPage.jsx` |

### F. Telemetry, transaction tracing and workload identity

Decided 2026-10-20: a transaction trace must prove **all four**: one correlation ID end to end, the identity chain at each hop,
the policy decision at each hop, and latency plus LLM cost per hop. Viewable **both** ways: a built-in trace timeline in every demo
(works offline in mock mode), and an optional compose profile adding an OpenTelemetry stack plus Grafana.

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| F1 | **AI transaction trace (cross-product)** | Demo | One transaction followed from sign-in, through agent, gateway, policy, MCP tool and audit record, with identity, decision, latency and cost at every hop | ✅ observability demo (`/architecture/observability`, Grafana dashboard `ai-demo-agent-observability`), token-chain trace rail, policy-decision trace history, `E2E_CARECONNECT_TRACE.md` |
| F2 | **Trace envelope and emitter library** | Base | The shared event shape every demo emits (see below) so traces from separate repos join | 🟡 New Relic correlation-spans design, `llm-directive-and-trace.md` |
| F3 | **Trace timeline panel** | Base | The built-in Jaeger-style timeline component, in the base, mock-capable | ✅ Jaeger trace UI port design, telemetry page design |
| F4 | **OTel + Grafana profile** | Base | `--profile otel` adds collector, trace store and Grafana with the dashboards | ✅ `monitoring/` (Prometheus, Alloy, Grafana, alerts) |
| F5 | **Correlation-ID propagation tester** | Tester | Send a request through N hops and show where the ID is dropped or rewritten | ❌ |
| F6 | **Cost and latency per hop** | Demo | LLM tokens and dollars, plus time, per hop | ✅ PostHog gap closure |
| F7 | **Audit-to-trace join** | Demo | Click an audit line, land on its trace, and back | 🟡 `demo_mcp_audit` |
| F8 | **SPIFFE workload identity for agents** | Demo | Agents and MCP servers get SVIDs instead of static secrets; the SPIFFE ID is shown as the layer under the user token | ✅ `spiffe/`, `docs/SPIFFE_PLAN.md` |
| F9 | **SVID-to-Ping token exchange** | Demo | An SVID is exchanged for a PingFederate/PingOne token, then the usual user-and-agent chain applies | 🟡 `spiffe/pingfederate` |
| F10 | **SPIFFE lab** | Tester | Issue, rotate and verify SVIDs; shows what a failed verification looks like | 🟡 `spiffe/docker-compose` |

**Trace envelope (F2), proposed:** every hop emits `{ trace_id, span_id, parent_span_id, product, hop, subject (sub), actor (act),
spiffe_id (if any), decision {result, rule}, latency_ms, llm {tokens_in, tokens_out, cost}, ts }`. No raw tokens ever. W3C `traceparent`
is the propagation header, so it also works with real OTel. Each demo repo emits this envelope; the shelf (E2) or the trace page
(F1) joins them by `trace_id` across repos.

### G. SE platform tools

Added 2026-10-20. Tools that make every other demo cheaper to set up, run or clean up. They are SE-internal, not customer stories, so
group G is **explicitly exempt from the customer-story rule** (one person, one goal, one obstacle) and from the story engine. It is **not**
exempt from `doctor`, and every tool that writes must default to **dry-run** (read-only tools are dry-run by nature). Kind shows which
tools are **live-tenant-only** (exempt from mock mode, base requirement 1) and which are not. Folded or deferred: the mock Authorize
server is a base profile (see Phase 1), PingFederate in a box (G6) and the SE cluster deploy tool (G10) are in the Backlog.

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| G1 | **PingOne tenant bootstrap CLI** | Tool, live-tenant-only | An SE with an empty sandbox runs one command to get resource servers, scopes, apps, users and groups instead of console clicking; Management API worker app. Dry-run default. The 4212-line provisioner must be reduced to a recipe subset, and its run against a clean tenant has never been observed (per the fresh-environment doc), so a one-command claim is untested. Overlaps the base setup wizard and `doctor` (0.7): G1 is the tenant half, the wizard is the demo half | 🟡 `demo_api_server/scripts/bootstrapPingOne.js`, `demo_api_server/services/pingoneProvisionService.js`, `demo_api_server/scripts/setupFresh.js`, `scripts/pingone-bootstrap.js`, `docs/SETUP_AUTOMATION_PLAN.md`, `docs/editions/fresh-environment-gaps.md` |
| G2 | **PingOne app inventory and tenant cleaner** | Tool, live-tenant-only | List, classify (agent vs normal) and delete stale demo apps against a keep-list with dry-run default. The script hard-codes one environment ID and must be parameterised before use: unsafe as a general tool until then. Overlaps G3, G7, A13 | ✅ `scripts/cleanup-pingone-apps.sh`, `scripts/pingone-audit-249.js`, `demo_api_server/scripts/describeApp.js`, `docs/pingone-app-organization.md` |
| G3 | **Scope, audience and grant matrix verifier** | Tool, live-tenant-only | "Why is my token missing scope X or aud Y": compare tenant resources, scopes and app grants to an expected matrix, name the gap, optionally fix. Read-only by default. Overlaps B8 (drift checker), A13 (explorer) and D53 (agent-level) | ✅ `demo_api_server/scripts/verify-scope-configuration.js`, `scripts/check-resource-server-audience-drift.js`, `scripts/check-tool-scope-registration.js`, `demo_api_ui/src/components/ScopeAuditPage.js`, `docs/PINGONE_APP_SCOPE_MATRIX.md`, `docs/SCOPE_AUDIENCE_MAPPING.md` |
| G5 | **Vertical-in-a-box MCP resource server** | Tool, mock-capable | Set `VERTICAL=healthcare` and tools, scopes and data change while auth stays the same. One container, bundled SQLite; reusable as the resource server for many testers; its `vertical.json` format could seed E5. Overlaps E5 (verticals) and D26 (banking REST adapter) | ✅ `/Users/cmuir/Development/mcp-resource-server/verticals/banking/vertical.json`, `/Users/cmuir/Development/mcp-resource-server/verticals/healthcare/vertical.json`, `/Users/cmuir/Development/mcp-resource-server/README.md`, `/Users/cmuir/Development/mcp-resource-server/docker-compose.yml`; also `demo_mcp_resource_server` (10 verticals) |
| G7 | **Tenant snapshot and diff** | Tool, live-tenant-only | Export apps, resources, scopes and policy to JSON; diff two tenants or two moments (the diff itself can run offline on two saved snapshots). P1AZ is compare-only (no import or evaluate API). Extends B8 beyond policy; also the home for the gateway-parity checks. Overlaps B8, C17 | ✅ `demo_api_server/scripts/exportBootstrapData.js`, `exportMigrationBundle.js`, `importMigrationBundle.js`, `verifySnapshotParity.js`, `verifyAuthorizeCloudParity.js`, `scripts/check-pac-policy-drift.js` |
| G8 | **Postman / Bruno collection pack** | Tool, offline | Hand a customer ready collections (pi.flow auth code, 1- and 2-exchange delegation, MFA v4, MCP tools) with an environment file generated from setup output. Writes files only, so mock mode does not apply; `doctor` must include a secret scan because the collections were not scanned | ✅ `postman/`, `docs/The-AI-Demo-Shared.postman_environment.json`, `docs/PingOne Authentication v4 - MFA included.postman_collection.json` |
| G9 | **PingCLI command playground** | Tool, live-tenant-only | Show PingOne config is scriptable: pick an allow-listed pingcli command, see the string, run it live, read output in a terminal pane. UI component location UNVERIFIED | 🟡 `~/.claude/skills/pingcli-demo-page/SKILL.md`, `demo_api_server/routes/pingcli.js` |
| G11 | **PingOne sample-app runner (custom-admin-role, m2m-credentials)** | Tool, live-tenant-only | Run the devdocs sample apps for custom admin roles and machine-to-machine credentials against a tenant. The sample source is NOT on this machine (UNVERIFIED), only the in-app runner | 🟡 `demo_api_ui/src/pages/StandaloneSamples.jsx`, `SampleRunner.jsx`, `M2mCredentialsSamplePage.jsx`, skill `pingone-sample-apps` |

**Live-tenant-only (exempt from mock mode, must have `doctor` and dry-run):** G1, G2, G3, G7, G9, G11. Also exempt for their wiring step only: A25 and A26 (PingFederate plus PingOne MFA or DaVinci live); their post-wiring flows must get a mock path. B11 is not exempt: its mock is the local evaluator of the YAML rules, and only the live half needs the AAM gateway credential.
**Not live-only:** G5 (mock-capable) and G8 (offline file generator).

### H. Standards and interop labs

Added 2026-10-20. Labs for open standards outside Ping's own products (Shared Signals, credentials, HTTP signatures, browser-app
guidance). Honest framing: these are standards labs, not Ping features, and each screen carries a "not a Ping feature" banner if the
owner approves that (owner decision 7). Standards statuses below are survey fetches, not re-verified: see "Verify before customer use".

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| H1 | **Shared Signals lab: revoke the session, stop the agent** | Demo/Tester | Create an SSF stream, send a verification event, push/poll delivery, then a CAEP `session-revoked` event makes the receiver revoke the agent's tokens and the next tool call fails. The survey fetched an SSF 1.0 page dated 29 Aug 2025 (Standards Track; the page does not itself say Final) and a CAEP 1.0 page: verify before customer use. **No Ping product support found**, so this is a standards lab; a live variant could use PingOne session delete (own knowledge, UNVERIFIED). Trigger differs from D14 (identity event, not a cap); overlaps D14 and F8 in "revoke and watch it stop" | ❌ no SSF code. Adjacent: `demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js`, `demo_api_ui/public/learning-mirror/agent-kill-switch.html`, `docs/GARTNER_2026_DIGITAL_IDENTITY_COVERAGE.md` (calls SSF "Thin"). 2 mock containers |
| H2 | **Credential tester (SD-JWT VC inspector + OpenID4VCI offer walker)** | Tester | Paste an SD-JWT VC and see disclosures, hidden claims and key binding; walk an issuance offer (pre-authorized code, tx_code, nonce, jwt proof). OpenID4VP and OpenID4VCI 1.0 statuses: verify before customer use. PingOne Credentials documents OpenID4VCI with SD-JWT (search only); the verifier side is NOT confirmed. SD-JWT detail is own knowledge. Gives A9 a seed | ❌ nothing for credentials; related decoder UI `/Users/cmuir/Development/oauthplayground/src/pages/URLDecoder.tsx` |
| H3 | **Browser-based app token patterns (BFF vs SPA vs mediating backend)** | Demo | An SPA team asks where to keep tokens; show the three patterns and what malicious JS can steal. The survey page reported RFC 10017 / BCP 212 (Aug 2026), taken as reported: verify before customer use. AI-DEMO2 is already BFF-only. No tenant | 🟡 `docs/adr/0006-bff-only-token-custody.md` |
| H4 | **Web Bot Auth / RFC 9421 message-signature verifier** | Tester | Sign a request, verify it, tamper one covered header and watch it fail; plus the WebSocket fail-closed guard. Self-contained Ed25519, mock-able. No Ping product tie-in confirmed (UNVERIFIED) | ✅ `demo_mcp_gateway/src/webBotAuthVerify.ts`, `httpMessageSignature.ts`, `wsBindingGuard.ts`, `wsDenyClassifier.ts` |

## Suggested order (waves)

Rebuilt 2026-10-20 after the catalog expansion. Every active id appears in exactly one wave; a script check is in the commit report.
Wave 1 stays small: nothing from the survey is added to it. The candidate list wanted G4, G1, B12 and C20 in Wave 1; G4 is now base
work (Phase 1), B12 folded into B2/B7, and G1 and C20 moved to Wave 2 (owner decision 14 default).

| Wave | Demos (every active id appears in exactly one row; checked by script) |
|---|---|
| 0 | **C1 ID-JAG** (Phase 0, now with the enterprise-managed MCP and SAML-to-ID-JAG modes), then Phase 1 base extraction (now including the mock-authorize profile) |
| 1 | **B7 Group Policy** (now with the policy predictor), **E1 Learning Hub** (now with the OWASP map, OAuth teaching agent and Jev lessons), **E2 demo shelf**, **E3 diagram studio** (its own standalone and the base's diagram data), **C2 token-flow workbench**, **C3 token inspector**, **A1 MFA tester**, **F2, F3 trace envelope and timeline** (base) |
| 2 | **D1 Privilege**, **D2 MCP auth lab** (now with the CIMD mode), **D3, D4, D5 MCP tools**, **C6 OBO**, **D8 prompt-injection**, **D6, D7 hostile servers**, **D9 A2A**, **D10 A2A card validator**, **D19 LLM gateway**, **D20 AI gateway client**, **D25 connector login**, **D26 banking REST adapter**; new: **C20**, **C23**, **D31**, **D33**, **D35**, **G1**, **G5** |
| 3 | **B1 Authorize**, **B2 policy playground**, **B3, B4, B5 Cedar**, **B6 AVP variant** (only if the owner confirms), **B8 drift checker**, **B9 consent and delegation**, **A3, A4 passwordless and CIBA**, **A5 step-up**, **A6 Protect**, **A10 DaVinci**, **A11 pi.flow kit**, **A12 registration and self-service**, **A15 PF token factory**, **A16 SAML lab**, **A19 PingGateway**; new: **A25**, **A26**, **B10** (with Cedar), **B11** (with A19), **B13**, **B14**, **C21**, **C22**, **C24**, **D29**, **D30**, **D37**, **D38**, **D39**, **D42**, **G2**, **G3**, **G9**, **G11** |
| 4 | **D11 Agent Registry**, **D12 AI Guard**, **D13 caught errors**, **D14 kill switch**, **D15 HITL** (now with the stateless receipt mode), **D16 shadow agents**, **D17 audit**; new: **C25**, **D43**, **D52**, **D53**, **H1**, **H4** |
| 5 | **D18 cost and token usage**, **D21 personal agent**, **D22 worker agent**, **D23 digital worker**, **D24 standard use cases**, **C18 SPIFFE demo** (superseded by F8 to F10), **F8, F9, F10 SPIFFE**, **F1, F4, F5, F6, F7 transaction trace and OTel profile** (needs several demos emitting first), **A14 AIC**, **A20 external IdP login**, **A8 Recognize**, **E4 talk-track library**, **E7 demo health dashboard**; new: **D49**, **D50** |
| 6 | **A9 Verify/Credentials**, **A17 PingDirectory**, **A18 PingAccess**, **A21 branding**, **E5, E6 verticals and customer packs**; new: **E10**, **E11**, **G7**, **G8**, **H2**, **H3**. Testers, grouped into suites (identity testers: **A2, A7, A13, A22, A23**; token testers: **C4, C5, C7, C8, C9, C10, C11, C12, C13, C19**; platform testers: **C14, C15, C16, C17**) |
| Backlog | Not scheduled (see Backlog): **A24**, **A27**, **D27**, **D32**, **D41**, **D44**, **D45**, **D46**, **D47**, **D48**, **G6**, **G10** |

Testers are small. They can be batched into a single "tester suite" repo per area (identity testers, token testers, MCP testers,
standards labs) where one repo per tester is more overhead than value. Decision pending: **one repo per tester, or a suite repo per category**.
Default: demos get their own repo; testers are grouped into suites, except MFA tester (A1), which is its own repo. In the first release,
C20, C23, D33 and D35 count as suite members, not four repos.

## First release

**PROPOSED, awaiting the owner's approval.** Nothing below is committed to. This replaces the candidate file's "about 20, old and new"
cut, which the independent checker found dishonest: seven of its ten old items are not built as standalone repos, two of its new
items were not repos at all (a base profile and a C1 mode), and one was live-only. The honest split is Wave A (code exists) and Wave B
(planned, not built). Items that ship inside every demo (F2/F3 trace, presenter mode, story engine, doctor, Reset, mock-authorize
profile) are base work and are not counted. Total: 8 in Wave A plus 11 in Wave B = 19 items. 19 deliberately exceeds the owner's "about 15" as an item count, because C3 ships inside C1 (a mode, no repo of its own unless the owner wants one) and the four testers C20, C23, D33 and D35 are one suite repo. That makes 7 repos in Wave A plus 7 plus 1 suite in Wave B = 15 repos. If the owner wants 15 items rather than 15 repos, the first things to cut are E2 (useless until several demos exist) and the four suite testers. G1 is not in the cut: it is live-only and outside base requirement 1 (group G exemption), so it stays in Wave 2.

State of the base as read with `gh` on 2026-10-20: `cmuir_pingcorp/id-jag-standalone` has 37 PRs, 29 merged and 8 open (#29 registration,
#31 reset, #32 story-engine, #33, #34 trace-envelope, #35 content-pack, #36 setup, #37 CI Node-22-only); doctor (#30) and the
inspector PRs (#26 to #28) are merged. The base extraction (Phase 1) has not started, so every "depends on the base" below is a
dependency on work that does not exist yet.

### Wave A: built or nearly built

| # | ID | Item | What exists | Depends on in the base | Gap or risk |
|---|---|---|---|---|---|
| 1 | C1 | ID-JAG kit | `~/Development/id-jag-standalone`: Mock, `pf-as`, `pf-pf`, `byo` modes, preflight, Inspector, SAML path; doctor merged | Is the template; needs #29, #31, #32, #36 merged and Phase 0.3, 0.4, 0.6, 0.9 | Registration, doctor and reset have only run against a mocked PingFederate. Enterprise-managed MCP mode and SAML-to-ID-JAG bridge mode are planned, not built |
| 2 | C3 | Token inspector | The kit's ID-JAG Inspector (PRs #26 to #28 merged) | Token decode and redaction (base) | Ships first as a C1 mode; a separate repo only if the owner wants it |
| 3 | D1 | Privilege (Cedar) | `~/Development/Privilege-standalone` (3 folders) and AI-DEMO2 `privilege/`; Cedar demo PR #1640 is open in AI-DEMO2 | Mock mode, seeded users, story engine | Candidate file called it "built and hardened locally"; not re-checked here (UNVERIFIED) |
| 4 | D3 | MCP inspector | `AI-DEMO2/standalone/mcp-inspector` (also in Privilege-standalone) | Presenter mode, doctor | Predates the base; how many base requirements it already meets is UNVERIFIED |
| 5 | D4 | MCP scanner | `AI-DEMO2/standalone/mcp-scanner` | Same | Same |
| 6 | D5 | MCP toolkit and discovery agent | `AI-DEMO2/standalone/mcp-toolkit`, `mcp-discovery-agent` | Same | Same |
| 7 | D6 | Hostile MCP / rug-pull | `AI-DEMO2/standalone/hostile-mcp-server` | Story engine (ungoverned vs governed toggle) | Same |
| 8 | D7 | Hostile A2A agent | `AI-DEMO2/standalone/hostile-a2a-agent` | Same | Same |

### Wave B: planned, not built (seed code exists in AI-DEMO2 or a sibling folder)

| # | ID | Item | Why in the cut | Depends on in the base | Gap or risk |
|---|---|---|---|---|---|
| 9 | B7 | Group Policy | Wave-1 priority; decided its own repo; absorbs the predictor | Mock-authorize profile, vertical packs, seeded users | Needs the mock-authorize profile first |
| 10 | A1 | MFA tester | Wave-1 priority; own repo | Seeded users, mock phone, doctor | Research report exists; no repo |
| 11 | E1 | Learning Hub | Wave-1 priority; content-pack host | Content-pack format (kit PR #35 open) | No repo |
| 12 | E3 | Diagram studio | Its own standalone repo (owner decision 2026-10-20); also the shared diagram data every flow diagram in the base draws from | Diagram data format | Counted as a repo. Both roles need the data format settled first |
| 13 | C2 | Token-flow workbench | Wave-1 priority | Mock AS, token decode | `par` skill only; partial seed |
| 14 | E2 | SE demo shelf | Launcher for the family | Status endpoint from each demo | Useless until several demos exist |
| 15 | C20 | OAuth profile checker | Answers "is our config safe"; mock-able | Mock AS | FAPI 2.0 rule pack is verify-before-customer-use |
| 16 | C23 | Wrong-token rejection tester | Small, mock-able | G5-style mock resource server | Overlaps C21 and D33 |
| 17 | D31 | No tool, no promise | Small, no tenant, strong story | Story engine | `commitmentHandlers.ts` path-checked only |
| 18 | D35 | MCP conformance scorecard | Most-asked topic; CI-able | D3 and D4 (Wave A) | Seed is gap-analysis docs, not an engine |
| 19 | D33 | Agent attack gallery | Reusable mock-gateway attacks | Mock gateway, story engine | Simulator routes exist, no gallery UI |

Deliberately left out of the first release: H1 (no seed, not a Ping feature), B10 (AuthZEN: Ping endpoint unverified, belongs with Cedar
in Wave 3), everything in the Backlog (including A24, which the survey ranked the highest-value large item; a surveyor judgement, not a measured fact), and anything needing AWS, a Protect licence or Weaviate.

## Backlog (large or not yet standalone-sized)

Moved out of the active catalog on the independent checker's finding that each needs more than the 2-to-5-container budget, a third-party
stack, a licence or credentials not confirmed, or is internal-only. Ids stay reserved. A row returns to the catalog when the "promote
when" condition is met and the owner agrees.

| ID | Name | Why backlog | What it shows | Seed |
|---|---|---|---|---|
| A24 | **Support console with customer identity gate** | Spans UI components, `demo_hitl_service`, the BFF, vertical configs and the ops assistant: more than 5 containers. Promote when the BFF and HITL service can be cut to a mock. First candidate to promote (the survey scored it 5; that is a surveyor judgement, not a measured fact) | A support rep and an ops AI assistant cannot see a customer record until the customer proves identity by OTP on their own device through pi.flow; the BFF holds the customer token and the console sees only masked contacts. Works across 10 verticals via a config file | `demo_api_ui/src/components/supportConsole/` (SupportConsole.jsx, IdentityGate.jsx, OpsAssistantChat.jsx, supportConsoleConfig.js, resolvePermission.js); `demo_hitl_service`. Real-delegation design (impl status UNVERIFIED): `docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md` |
| A27 | **Human or agent? (Protect computer-using-agent detection)** | Protect feature is "contact sales" per the surveyed release notes; the service is a 53-line stub. Overlaps A6/A7: when built it is a mode of A6, not a repo. Promote when licence access is confirmed | Protect flags a computer-using agent by browser fingerprint and behaviour; allow, step-up or block | `/Users/cmuir/Development/oauthplayground/src/v8/flows/PingOneProtectFlowV8.tsx`, `se-skills-export/pingone-protect-ai-demo`, `demo_api_server/services/pingOneProtectService.js` |
| D32 | **Agent Gateway MCP tool guard** | Agent Gateway image availability UNVERIFIED; Brave needs an API key live and a mock is UNVERIFIED. Overlaps A19 and D1. Promote when the image is confirmed | Weather and web-search MCP tools allowed only for the business footprint and no crypto queries; PingGateway filters tool arguments before the vendor runs, and policy is flipped live. Per surveyed release notes, Agent Gateway ships McpValidation/Protection/Audit filters on PingGateway (verify before customer use) | `ping-gateway/scripts/groovy/tx-weather-scope.groovy`, `tx-brave-scope.groovy`, `ping-gateway/config/routes/00-mcp-weather.json`, `00-mcp-brave.json`, `demo_mcp_weather`, `demo_mcp_brave`, `docs/pinggateway-agent-plan.md` |
| D41 | **Agent lifecycle with IGA and leaver cascade** | Needs an IGA target (a stub is untested) and PingOne HR/webhook behaviour. Promote when a stub IGA target is shown to work | Governance sees live AI agents authenticating through Ping (NHI inventory), gets join/move/leave events forwarded to an IGA tool (SailPoint-style); when HR disables a user, that user's agents and delegated tokens die. PingOne provisioning behaviour is own knowledge | `demo_api_server/services/controlPlane/liveAgentInfo.js`, `demo_api_server/services/agentLifecycleEvents.js`, `demo_api_server/services/sailpointForwarder.js` (corrected paths: these two are under `services/`, not `controlPlane/`), `demo_api_server/services/lmdb/agentLifecycleEventStore.lmdb.js`, `demo_api_ui/src/components/ControlPlaneRoster.jsx`, `docs/privilege-agent-features.md`, `docs/PINGONE-WEBHOOK.md` |
| D44 | **Bedrock AgentCore + PingOne agent** | Needs an AWS account; no runnable sample found. Promote when a sample exists | An agent hosted on AWS Bedrock AgentCore Runtime authenticates with PingOne for M2M and user-federated (3LO) flows. Skill says verified 2026-08-12 against SDK 1.21.0 | `se-skills-export/bedrock-agentcore-pingone/SKILL.md`, `/Users/cmuir/Development/se-skill-catalog/skills/bedrock-agentcore-pingone` (+ references) |
| D45 | **Bring your own agent framework (LangChain, LlamaIndex, Pydantic AI)** | Size L: three runtimes plus the AML compliance agent. Split per framework when promoted | A customer team on LangChain or LlamaIndex sees the same OAuth, token exchange and gateway working from each framework; includes the AML compliance agent as a Pydantic AI example | `langchain_agent/README.md`, `langchain_agent/src`, `llamaindex_agent/agent.py`, `compliance_agent/agent.py` + `rules.py` (mock-able), `docs/AGENT_FRAMEWORK_COMPARISON.md` |
| D46 | **Real MCP clients kit (LibreChat, LM Studio, Muse)** | Depends on third-party client stacks; overlaps D2/D25. Promote when D2 exists | Unmodified real MCP clients do RFC 9728 discovery, DCR and PKCE against the governed door (standard lane and AI-gateway lane) | `librechat/docker-compose.yml`, `librechat/seed-demo-agents.js`, `lmstudio/mcp.json`, `lmstudio/demo-steps.json`, `oauth-mcp/src/oauth/OAuthRouter.ts`, `docs/EXTERNAL_DOOR_MCP_FLOW.md` |
| D47 | **Privilege A2A access review** | Needs an Anthropic API key and the live Privilege gateway; already largely a folder in AI-DEMO2 `standalone/`. Promote with D1 | A security analyst asks an agent to review access; a delegated worker gathers evidence through governed hops; a three-deep chain controls who may call whom | `standalone/privilege-a2a-anthropic-demo/src/main-agent/chain.ts`, `standalone/privilege-a2a-anthropic-demo/src/worker-agent/index.ts`, `langchain_agent/src/agent/a2a_delegation.py`, `demo_api_server/routes/privilegeA2aClient.js` |
| D48 | **Protected RAG (authorization on retrieval + grounding on/off)** | Needs Weaviate and an LLM, partly mock; authorization story for grounded documents UNVERIFIED | A developer asks an indexed repo questions through an MCP search tool while authorization controls who may search which codebase; plus the same agent with grounding off vs on | `demo_mcp_code_search`, `demo_api_ui/src/pages/CodeSearchPage.jsx`, `demo_api_ui/src/components/CodebaseUploader.jsx`, `llamaindex_agent/retriever.py`, `docs/knowledge-grounding-demo-script.md` |
| D27 | **Governing the PingOne and AIC admin MCP servers** | Needs the PingOne MCP server plus the Privilege gateway live and has no mock mode, so it cannot meet base requirement 1; its seed is a README and a sidecar, not a built demo. Moved out of the active catalog in the verifier-correction pass (2026-10-20). Promote when a mock PingOne MCP server (canned tool responses) lets the Privilege per-tool policy run offline, or when the owner approves a live-only exemption for it | An agent administers the IdP itself through Ping's own MCP server and Privilege applies per-tool policy (read free, writes held for approval). AIC and DaVinci MCP servers exist per a search result only (UNVERIFIED). Overlaps D1, C17 and the `pingone-mcp` skill | 🟡 `demo_mcp_pingone/README.md` (runs `pingidentity/pingone-mcp-server` as sidecar; README and sidecar, not a built demo), `pingone/pingone-mcp/SKILL.md`, `demo_api_ui/src/components/PingOneMcpInspector.js`, `docs/pingone-mcp-server-report.md` |
| G6 | **PingFederate in a box** | PF image and licence access UNVERIFIED; a licence checker is an idea only. SE platform tool, live. Promote when licence access is confirmed | Stand up a clean local PF with licence check, ports, Java, admin readiness and base config in one command | `se-skills-export/pingfederate-install/SKILL.md`, `scripts/pingfederate/docker-compose.fresh.yml`, `docker-compose.local.yml`, `ensure-se-pingfederate.sh`, `provision-all.sh`, `docs/editions/pf-baseline.md` |
| G10 | **SE cluster deploy tool (internal)** | Internal SE only, not a customer demo and not small. SE platform tool, live | Deploy a family demo to the shared Ping SE Kubernetes cluster with the Ping-email rule and kubeconfig install | `se-skills-export/ping-se-cluster-deploy/SKILL.md`, `scripts/install-se-kubeconfig.sh`, `scripts/ping-email.sh`, `scripts/se-gateways.sh` |

## Retired ids (folded, not reused)

These candidate ids were folded into another row on the independent checker's duplicate findings. The ids are not reused.

| ID | Candidate name | Folded into | What carries over |
|---|---|---|---|
| G4 | Mock Authorize server | Base: `mock-authorize` profile (Phase 1) | Built from `demo_authz_server` (`demo_authz_server/routes/decision.js`, `demo_authz_server/routes/sideband.js`, `demo_authz_server/routes/rules.js`, `demo_authz_server/ruleStore.js`; parity test `demo_authz_server/decision.mockCloudParity.test.js`, not under `routes/`). Serves base requirement 12 and mock mode for B1, B7 and every Authorize demo |
| B12 | P1AZ policy generator and offline deny predictor | B2 (generator, as a feature) and B7 (predictor, as a mode) | `se-skills-export/p1az-import-generator/SKILL.md`, `scripts/predict-p1az-denies.mjs`, `walk_policy_tree.py`. No API to import or evaluate a P1AZ policy: import stays a manual console step |
| D28 | Enterprise-managed MCP access and central revocation | C1 (a mode of the ID-JAG kit) | `enterpriseMcpPolicyService.js`, `idJagService.js`, `planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md` (plan only). PF needed, consistent with the PF-token-only decision |
| D34 | MCP authorization attack lab | D33 (second attack pack) | Mix-up, passthrough, confused-deputy, SSRF-via-metadata scenarios |
| D36 | CIMD lab | D2 (a CIMD mode) | Generate, fetch, validate, register; `CimdSimPanel.js` is a simulator panel, not a validator, so seed is partial (🟡). CIMD draft status: verify before customer use |
| D40 | Stateless HITL challenge and receipt binding | D15 (a receipt-binding mode) | 401 challenge with transaction id, bound receipt, $10-approval-replayed-as-$5000 refusal; `demo_hitl_service/src/receiptVerification.js`; NotFlux-MCP-main source has no git history, needs Vertex AI plus Kong plus AIC, licence UNVERIFIED (partial seed, 🟡) |
| D51 | JIT tool-bound credential broker | D43 (a JIT mode) | See D43 |
| E8 | OWASP agentic threats mapper | E1 (a Learn-pack page) | `OwaspLearnerPage.js`, `OWASPBadge.jsx`; the OWASP guide itself was not fetched (UNVERIFIED) |
| E9 | OAuth teaching agent | E1 (a teaching-agent mode of the RAG Q&A) | `OAuthAcademyPage.jsx`, `docs/OAUTH_TEACHING_AGENT_PLAN.md`; code location UNVERIFIED |
| E12 | Jev decision model | E1 (lesson content) | `jevService.js`, `JevLearningPage.jsx`, `jevLessons.js` |

## Verify before customer use

None of these were verified by the editor of this plan. They come from survey fetches or repo docs. The checkers re-read some pages
but no claim here is confirmed against a primary source. Treat each as a claim to re-check before a customer sees it.

| Claim | Where used | Status |
|---|---|---|
| Transaction-token draft revision and renamed claims | C25 | Repo doc cites an older draft; a survey fetch reported a newer one with renamed claims. Verify before customer use |
| AuthZEN 1.0 status and date | B10 | Survey fetch reported Final, 11 Jan 2026. Verify before customer use |
| FAPI 2.0 final status; whether PF, P1 or AIC meet it | C20 | Search result only. Verify before customer use |
| SSF 1.0 and CAEP 1.0 status | H1 | A fetched page was dated 29 Aug 2025 and did not itself say Final. Verify before customer use |
| OpenID4VP and OpenID4VCI 1.0 status; PingOne Credentials verifier side | H2, A9 | Survey fetch and search only. Verify before customer use |
| RFC 10017 / BCP 212 | H3 | Taken as reported by the survey page. Verify before customer use |
| Agent Gateway filters on PingGateway | D32 (backlog) | Release notes fetched by a surveyor. Verify before customer use |
| MCP 2026-07-28 release candidate | D35 | Repo doc says so; no external fetch. Verify before customer use |
| CIMD draft revision | D2 (CIMD mode) | Survey fetch. Verify before customer use |
| A2A auth sections 7 and 8.4 | D38 | Not read. Verify before customer use |

Checked in files by the fact-checker on 2026-10-20 (and not needing a flag): `modernNegotiation.ts` exists in `mcp-resource-server/src`;
the CDN config files exist but with mixed-case names; `useCases.js` has 87 entries.

## Survey outcomes: dropped and declined candidates

Counts here are rows in the tables below (count commands are in the commit report). The candidate file's header claim of 148 candidates
cannot be reconciled with its tables, because several table lines group two or three candidates; this plan reports table rows only.
The fix of the double-listing: Mortgage, ungoverned laptop agent, AML agent and knowledge grounding were in both tables and are now only
in Dropped (as merges); PingID MFA was in both and is now only in Declined. Seed additions in the Dropped table are **not yet applied** to the
catalog rows: they are recorded here for the next edit pass.

Every "value N" score in this plan is the survey's own judgement, not a measured fact.

### Dropped as already covered or merged

| Candidate (source) | Covered by | Action |
|---|---|---|
| Orchestration SDK custom sign-in UI (usecases) | A10, A11 | Add seed `demo_api_ui/src/pages/OrchestrationSdkExplainerPage.jsx` |
| DaVinci adaptive-MFA flow pack (repos) | A10, A6, A3 | Add seeds from `/Users/cmuir/Development/CDN/` with exact mixed-case names: `StandardAdaptive-mf-ConfigObject.json`, `Usernameless-mf-ConfigObject.json`, `VerifyOnHigh-mf-configObject.json`, `VerifyRegistration-mf-configObject.json`, `credentials-mf-configObject.json`, `passwordlessOnly-mf-configObject.json` |
| Response-modes explainer (repos) | A11 | Add seed `/Users/cmuir/Development/oauthplayground/src/pages/learn/ResponseModesLearnPage.tsx`, `/Users/cmuir/Development/oauthplayground/src/flows2/flows/redirectless.flow.tsx` |
| Retail MFA scenario, Kroger-style (repos) | A1 + E5 | Vertical story for the MFA tester |
| HelioMart password reset (repos) | A12 | Add seed `oauthplayground/src/pages/security/HelioMartPasswordReset.tsx` |
| Risk-aware login portal (repos) | A6 | Add seed `protect-portal/components/RiskEvaluationDisplay.tsx` |
| Branded sign-in skins; company portal generator; PF login theming; DaVinci per-vertical branding (repos, skills) | merged into E10 | Four candidates become one row |
| PingDirectory / PingAccess skills (skills) | A17, A18 | Update seed column to `se-skills-export/pingdirectory-ai-demo/SKILL.md`, `pingaccess-ai-demo/SKILL.md` (skills only, no code checked) |
| Gateway resilience: rate limit and fail closed (usecases) | D14 | Add seeds `demo_mcp_gateway/src/rateLimit.ts`, `GatewayIntrospectionClient.ts`, `docs/use-cases/oauth-fail-closed.md` |
| Policy conformance matrix (services) | D13, E7 | Add seed `PolicyConformancePanel.jsx` |
| Denial explainer and pattern analyst (usecases) | D13, D17 | Add as AI-explain mode of D13; seeds `appEventService.js`, `docs/use-cases/ai-explain-last-denial.md` |
| Governance timeline (services) | D17, F7 | Add seed `GovernanceTimelinePage.jsx` |
| Mortgage vertical pack (usecases) | E5 | A vertical, not a demo |
| Signed Agent Card interop verifier (skills) | D10 | Merged into D39; also add seed to D10 |
| HITL approval receipt verifier (services) | D15 | Receipt-binding mode of D15 (D40 retired) |
| Third-party tool guard + Agent Gateway MCP filters lab (usecases, landscape) | partial A19 | Merged into D32 (now in the Backlog) |
| SAML assertion to ID-JAG bridge (skills) | C1 | Mode of the ID-JAG kit; seeds `configure-saml-idjag.js`, `outside-agent.js` |
| Enterprise-managed MCP authorization (services, duplicate of usecases) | C1 mode (D28 retired) | Two candidates become one mode of the ID-JAG kit |
| RFC 9701 JWT introspection tester (landscape) | C12 | Fold into C12; seed `docs/INTROSPECTION_VALIDATION_GUIDE.md` |
| Refresh-token rotation and reuse tester (landscape) | C12 | Fold into C12; seed `refreshToken.flow.tsx` |
| JIT ephemeral credentials tester (usecases) | D43 | JIT mode of D43 (D51 retired) |
| PAR vs RAR comparator (repos) | C7, C8 | Add seed `oauthplayground/src/pages/PARvsRAR.tsx` |
| CIBA vs device authorization explainer (repos) | A4, C11 | Add seed `oauthplayground/src/pages/CIBAvsDeviceAuthz.tsx` |
| JWKS troubleshooting (repos) | C5 | Add seed `oauthplayground/src/pages/JWKSTroubleshooting.tsx` |
| Webhook and audit-activity viewer (repos) | C16 | Seed for C16: `PingOneWebhookViewer.tsx`, `PingOneAuditActivities.tsx` |
| Audit and event streaming to SIEM (skills) | C16, F4 | Add seeds `docs/PINGONE-WEBHOOK.md`, `docs/observability/datadog-scaffold.md` |
| PingOne Authorize decision dashboard, Grafana (services) | F4 | Content for F4: `monitoring/grafana/dashboards/p1az-decisions.json` |
| Delegation-chain hop tracer (skills) | C6, F1, C3 | Seed `demo_api_server/scripts/tokenChainTrace.js` |
| Three-hop token chain with audience isolation (repos) | C6 | Add negative tests and NotFlux seed `NotFlux-MCP-main/README.md` to C6 |
| OAuth/JWT toolbelt as MCP tools (repos) | C3, D5 | Seeds `oauthplayground/jwt-verifier-mcp-server` (completeness UNVERIFIED) |
| Mock-MCP agent flow explainer (repos) | D2 | Low value |
| Prompt redaction filter (repos) | D12, D19 | Seed `Privilege-standalone/llm-gateway/promptRedact.js` |
| Guardrail verdict live feed (skills) | D12, D13 | Seed `scripts/gateway-verdict-feed.sh` |
| Privilege console probe (skills) | D1, D11 | Seed `scripts/privilege-console-probe.mjs` |
| Privilege JIT cloud access (usecases) | D1 | L, real VMs and AWS; keep as a D1 script |
| Worker-app role doctor (skills) | base doctor 0.7 | Feature of the base `doctor`, not a repo |
| PingOne MCP connect and smoke (skills) | C17 | Feature of C17 |
| Demo state export/import (skills) | base Reset 0.8 | Base feature |
| Edition / standalone extractor (skills) | Phase 1 base distribution | Maker tool; reuse `scripts/export-edition.js` |
| Consent receipt viewer; IPSIE readiness (landscape) | B9; A22/C14 | Fold into notes; IPSIE page had no profile content |
| PingFederate + PingOne MFA wiring (services dupe) | merged into A25 | n/a |
| Mattermost HITL; pingone-mcp-server clone; iOS authenticator sample; AI-DEMO2 copies and exports (repos) | D15 (closed track), C17, A4 companion, n/a | Ignored as demos |
| Compliance (AML) agent standalone (services) | D45 (Backlog) | Pydantic AI example inside D45; moved here from Declined |
| Knowledge grounding on/off (skills) | D48 (Backlog) | Merged into D48; moved here from Declined |
| Ungoverned laptop agent / session-riding (skills, services) | D42 | Merged into D42; moved here from Declined |

### Declined (no catalog home)

| Candidate | Reason |
|---|---|
| PingOne client-secret rotation runner / helper (services, skills) | Handles real secrets; internal tool, tied to this repo's vault, value 2 (surveyor judgement) |
| Terraform local-stack lifecycle (skills) | No Ping resources; do not copy `terraform.tfvars` or tfstate |
| Gateway A/B parity harness (skills) | Value 2 (surveyor judgement), only meaningful with both gateways |
| PingID MFA demo (skills) | No runnable code, needs PingID tenant, low confidence |
| WebMCP demo (services) | Meaning UNVERIFIED beyond the page; value 2 (surveyor judgement) |
| PAT to OAuth migration checker (skills) | Relevance to PingOne UNVERIFIED |
| Diagram conversion tools (skills) | Seed material for E3, not a demo |
| PingFederate RAR processor (usecases) | L, Java plugin build, hard to mock; revisit under B13 only if PF-side limit is wanted |
| Ping SE sample apps handoff (repos) | Context doc only |

## Open questions and owner decisions

Merged 2026-10-20: the two earlier open lists plus the 14 decisions from the catalog expansion. Removed because already answered: the
"four defaults" question (answered in Decisions settled), Cedar positioning (Decision 4; only the AVP variant remains open), the
candidate file's "where does G4 live" (applied: base profile), "Wave 1 grows by 4" (applied: it does not) and "counts 84 vs 87"
(applied: D24 now says 87; the Learning Hub copy still needs the same fix, an action not a decision). Runner/CI, mock sign-in, issuer
sign-in, the project board and repo creation timing are decided: see "Decisions recorded later".

| # | Question | Default or recommendation | Source |
|---|---|---|---|
| 1 | **First-release cut.** Approve the Wave A / Wave B list (19 items = 15 repos: C3 inside C1, 4 testers as one suite; G1 excluded as live-only). Biggest swing: whether H1 (Shared Signals) and B10 (AuthZEN) join despite weak seed or Ping support | Keep both out | Expansion 1 |
| 2 | **Backlog.** Confirm the 12 items moved out of the active catalog (A24, A27, D27, D32, D41, D44 to D48, G6, G10). D27 went there because it needs two live services and has no mock mode (the alternative is a live-only exemption). Should A24 (the survey scored it 5, a surveyor judgement, not a measured fact; full seed) be promoted first? | Promote A24 after the BFF and HITL service can be mocked | Expansion (critic) |
| 3 | **Confirm the folds.** G4 into a base `mock-authorize` profile, B12 into B2/B7, D28 into C1 as a mode, D34 into D33, D36 into D2, D40 into D15, D51 into D43, E8/E9/E12 into E1. D28 as a C1 mode keeps the PF-token-only decision | Fold all | Expansion 2, 10 and critic |
| 4 | **C22 versus C9.** Keep the stolen-token lab as its own demo or fold it into the DPoP tester (C9)? DPoP stays PF-only either way | Own row, as an attack story at an MCP gateway | Expansion 3 |
| 5 | **AIC and pi.flow.** AIC waits for pi.flow, or a documented redirect exception for AIC only | Wait (rule: no redirect logins) | Still open 1 |
| 6 | **Cedar: Amazon Verified Permissions variant** (B6) wanted? | Local open-source engine only | Still open 2 |
| 7 | **Tester packaging.** One repo each, or suites (`token-testers`, `mcp-testers`, `identity-testers`, `standards-labs`)? | Suites, except A1 which has its own repo | Open 2, expansion 9 |
| 8 | **Verify/Credentials (A9) and PingDirectory (A17)** have no existing code; confirm they stay in scope given the cost | Keep in Wave 6 | Open 4 |
| 9 | **Demo shelf (E2):** SE-only, or shared externally? | SE-only | Open 5 |
| 10 | **Txn-token docs.** Fix `docs/TRANSACTION-TOKEN-RFC-SUMMARY.md` and the related AI-DEMO2 docs against the current draft before any customer sees C25 | Fix first; C25 stays in Wave 4 | Expansion 4 |
| 11 | **Brand risk.** E10 and E11 touch real company names and logos. Fictional brands in published repos, real ones only in private customer packs (E6)? | Fictional by default | Expansion 6 |
| 12 | **Standards-lab honesty.** H1 to H4, C25 and B10 are not confirmed Ping features. Allow them under a "Standards lab" label with an on-screen "not a Ping feature" banner? | Yes | Expansion 7 |
| 13 | **Group G exemptions.** Confirm: SE platform tools are exempt from the customer-story rule; the live-tenant-only ones (G1, G2, G3, G7, G9, G11, plus the A25 and A26 wiring step) are exempt from mock mode; every G tool keeps `doctor` and a dry-run default | Confirm as drafted | Expansion 8 |
| 14 | **Licences and images for backlog items.** Confirm availability to SEs for G6 (PingFederate image), A27 (Protect) and D32 (Agent Gateway) before promoting any of them | Not scheduled until confirmed | Expansion 11 |
| 15 | **Source and licence of NotFlux-MCP-main**, used only for the D15 receipt-binding mode. It has no git history; its full stack needs Vertex AI, Kong and AIC; ownership and licence are UNVERIFIED | Use only the HITL pattern | Expansion 12 |
| 16 | **Sensitive material scan.** `postman/` (G8), the `CDN` DaVinci exports and `terraform/` were not scanned for secrets; run the forbidden-string gate before any extraction | Required | Expansion 13 |
| 17 | **Gaps the critic suggested from own knowledge (UNVERIFIED, not catalogued):** a mock PingOne OIDC provider container, a PingOne MFA device/enrollment cleaner for the SE test user, a SaaS app-onboarding (SAML/OIDC federation) demo, a DaVinci flow import/export diff, a Postman-to-live API health check, an ROI / architecture pitch generator tied to verticals. Add any? | None until asked | Critic |

## Facts this plan rests on

- `id-jag-standalone` was on Phase 3A in session 1 (README then said 3B (sign-in, admin rights), the rest of Phase 3, and Phase 4 remain). The PR list read on 2026-10-20 shows `phase-3b-auth-registry` (#4) merged, so that README statement may be stale (UNVERIFIED). It already has Mock, `pf-as`, `pf-pf`, `byo` modes, preflight, resource AS, MCP sample, Inspector, SAML path, interop docs, and a sync script.
- Existing extraction tooling: `scripts/export-edition.js` (manifest-driven, placeholder IDs, forbidden-string gate) and the kit's `sync-to-app.mjs` (vendored files, hash manifest). Both are reusable.
- Existing standalones: `AI-DEMO2/standalone/` (9) and `~/Development/Privilege-standalone` (3).
- Catalog expansion inputs (2026-10-20): [standalone-research/more-demos/](standalone-research/more-demos/): five survey reports and the editor's merged candidate file, before the checkers' corrections. This plan is the corrected version; the candidate file is kept as the record.
- Related notes: edition-split design (`docs/superpowers/specs/2026-10-03-edition-split-design.md`); `planning/cloudflare-hybrid-migration.md`.
- Working rules: worktrees for AI-DEMO2 (the main checkout is shared and gets clobbered); `cmuir_pingcorp` gh account; OrbStack, not Docker Desktop; no redirect logins (pi.flow only); all diagrams ReactFlow.

## Next step

Phase 0.1: pull the 2 pending PRs in `id-jag-standalone` and do the clean-clone baseline, in a worktree.

## Status as of 2026-10-20 (end of session 2: catalog expansion)

Read with `gh` on 2026-10-20.

**`cmuir_pingcorp/id-jag-standalone`:** 37 PRs, 29 merged, 8 open. Merged since session 1: `feat/doctor` (#30), the inspector PRs (#26 to #28), and earlier phase PRs. Open:

| PR | Branch | What |
|---|---|---|
| #29 | `feat/registration` | 0.2: request-and-approve registration (session 1: 2 commits, 375 server + 272 web tests) |
| #31 | `feat/reset` | 0.8: reset CLI + admin route (stacked on registration; independent review: accept with nits) |
| #32 | `feat/story-engine` | 0.5: story engine, talk-track panel, vertical packs, S11 (session 1: 294 web tests) |
| #33 | `fix/local-signin-needs-user` | configure-local-signin requires a first user |
| #34 | `feat/trace-envelope` | Trace envelope: shared hop event, traceparent helper, redaction guard (base item F2) |
| #35 | `feat/content-pack` | Content pack generated from the Learn data (feeds E1) |
| #36 | `feat/setup` | 0.9: setup command, CI hygiene gates, Quickstart README |
| #37 | `ci/pr-node-22-only` | CI: newest Node only on pull requests, both on main |

Known merge friction (from session 1): `feat/reset` edited `server/src/app.js` and `server/src/pfUsers.js` alongside the doctor branch, which is now merged; expect a rebase conflict there.
Not yet verified: registration, doctor PF checks and reset PF user removal have only run against a mocked PingFederate.

**`cmuir_pingcorp/AI-DEMO2`:** the plan and stories PR (#1630) is merged. Related and open: #1640 (Cedar policy demo at `/standalone/cedar`, supports D1 and B3 to B5), #1639 and #1638 (unrelated UI work). The ID-JAG playground fixes #1634 and #1637 are merged. This catalog expansion is on branch `docs/standalone-catalog-expansion` in the plan-docs worktree, committed locally only, not pushed and no PR opened.

Research reports (fact-checked): [standalone-research/](standalone-research/): Cedar, MFA tester, Learning Hub. Survey reports for the expansion: [standalone-research/more-demos/](standalone-research/more-demos/) (the candidate file there is the pre-correction record).
