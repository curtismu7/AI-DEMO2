# SPIFFE P1 Mock Workload Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the demo's P1 SPIFFE/SPIRE implementation a truthful, testable parity mode that exercises SVID issuance, trust-bundle verification, workload identity selection, and RFC 8693 actor-token exchange without claiming real SPIRE attestation.

**Architecture:** Keep the current RS256 cryptography and trust-bundle flow, but put a small mock Workload API/registration layer in front of the issuer. A workload receives a short-lived JWT-SVID only when its configured mock selector matches a registered workload; verifiers continue to fail closed on signature, issuer, audience, expiry, trust-domain, and trust-bundle failures. The issuer and selector store are intentionally replaceable by a future SPIRE Workload API adapter.

**Tech Stack:** Node.js >=22, CommonJS, Express, `jsonwebtoken`, Jest, existing `demo_api_server` and `demo_authz_server` services, Docker Compose for local execution.

**Spec:** `docs/SPIFFE_PLAN.md` (especially the PingOne constraint, Phase A/B foundation, and Phase C/D boundaries)

## Global Constraints

- This is P1 parity mode, not real workload attestation: possession of a mock workload registration must never be described as proof that a container, pod, process, or node was attested.
- The default must remain safe and backwards-compatible: `ff_spiffe_actor_token` is off unless explicitly enabled, and ordinary access-token actor-token exchange remains unchanged.
- Verifiers must fail closed if the trust bundle is empty, malformed, unavailable, expired, signed by an unknown key, or outside the configured trust domain.
- Do not make PingOne Cloud accept a SPIRE JWT-SVID; PingOne Cloud does not provide the external-issuer trust boundary required for that flow. The RFC 8693 SVID actor-token path belongs to the local parity authorization server and represents PingFederate behavior.
- Do not add a SPIRE server, SPIRE agent, `spiffe-helper`, Kubernetes workload-entry resources, or mTLS deployment in this P1 plan. Those belong to the later real-runtime phase.
- Preserve the existing `/api/demo/spiffe/jwks`, `/api/demo/spiffe/verify`, `demo_authz_server/spiffeActorToken.js`, and ordinary token-exchange behavior unless a test proves the current contract is wrong.
- No new external dependency is required. Use the existing `crypto`, `jsonwebtoken`, `axios`, Express, and Jest packages.
- Keep the current trust-domain default and existing configurable paths: `bxfinance.demo` for workload-client configuration and `demo.local` for the local playground issuer unless the implementation first reconciles those values deliberately.
- Run focused tests for touched services; do not claim completion without fresh output and without checking the plan's explicit verification commands.

---

## Current Baseline and Target

The repository already contains much of the P1 cryptographic foundation:

- `demo_api_server/services/spiffeTrustDomain.js` creates an in-process RSA keypair, signs five-minute JWT-SVIDs, publishes a public JWK, and verifies RS256, issuer, expiry, and SPIFFE-ID trust-domain constraints.
- `demo_api_server/routes/spiffeDemo.js` exposes the educational `/svid`, `/jwks`, and `/verify` routes.
- `demo_authz_server/spiffeActorToken.js` fetches the BFF JWKS over HTTP, caches it briefly, and fails closed when it cannot verify a JWT-SVID.
- `demo_authz_server/routes/token.js` already has a flag-gated `urn:ietf:params:oauth:token-type:jwt` actor-token branch.
- `demo_api_server/services/spiffeWorkloadClient.js` reads file-backed SVID/key/bundle material for the future `spiffe-helper` path.

The P1 work therefore hardens and names the mock boundary rather than recreating the cryptography. The completed P1 flow must be:

```text
registered mock workload + matching selector
        ↓
mock Workload API / SVID issuer
        ↓
short-lived RS256 JWT-SVID
        ↓
JWKS-backed verifier
        ↓
local RFC 8693 actor-token exchange
        ↓
delegated token with act.sub = spiffe://<trust-domain>/<workload>
```

The P1 flow must reject a caller that merely supplies an arbitrary `spiffe_id` without a matching mock registration. That is the boundary that makes the mock useful while keeping the limitation explicit.

## File Map

