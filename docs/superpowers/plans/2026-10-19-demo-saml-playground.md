# Real SAML path in the demo ID-JAG playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the demo playground, make the SAML option real for both PingFederate-issued modes (`oauth-mcp` and `pf-pf`): the server signs a SAML 2.0 assertion for the signed-in user and PingFederate trades it for an ID-JAG in one token exchange.

**Architecture:** A small CommonJS port of the kit's `server/src/saml.js` (assertion builder + browser view) plus a `protocol:"saml"` branch of `POST /issue` that exchanges at `settings(mode).idp.tokenEndpoint` with a dedicated SAML client. The signer key pair lives in `ai-demo-secrets` as base64 env vars and is read at call time. A provisioning script adds the trust objects on the issuing PingFederate; the UI gains the kit's OIDC | SAML toggle.

**Tech Stack:** Node/Express (CommonJS) in `demo_api_server`, React in `demo_api_ui`, `xml-crypto` + `@xmldom/xmldom`, jest / vitest.

**Spec:** the kit's design and verified behavior: `/Users/cmuir/Development/id-jag-standalone/docs/superpowers/plans/2026-10-19-kit-saml-playground.md` (kit PR 16), `tools/saml-spike/` (README + `spike.mjs`, `mk-saml.mjs`) and the kit files `server/src/saml.js`, `server/src/__tests__/saml.test.js`, `server/src/__tests__/samlRoutes.test.js`, `pingfederate/configure-saml.js`, `web/src/pages/IdJagPlaygroundPage.jsx` (search "saml"). Decided with the user 2026-10-19: both modes, key as k8s Secret env vars.

## Global Constraints

- Work only in the worktree `/Users/cmuir/Development/AI-DEMO2/.worktrees/demo-saml` (branch `feat/demo-saml`); never the shared checkout.
- The subject is ALWAYS the signed-in session's user; no request field can choose or override it.
- Raw assertions and tokens never leave the server; the browser gets `describeAssertion` output only (digest, signature value, certificate contents replaced by `[…]`).
- Secrets: PEMs only in env / `ai-demo-secrets` (base64 of the PEM, vars `SAML_SIGNING_KEY_PEM_B64`, `SAML_SIGNING_CERT_PEM_B64`) and the client secret `PF_SAML_CLIENT_SECRET`; never printed, logged or committed.
- PingFederate trusts the signer through a CA entry whose id MUST be lower case; the SAML 2.0 token processor must require the Audience; one exchange (assertion -> ID-JAG), not two.
- PingFederate writes on the shared SE PingFederate and `kubectl` changes on SE are done by the user (the auto-mode classifier blocks them): the script and commands are handed over, not run by the agent.
- Commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; PR body ends with the Claude Code line. No purple in UI, Ping brand colors (existing page CSS).
- Diagram / demo / Learning Hub stay a synced trio: check the playground diagrams (`demo_api_ui/src/utils/idJagPlaygroundDiagrams.js`) for the SAML mode and the Hub card text before finishing.

## Review Focus

- SAML requested in `byo` mode, or with no PingFederate sign-in: refused with a plain message (`409 saml_unsupported_mode` / `401 sign_in_required`), no exchange attempted.
- Signing material missing or half-set (key without cert, bad base64): `config.saml.available=false` with a plain reason; `/issue` answers `409 saml_not_configured`, never a stack trace.
- A body that tries to set the subject (`{protocol:"saml", subject:"x@y"}`, `email`, `nameId`): ignored; the assertion NameID is the session user's email.
- Session user email missing, containing XML metacharacters, or not an allowed address: refused (`403`) or escaped, never injected raw into XML.
- Clock handling: assertion `NotBefore` backdated 60 s and `NotOnOrAfter` +300 s so small skew with PingFederate does not refuse a fresh assertion.
- PingFederate refusing the exchange (bad signature, wrong audience, untrusted cert): the PF error code and description reach the UI via the existing `id_jag_issue_failed` shape.

