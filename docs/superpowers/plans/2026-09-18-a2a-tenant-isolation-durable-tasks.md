# A2A Tenant Isolation and Durable Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue an explicit PingOne tenant claim, enforce tenant ownership on A2A Agent Cards and durable tasks, add authenticated task polling/follow-ups, and fix the Learning Log UI regression.

**Architecture:** PingOne remains the source of tenant identity: the `a2aTenantId` user attribute is projected to the `a2a_tenant_id` access-token claim on every A2A audience resource. The BFF validates that claim with the existing A2A bearer gate, signs public and authenticated Agent Card variants, and stores task records in a dedicated tenant/user-partitioned LMDB database. The existing one-shot in-process and HTTP A2A paths remain supported; streaming and push remain disabled.

**Tech Stack:** Node.js >=22, Express, `@a2a-js/sdk` v1.0, LMDB, Jest, React/Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-18-a2a-tenant-tasks-design.md`

## Global Constraints

- Preserve RFC 8693 actor-chain semantics, audience narrowing, skill allowlists, bearer validation, token custody, and card-signing trust boundaries.
- Never expose bearer tokens, actor tokens, user PII, or raw tenant identifiers in cards, task responses, UI, or logs.
- Missing tenant claims fail closed; cross-tenant or cross-user task access returns 404.
- Do not run live PingOne provisioning/reset scripts during implementation.
- Generated topology/config output must be regenerated with the owning script and verified; never hand-edit generated output.
- UI changes must respect the emoji allowlist and use existing theme tokens; `npm run build` is required.
- Work only in an isolated worktree; stage only intended files.

## File Map

- Create `demo_api_server/services/a2aTenantService.js`: claim constants, verified claim extraction, opaque card handle, and tenant-match helpers.
- Create `demo_api_server/services/lmdb/a2aTaskStore.lmdb.js`: LMDB record schema, tenant/user-scoped reads/writes, TTL pruning, immutable terminal tasks, and redaction.
- Modify `scope-topology.json`: declare `a2a_tenant_id` in the A2A resource claim mappings.
- Modify `demo_api_server/services/pingoneProvisionService.js`: ensure the `a2aTenantId` schema attribute, seed it for demo users, and wire `${user.a2aTenantId}` to A2A resources.
- Modify `demo_api_server/middleware/a2aPingOneBearer.js`: validate and attach the tenant identity after existing checks.
- Modify `demo_api_server/services/a2aAgentCardService.js` and `a2aCardSigningService.js`: build/sign public and authenticated tenant-specific cards without leaking the raw claim.
- Modify `demo_api_server/services/a2aProtocolServer.js`: use the durable task adapter, enforce request/card tenant matching, and expose authenticated polling/follow-up operations.
- Modify `demo_api_server/services/a2aProtocolClient.js`: resolve the authenticated card, echo the opaque tenant handle, and preserve existing signature verification.
- Create focused BFF tests beside existing A2A tests for tenant extraction, task storage, cards, polling, and follow-ups.
- Modify `demo_api_ui/src/components/__tests__/buttonRouting.test.js`: query the current accessible Learning Log label.
- Modify `demo_api_ui/src/pages/A2AProtocolLearningPage.test.jsx`: retain the lesson/link regression coverage already added.

### Task 1: Add the explicit PingOne tenant claim contract

**Files:**
- Modify: `scope-topology.json` A2A resource declarations and claim mappings.
- Modify: `demo_api_server/services/pingoneProvisionService.js` around `_ensureUserSchemaAttribute`, demo-user creation, and Step 37a-A2A resource setup.
- Create: `demo_api_server/services/a2aTenantService.js`.
- Test: `demo_api_server/tests/a2aTenantClaim.test.js`.

**Interfaces:**
- `A2A_TENANT_USER_ATTRIBUTE = 'a2aTenantId'`.
- `A2A_TENANT_CLAIM = 'a2a_tenant_id'`.
- `resolveA2aTenantId(claims) -> string | null` accepts only a non-empty string claim.
- `tenantHandle(tenantId) -> string` returns a deterministic non-reversible handle for card/interface metadata.

- [ ] Write failing tests for valid extraction, missing claim rejection, non-string rejection, stable opaque handles, and claim mapping coverage for every A2A intermediate plus the A2A gateway resource.
- [ ] Run `cd demo_api_server && CI=true npx jest tests/a2aTenantClaim.test.js --forceExit`; confirm it fails because the service and mappings do not exist.
- [ ] Implement the pure tenant service and add the `a2a_tenant_id` mapping alongside existing A2A scope attributes without changing non-A2A mappings.
- [ ] Add idempotent provisioning for `a2aTenantId` as a STRING schema attribute and set the configured environment/organization identifier on `demoUser`, `demoAdmin`, and `demoDelegate` using the existing user PATCH seam.
- [ ] Wire `${user.a2aTenantId}` onto each A2A intermediate and A2A MCP Gateway resource in the existing Step 37a-A2A loop.
- [ ] Run the focused test and `npm run topology:verify`; confirm the mapping is present and no unrelated topology output changes.
- [ ] Commit `feat(a2a): issue explicit tenant claim` with only claim/provisioning files and tests.

### Task 2: Enforce tenant identity on bearer requests and Agent Cards

**Files:**
- Modify: `demo_api_server/middleware/a2aPingOneBearer.js`.
- Modify: `demo_api_server/services/a2aAgentCardService.js`.
- Modify: `demo_api_server/services/a2aCardSigningService.js` only if the signing memoization key needs authenticated-card variants.
- Modify: `demo_api_server/services/a2aProtocolServer.js` card route and request context.
- Modify: `demo_api_server/services/a2aProtocolClient.js` card verification/request tenant handling.
- Test: `demo_api_server/tests/a2aTenantBearer.test.js` and `demo_api_server/tests/a2aTenantCards.test.js`.

**Interfaces:**
- `verifyA2aBearer()` returns existing claims plus `{ tenantId, tenantHandle }` derived from the verified claim.
- `buildSpecialistAgentCard(vertical, cfg, { tenantHandle = null, authenticated = false })` returns the public card by default and adds only the opaque `supportedInterfaces[].tenant` value for authenticated cards.
- `tenantMatches(expectedHandle, requestHandle) -> boolean` rejects absent/mismatched handles.

- [ ] Write failing middleware tests for missing tenant claim (401), valid tenant attachment, and request tenant mismatch (403) while preserving existing actor/audience/scope failures.
- [ ] Run the focused bearer tests and confirm the new assertions fail before implementation.
- [ ] Add tenant extraction after the current signature, issuer, audience, scope, actor-depth, and generalist checks; keep error bodies generic and do not log the raw claim.
- [ ] Write failing card tests for public minimal cards, authenticated cards with opaque tenant metadata, signed-card verification, and no raw tenant leakage.
- [ ] Update card construction/signing to distinguish public and authenticated variants without weakening the existing JWKS/jku pinning.
- [ ] Update the route to keep unauthenticated public discovery working and require the validated bearer for the tenant-specific card response; add `WWW-Authenticate` on missing credentials.
- [ ] Update the in-process and HTTP clients to request/verify the authenticated card when a delegated bearer is present and echo the opaque tenant handle in the A2A request context.
- [ ] Run the focused card/bearer suites plus existing `tests/a2aBearerValidation.test.js`, `tests/a2aCardSigning.test.js`, and `tests/a2aSpecialistRouterContext.test.js`.
- [ ] Commit `feat(a2a): bind agent cards to verified tenant claim`.

### Task 3: Add durable tenant/user-partitioned A2A task state

**Files:**
- Create: `demo_api_server/services/lmdb/a2aTaskStore.lmdb.js`.
- Modify: `demo_api_server/services/lmdb/openEnv.js` only to register/use the new named DB through the existing `getDb()` seam.
- Modify: `demo_api_server/services/a2aProtocolServer.js` request-handler construction and JSON-RPC routes.
- Test: `demo_api_server/tests/a2aTaskStore.test.js` and `demo_api_server/tests/a2aDurableTasks.test.js`.

**Interfaces:**
- `createTask(input) -> sanitizedTask`.
- `getTask(taskId, { tenantId, userSub }) -> sanitizedTask | null`.
- `listContext(contextId, { tenantId, userSub }) -> sanitizedTask[]`.
- `updateTask(taskId, patch, { tenantId, userSub }) -> sanitizedTask`.
- `expireTasks(now = Date.now()) -> number`.
- `isTerminalState(state) -> boolean`.

- [ ] Write failing store tests for tenant/user partitioning, unknown-task null behavior, terminal immutability, same-context follow-up records, bounded expiry, and redaction of token-like fields.
- [ ] Run the store test and confirm it fails because the store does not exist.
- [ ] Implement records keyed by a non-secret composite key and store `tenantId`, `userSub`, `contextId`, `taskId`, `vertical`, specialist identity, state, message, artifacts, timestamps, and expiry.
- [ ] Make all reads and writes require both tenant and user ownership; return null/404 for mismatches without revealing whether a record exists.
- [ ] Implement bounded pruning and preserve terminal records only through the configured TTL; never restart a terminal task in place.
- [ ] Adapt `DefaultRequestHandler` to use a shared task store per specialist/tenant boundary instead of `new InMemoryTaskStore()` per request, while preserving per-request bearer/session/executor context.
- [ ] Persist completed one-shot responses and add authenticated `GET` task polling plus follow-up `message/send` behavior that creates a new task under the same context.
- [ ] Run the store and durable-task tests plus existing A2A executor/router/HTTP suites.
- [ ] Commit `feat(a2a): persist tenant-scoped task state`.

### Task 4: Add UI coverage and fix the Learning Log regression

**Files:**
- Modify: `demo_api_ui/src/components/__tests__/buttonRouting.test.js` at the Learning Log assertion.
- Modify: `demo_api_ui/src/pages/A2AProtocolLearningPage.test.jsx` only if authenticated-card/task status needs explicit coverage.

- [ ] Update the failing query from `/^learning log$/i` to the exact accessible name `/^🪟 Learning Log$/` (or a role query that asserts the current visible label and preserves the project allowlist).
- [ ] Run the focused button-routing test and the A2A learning-page test; confirm both pass.
- [ ] Run `cd demo_api_ui && npm run test:unit && npm run build` and record any failures that are unrelated to these changes.
- [ ] Commit `test(ui): align Learning Log accessibility assertion`.

### Task 5: Integration verification and handoff

**Files:**
- No new production files; update the implementation plan checkboxes and, if needed, the A2A learning lesson status copy.

- [ ] Run focused BFF Jest suites for changed server files with `CI=true ... --forceExit`.
- [ ] Run `npm run topology:verify` and `npm run hygiene:check` if generated/configured routes or topology changed.
- [ ] Run `graphify update .` and inspect the resulting status for unintended changes.
- [ ] Run the UI unit suite and build again after all merges.
- [ ] Inspect `git diff --check`, `git status --short`, and staged paths; ensure unrelated `.gitignore` or plan changes are not staged.
- [ ] Report the required live follow-up: run the approved PingOne bootstrap/reconciliation against the intended environment, then obtain a fresh token and verify `a2a_tenant_id` before enabling tenant-aware cards/tasks.