- Create: `demo_api_server/services/mockSpiffeWorkloadApi.js` — in-memory P1 registration and selector-matching boundary; no HTTP socket and no secret storage.
- Modify: `demo_api_server/services/spiffeTrustDomain.js` — expose the issuer/verification primitives through the mock adapter without changing the existing cryptographic contract.
- Modify: `demo_api_server/routes/spiffeDemo.js` — make `/svid` request a registered mock workload identity rather than trusting an arbitrary caller-supplied SPIFFE ID; preserve `/jwks` and `/verify` response shapes.
- Modify: `demo_api_server/services/configStore.js` and `demo_api_server/routes/featureFlags.js` only if the chosen flag needs a BFF-visible configuration entry; do not duplicate an existing flag registration.
- Modify: `demo_authz_server/spiffeActorToken.js` only where needed to make the trust-bundle URL, issuer, audience, and key-rotation behavior explicit and testable.
- Modify: `demo_authz_server/routes/token.js` only where needed to keep the SVID actor-token branch behind its existing flag and to bind the exchanged actor identity to the verified SVID subject.
- Create: `demo_api_server/tests/mockSpiffeWorkloadApi.test.js` — selector registration and issuance contract.
- Modify: `demo_api_server/tests/spiffeDemo.test.js` — route-level registration, rejection, rotation, and trust-domain cases.
- Modify: `demo_authz_server/spiffeActorToken.test.js` and `demo_authz_server/token.spiffeActor.test.js` — trust-bundle and actor-token regression coverage.
- Modify: `docs/SPIFFE_PLAN.md` — mark the P1 parity boundary and the real-SPIRE work that remains.
- Modify: `demo_api_ui/src/components/education/SpiffePanel.js` and its tests — use “P1 parity mode” language and distinguish cryptographic verification from workload attestation.

## Task 1: Define the mock Workload API contract

**Files:**
- Create: `demo_api_server/services/mockSpiffeWorkloadApi.js`
- Create: `demo_api_server/tests/mockSpiffeWorkloadApi.test.js`

**Interfaces:**
- Produces `registerWorkload({ workloadId, spiffeId, selectors }) -> { workloadId, spiffeId, selectors }`.
- Produces `clearRegistrations() -> void` for test isolation.
- Produces `issueJwtSvid({ workloadId, selectorContext, audience }) -> string`.
- Produces `listRegistrations() -> Array<{ workloadId, spiffeId, selectors }>` for diagnostics/tests only.
- Consumes `spiffeTrustDomain.issueSvid(spiffeId, { audience })`.

- [ ] **Step 1: Write failing registration and selector tests.**

  Cover:

  ```js
  const mock = require('../services/mockSpiffeWorkloadApi');

  beforeEach(() => mock.clearRegistrations());

  test('issues only for a registered workload whose selectors match', () => {
    mock.registerWorkload({
      workloadId: 'api',
      spiffeId: 'spiffe://demo.local/service/api',
      selectors: { namespace: 'demo', serviceAccount: 'api' },
    });

    expect(() => mock.issueJwtSvid({
      workloadId: 'api',
      selectorContext: { namespace: 'demo', serviceAccount: 'api' },
      audience: 'demo.local',
    })).not.toThrow();
  });

  test('rejects an unknown workload and a selector mismatch', () => {
    expect(() => mock.issueJwtSvid({
      workloadId: 'api',
      selectorContext: { namespace: 'demo', serviceAccount: 'api' },
      audience: 'demo.local',
    })).toThrow(/not registered/);
  });

  test('rejects a registration outside the configured trust domain', () => {
    expect(() => mock.registerWorkload({
      workloadId: 'evil',
      spiffeId: 'spiffe://other.example/service/evil',
      selectors: { namespace: 'demo', serviceAccount: 'evil' },
    })).toThrow(/trust domain/);
  });
  ```

- [ ] **Step 2: Run the focused test to verify it fails.**

  Run: `cd demo_api_server && CI=true npx jest tests/mockSpiffeWorkloadApi.test.js --forceExit`

  Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the smallest in-memory adapter.**

  Store registrations in a module-local `Map`. Require non-empty `workloadId`, a SPIFFE ID accepted by `spiffeTrustDomain.isSpiffeId`, and a non-empty selector object. Match every configured selector key/value exactly against `selectorContext`; do not support wildcards or partial matching in P1. On success, call `spiffeTrustDomain.issueSvid` and return only the signed token. Never accept a caller-provided private key or signing key.