---

### Task 1: Assertion module

**Files:**
- Create: `demo_api_server/services/samlAssertion.js`
- Create: `demo_api_server/src/__tests__/samlAssertion.test.js`
- Modify: `demo_api_server/package.json`, lockfile (add `xml-crypto`, `@xmldom/xmldom`, same versions as `tools/saml-spike`)

**Interfaces:**
- Produces: `samlUnavailableReason(env = process.env): string | null`; `buildAssertion({ subject, audience, issuer, nowMs }, env?): string` (signed XML); `describeAssertion(xml): { issuer, nameId, nameIdFormat, audience, issueInstant, notBefore, notOnOrAfter, signature: { algorithm, canonicalization, certSha1 }, xml }`; `signerCertPem(env?): string | null`.

- [ ] **Step 1: Write failing tests** by porting the kit's `saml.test.js` assertions to jest (CommonJS): unique ID per call, `NotBefore` = now-60 s and `NotOnOrAfter` = now+300 s, AudienceRestriction equals the audience, NameID format emailAddress + bearer SubjectConfirmation, signature verifies with the cert (xml-crypto `SignedXml.checkSignature`) and is placed right after `Issuer`, `describeAssertion` masks DigestValue/SignatureValue/X509Certificate, XML metacharacters in `subject` are escaped, `samlUnavailableReason` names the missing/invalid variable (key, cert, bad base64).
- [ ] **Step 2: Run** `cd demo_api_server && ./node_modules/.bin/jest src/__tests__/samlAssertion.test.js --forceExit` and see them fail (module missing).
- [ ] **Step 3: Implement** the four functions in `services/samlAssertion.js` as a CJS port of the kit's `server/src/saml.js` (verified construction from `tools/saml-spike/mk-saml.mjs`); read the PEMs from `SAML_SIGNING_KEY_PEM_B64` / `SAML_SIGNING_CERT_PEM_B64` at call time (base64-decode to PEM).
- [ ] **Step 4: Run** the test file and see it pass.
- [ ] **Step 5: Commit** (`feat(saml): assertion builder for the ID-JAG playground`).

### Task 2: Issue route, config and cert endpoint

**Files:**
- Modify: `demo_api_server/routes/idJagPlayground.js` (`configFor`, `router.post('/issue')`, new `router.get('/saml/cert')`)
- Test: `demo_api_server/src/__tests__/idJagPlaygroundSaml.test.js`

**Interfaces:**
- Consumes: Task 1 (`samlUnavailableReason`, `buildAssertion`, `describeAssertion`, `signerCertPem`); existing `settings(mode)`, `modeOf`, `requirePf`, `pfSignedIn`, `basic`, `decoded`, `ID_JAG_TOKEN_TYPE`.
- Produces: `GET /api/id-jag-playground/config` gains `saml: { available, reason, audience, issuer, supportedModes: ['oauth-mcp','pf-pf'], appSignedIn }`; `POST /issue` with `{protocol:'saml'}` returns the existing issue response plus `assertion: describeAssertion(...)` and `request.body.subject_token_type = urn:ietf:params:oauth:token-type:saml2`; `GET /saml/cert` returns the signer PEM (`application/x-pem-file`) or `404 {error:'saml_not_configured'}`. Env: `SAML_ISSUER` (default `${frontend origin}/saml`), `SAML_AUDIENCE` (default `idJagDemoSamlAud`), `PF_SAML_CLIENT_ID` (default `ai-demo-pf-saml`), `PF_SAML_CLIENT_SECRET`.