- [ ] **Step 4: Run the focused test to verify it passes.**

  Run: `cd demo_api_server && CI=true npx jest tests/mockSpiffeWorkloadApi.test.js --forceExit`

  Expected: PASS.

- [ ] **Step 5: Commit the contract and adapter.**

  ```bash
  git add demo_api_server/services/mockSpiffeWorkloadApi.js demo_api_server/tests/mockSpiffeWorkloadApi.test.js
  git commit -m "feat(spiffe): add registered mock workload identity adapter"
  ```

## Task 2: Route the playground through the mock boundary

**Files:**
- Modify: `demo_api_server/routes/spiffeDemo.js`
- Modify: `demo_api_server/tests/spiffeDemo.test.js`

**Interfaces:**
- `POST /api/demo/spiffe/svid` consumes `{ workload_id, selector_context, audience? }` and returns the existing `{ svid, svid_type, trust_domain }` shape.
- `GET /api/demo/spiffe/jwks` remains the public-key bundle endpoint.
- `POST /api/demo/spiffe/verify` remains the verification endpoint and response shape.

- [ ] **Step 1: Add failing route tests for the new request contract.**

  Register a known workload in test setup, then assert:

  - matching `workload_id` and `selector_context` return 200;
  - unknown workload returns 403 with a stable `workload_not_authorized` error;
  - mismatched selectors return 403 with the same error;
  - an arbitrary `spiffe_id` field is ignored or rejected and cannot mint a token;
  - existing verification tests still reject tampered, expired, wrong-issuer, and foreign-domain tokens.

- [ ] **Step 2: Run the route test before implementation.**

  Run: `cd demo_api_server && CI=true npx jest tests/spiffeDemo.test.js --forceExit`

  Expected: the new authorization tests fail against the current arbitrary-ID `/svid` route; existing cryptographic tests remain green.

- [ ] **Step 3: Replace arbitrary-ID issuance with adapter issuance.**

  Import `mockSpiffeWorkloadApi`, validate `workload_id` and `selector_context`, and call `issueJwtSvid`. Map adapter authorization failures to 403 without exposing registration internals. Keep malformed requests at 400. Do not change `/jwks` or `/verify` semantics.

- [ ] **Step 4: Add registration setup without making the public route a registry editor.**

  Seed the fixed P1 demo registrations at module initialization or through a dedicated test/setup helper. Do not add a public registration endpoint; allowing callers to register their own SPIFFE IDs would erase the selector boundary. Use stable examples such as `api`, `mcp-gateway`, and `authz-server`, each with explicit namespace/service-account selectors.

- [ ] **Step 5: Run the route test and commit.**

  Run: `cd demo_api_server && CI=true npx jest tests/spiffeDemo.test.js --forceExit`

  Expected: PASS.

  ```bash
  git add demo_api_server/routes/spiffeDemo.js demo_api_server/tests/spiffeDemo.test.js
  git commit -m "feat(spiffe): issue demo SVIDs through workload selectors"
  ```

## Task 3: Harden the local actor-token exchange contract

**Files:**
- Modify: `demo_authz_server/spiffeActorToken.js`
- Modify: `demo_authz_server/routes/token.js`
- Modify: `demo_authz_server/spiffeActorToken.test.js`
- Modify: `demo_authz_server/token.spiffeActor.test.js`

**Interfaces:**
- `verifySvid(svid) -> Promise<{ valid: boolean, spiffeId: string|null, reason: string|null }>` remains the verifier contract.
- JWT-SVID actor tokens use `actor_token_type=urn:ietf:params:oauth:token-type:jwt`.
- Ordinary `urn:ietf:params:oauth:token-type:access_token` actor tokens continue through the existing path.

- [ ] **Step 1: Add failing tests for audience and identity binding.**

  Add tests that a valid signature with the wrong audience is rejected, a valid SVID from a foreign trust domain is rejected, an unavailable or empty bundle is rejected, and a successful exchange places the exact verified `spiffe://...` subject in `act.sub` rather than a caller-supplied value.

- [ ] **Step 2: Run both authz test files before implementation.**

  Run: `cd demo_authz_server && CI=true npx jest spiffeActorToken.test.js token.spiffeActor.test.js --forceExit`

  Expected: any newly specified audience/binding tests fail while the existing flag-off regression tests remain green.

- [ ] **Step 3: Implement the minimum contract hardening.**

  Pass the expected audience from the token-exchange request/configuration into `jwt.verify`; keep issuer and RS256 pinned. Use only the `spiffeId` returned by `verifySvid` when constructing the delegated token. Return OAuth-compatible `invalid_grant` errors for invalid SVIDs. Leave the flag-off branch and normal access-token branch byte-compatible unless a test requires a response correction.

- [ ] **Step 4: Test key rotation and cache expiry.**

  Use the existing test bundle override to provide a new public key, verify that a cached old bundle behaves as configured, advance or control the cache clock if the module supports it, and verify that the new bundle is accepted after refresh while the old signature is rejected when no longer trusted.

- [ ] **Step 5: Run the focused authz suite and commit.**

  Run: `cd demo_authz_server && CI=true npx jest spiffeActorToken.test.js token.spiffeActor.test.js --forceExit`

  Expected: PASS.

  ```bash
  git add demo_authz_server/spiffeActorToken.js demo_authz_server/routes/token.js demo_authz_server/spiffeActorToken.test.js demo_authz_server/token.spiffeActor.test.js
  git commit -m "test(spiffe): bind local actor exchange to verified SVID identity"
  ```

## Task 4: Make the P1 flag and configuration explicit

**Files:**
- Modify: `demo_authz_server/.env.example` or the service's existing example config file.
- Modify: `docker-compose.yml` only if the authz container does not already receive the flag and trust-bundle settings.
- Modify: `demo_api_server/services/configStore.js` and `demo_api_server/routes/featureFlags.js` only if the BFF UI/config surface needs to expose the flag.
- Test: existing feature/config tests plus `demo_authz_server/token.spiffeActor.test.js`.

**Interfaces:**
- `FF_SPIFFE_ACTOR_TOKEN=false` is the default.
- `SPIFFE_TRUST_DOMAIN` identifies the accepted trust domain.
- `SPIFFE_JWKS_URL` identifies the mock trust-bundle endpoint used by the local authz verifier.

- [ ] **Step 1: Write the configuration regression assertions.**

  Assert that an unset flag rejects JWT-SVID actor tokens, `false` rejects them, and `true` enables only the JWT-SVID branch. Assert that no default compose configuration turns the flag on accidentally.

- [ ] **Step 2: Implement explicit defaults and container wiring.**

  Add only missing example/default entries. Reuse the existing service naming and TLS URL conventions; do not introduce `localhost` OAuth or trust-bundle URLs. Do not expose private signing material through environment variables or Compose.

- [ ] **Step 3: Run the configuration and actor-token tests.**

  Run: `cd demo_authz_server && CI=true npx jest token.spiffeActor.test.js --forceExit`

  Expected: PASS with the flag off by default.

- [ ] **Step 4: Commit the configuration boundary.**

  ```bash
  git add demo_authz_server/.env.example docker-compose.yml demo_api_server/services/configStore.js demo_api_server/routes/featureFlags.js
  git commit -m "chore(spiffe): make P1 parity mode configuration explicit"
  ```

  Stage only files actually changed; omit nonexistent or untouched paths.

## Task 5: Update the teaching surface and phase boundary

**Files:**
- Modify: `docs/SPIFFE_PLAN.md`
- Modify: `demo_api_ui/src/components/education/SpiffePanel.js`
- Modify: `demo_api_ui/src/components/education/__tests__/SpiffePanel.test.jsx`

- [ ] **Step 1: Add failing copy assertions for the P1 boundary.**

  Assert that the panel explains all of the following: the P1 issuer is local/mock, cryptographic verification is real, workload attestation is not real, the local actor-token path models PingFederate behavior, and PingOne Cloud cannot consume a SPIRE SVID as an external actor token.