- [ ] **Step 1: Write failing tests** (supertest + axios mock like `idJagPlayground.test.js`): for each of `oauth-mcp` and `pf-pf`, `protocol:'saml'` posts ONE form to that mode's `idp.tokenEndpoint` with Basic `PF_SAML_CLIENT_ID:secret`, `subject_token_type=…:saml2`, `requested_token_type=…:id-jag`, `subject_token` = base64url of an assertion whose NameID is `req.session.user.email` (pf-pf: the email claim of the issuer session's ID token); body field `subject:"evil@x.com"` is ignored; `byo` -> `409 saml_unsupported_mode`; unset signer -> `409 saml_not_configured` with the reason; no sign-in -> `401`; PingFederate `invalid_grant` -> `502 id_jag_issue_failed` carrying `pfError`; config block present with `available` true/false; cert endpoint 404/200.
- [ ] **Step 2: Run** the new test file (`--forceExit`) and see it fail.
- [ ] **Step 3: Implement** in `routes/idJagPlayground.js`: `mintSamlIdJag(req)` next to `mintIdJag`, a `saml` branch in `/issue`, the config block, the cert route; the assertion `audience` is `SAML_AUDIENCE`, the exchange `audience`/`resource`/`scope` are the mode's `s.request` values.
- [ ] **Step 4: Run** the new file plus `idJagPlayground*.test.js` and see all pass.
- [ ] **Step 5: Commit** (`feat(saml): protocol saml on /issue for oauth-mcp and pf-pf`).

### Task 3: PingFederate provisioning script

**Files:**
- Create: `scripts/pingfederate/configure-saml-idjag.js` (follow the neighbouring `scripts/pingfederate/configure-*.js` for option parsing and the admin API helper)
- Test: `demo_api_server/src/__tests__/configureSamlIdJag.test.js` (pure helpers only)

**Interfaces:**
- Produces: `node scripts/pingfederate/configure-saml-idjag.js --ns=<ns> [--port=…] [--audience=idJagDemoSamlAud] [--remove]`; idempotent `ok / keep / FAIL` lines; creates a signer key pair if `SAML_SIGNING_*_PEM_B64` are absent (prints the two base64 values ONLY to a 0600 file `deploy-local/saml/signer.env`, never to the terminal), CA `aidemosamlca`, SAML 2.0 token processor `aiDemoSaml` (Audience), exchange policy `aiDemoSamlPolicy` (`subjectTokenType …:saml2`, subject and TOKEN_SUBJECT from `SAML_SUBJECT`), client `ai-demo-pf-saml` (token exchange only, policy ref, secret generated and written to `.env` as `PF_SAML_CLIENT_SECRET`), and ONE processor policy mapping for `aiDemoSamlPolicy` on each SP connection the two modes use (`client_id` = the mode's exchange client id so the resource AS's existing binding accepts it; `scope` and `TOKEN_SUBJECT` like the existing mappings). `--remove` deletes those in reverse order and leaves the SP connections otherwise untouched.

- [ ] **Step 1: Discover** the SP connections: list `/idp/spConnections` on the issuing PingFederate (read-only) and record, in this task's commit message, the ids and entity ids used by `oauth-mcp` (entity = `pf_id_jag_audience`) and `pf-pf` (entity = the local PF issuer).
- [ ] **Step 2: Write failing tests** for the pure helpers: building the processor-policy mapping from an existing mapping (copy shape, swap the policy ref, keep `scope`), skipping when already present, lower-case CA id.
- [ ] **Step 3: Implement** the script on top of those helpers, modelled on the kit's `pingfederate/configure-saml.js`. **First verify the kit script end to end against a PingFederate** (it was never confirmed by the previous agent) by running it against the kit PF's `--remove`/re-add cycle only if the user approves; otherwise rely on `tools/saml-spike/spike.mjs` shapes.
- [ ] **Step 4: Run** the helper tests and `node --check` on the script; hand the user the exact `kubectl port-forward` + `node …` commands for the SE PingFederate (do not run them).
- [ ] **Step 5: Commit** (`feat(saml): PingFederate provisioning for the SAML ID-JAG path`).

### Task 4: Playground UI