- [ ] **Step 2: Update the plan and UI copy.**

  In `docs/SPIFFE_PLAN.md`, state that P1 parity mode is implemented/planned separately from real SPIRE. Name the exact later work: SPIRE Server and Agent deployment, workload registration/attestation, `spiffe-helper` or Workload API integration, trust-bundle/OIDC discovery, and mTLS on owned hops. Do not call the P1 route a real SPIRE Workload API.

  In `SpiffePanel.js`, use “P1 parity mode” and “mock issuer” wherever the current text could imply runtime attestation. Keep the existing educational contrast between a signed credential and a static API key.

- [ ] **Step 3: Run UI unit tests and build.**

  Run: `cd demo_api_ui && npm run test:unit && npm run build`

  Expected: PASS and a successful production build. Preserve the repository emoji allowlist and existing theme conventions.

- [ ] **Step 4: Commit the documentation and UI boundary.**

  ```bash
  git add docs/SPIFFE_PLAN.md demo_api_ui/src/components/education/SpiffePanel.js demo_api_ui/src/components/education/__tests__/SpiffePanel.test.jsx
  git commit -m "docs(spiffe): label P1 as cryptographic parity mode"
  ```

## Task 6: Verify the complete P1 path

**Files:**
- No source changes expected; add or adjust tests only if a specific verification step exposes a contract gap.

- [ ] **Step 1: Run the focused BFF SPIFFE tests.**

  ```bash
  cd demo_api_server
  CI=true npx jest tests/mockSpiffeWorkloadApi.test.js tests/spiffeDemo.test.js --forceExit
  ```

  Expected: PASS, including unauthorized selector cases and all forgery cases.

- [ ] **Step 2: Run the focused authz tests.**

  ```bash
  cd demo_authz_server
  CI=true npx jest spiffeActorToken.test.js token.spiffeActor.test.js --forceExit
  ```

  Expected: PASS, including flag-off compatibility, trust-bundle failure closed behavior, audience validation, and `act.sub` identity binding.

- [ ] **Step 3: Run the UI unit suite and build.**

  ```bash
  cd demo_api_ui
  npm run test:unit
  npm run build
  ```

  Expected: both commands exit 0.

- [ ] **Step 4: Run repository topology and hygiene checks if config/routes changed.**

  From the repository root, run:

  ```bash
  npm run topology:verify
  npm run hygiene:check
  ```

  Expected: both commands exit 0. Run `npm run authz:verify` if the route or auth requirement surface changed.

- [ ] **Step 5: Perform one manual proof of the demo boundary.**

  With the flag off, show that the normal token exchange still works and a JWT-SVID actor token is rejected. With the flag on, use a registered workload and matching selector to obtain a SVID, verify it through `/api/demo/spiffe/verify`, and exchange it through the local authz server. Then change one selector, tamper with the SVID payload, and use a foreign trust domain; each must be refused.

- [ ] **Step 6: Review the claims before handoff.**

  Confirm that no changed file, UI label, demo script, or plan says “SPIRE attested” or “production workload identity” for P1. The correct claim is: “P1 demonstrates the cryptographic and token-exchange contract with a local mock issuer; real runtime attestation remains a later phase.”

## Deferred Real-SPIRE Phase

This P1 plan deliberately stops before real workload attestation. The follow-on implementation must replace the mock adapter behind the same conceptual contract:

1. Deploy SPIRE Server and SPIRE Agents in Kubernetes.
2. Register workloads using Kubernetes selectors (namespace, service account, and workload identity labels).
3. Replace in-process signing with the SPIFFE Workload API or `spiffe-helper` output.
4. Publish and consume SPIRE's trust bundle/OIDC discovery instead of the BFF's mock JWKS endpoint.
5. Add X.509-SVID mTLS to service hops owned by the project.
6. Validate the JWT-SVID actor-token flow against PingFederate, not PingOne Cloud.
7. Keep PingOne Cloud's supported client-credential actor-token flow as the production-compatible path where PingFederate is unavailable.

The real-SPIRE phase must not be started by silently changing P1's issuer. It needs its own design and environment-validation plan.