**Files:**
- Modify: `demo_api_ui/src/pages/IdJagPlaygroundPage.jsx`, `demo_api_ui/src/pages/IdJagPlaygroundPage.css` (only if the toggle needs styling), `demo_api_ui/src/utils/idJagPlaygroundMock.js` (config.saml for the mock)
- Test: `demo_api_ui/src/pages/__tests__/IdJagPlaygroundSaml.test.jsx`

**Interfaces:**
- Consumes: Task 2's `config.saml` and `POST /issue {protocol:'saml'}` response (`assertion`).
- Produces: an OIDC | SAML segmented toggle (disabled with the server's `reason` when `!config.saml.available` or the mode is `byo`), the SAML step view showing `assertion` (pretty XML, masked) in the issue step, remembered in `localStorage` like the kit's `PROTOCOL_KEY`.

- [ ] **Step 1: Write failing vitest tests**: toggle disabled with the reason when unavailable; enabled in `oauth-mcp` and `pf-pf`; choosing SAML makes "Request ID-JAG" post `{protocol:"saml"}`; the assertion view shows `[…]` for masked fields and no raw signature; switching to `byo` disables it.
- [ ] **Step 2: Run** `cd demo_api_ui && ./node_modules/.bin/vitest run src/pages/__tests__/IdJagPlaygroundSaml.test.jsx` and see it fail.
- [ ] **Step 3: Implement** by porting the kit page's `PROTOCOLS`, `SAML_REAL_NOTE`, `pickProtocol`, `realSaml` logic and its assertion panel into the demo page (read the kit file's SAML lines first; keep existing demo markup otherwise).
- [ ] **Step 4: Run** the new test and the existing `IdJagPlayground*.test.jsx` suites and see all pass.
- [ ] **Step 5: Commit** (`feat(saml): OIDC | SAML toggle and assertion view in the playground`).

### Task 5: Secrets, deployment wiring and docs

**Files:**
- Modify: `k8s/03-secrets.yaml.template` (add `SAML_SIGNING_KEY_PEM_B64`, `SAML_SIGNING_CERT_PEM_B64`, `PF_SAML_CLIENT_SECRET`, empty), `k8s/create-secrets.sh` if it enumerates keys, `demo_api_server/.env.example`, the PingFederate ID-JAG docs page / Learn text that says SAML is mock only (`docs/` and `demo_api_ui/src/pages/PingFederateIdJagImplementationPage.jsx` search "SAML"), `docs/superpowers/` handoff mention.
- Check: `k8s/20-api-server-deployment.yaml` already loads `ai-demo-secrets` via `envFrom`; if it lists keys explicitly, add the three.

- [ ] **Step 1: Make the edits** above; `git diff --stat` shows only those files.
- [ ] **Step 2: Verify** `kubectl apply --dry-run=client -f k8s/20-api-server-deployment.yaml` parses (read-only) and that no secret value is in any diff (`git diff | grep -c BEGIN` is 0).
- [ ] **Step 3: Commit** (`docs(saml): secrets template, env example and doc text for the SAML path`).

### Task 6: Live verification and hand-off to the user

**Files:** none (evidence in the PR body)

- [ ] **Step 1: Run the full suites**: `cd demo_api_server && ./node_modules/.bin/jest --forceExit`, `cd demo_api_ui && ./node_modules/.bin/vitest run`, `npm run authz:verify` at the root; all green.
- [ ] **Step 2: Open the PR** (CI green first); do not merge until the live check passes.
- [ ] **Step 3: Hand the user, in order**: (a) the provisioning command for the issuing PingFederate, (b) the secret apply, (c) the `set image` deploy commands once images are built and verified in GHCR. Each is a user action.
- [ ] **Step 4: After the user reports (a)-(c) done, verify live** in a browser on SE for both modes: sign in, choose SAML, Request ID-JAG (header `typ oauth-id-jag+jwt`, `sub` = the user's email), Redeem (HTTP 200); check the ID-JAG, not the assertion, is what the Inspect step decodes. Report only what was observed; leave the PR for merge by the agent after green CI.
