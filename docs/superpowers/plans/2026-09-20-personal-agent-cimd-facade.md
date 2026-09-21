# Personal Agent CIMD Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run the existing mocked CIMD registration when a user creates a personal PingOne agent, expose truthful registration evidence in the Agent Builder, and keep the final RFC 8693 path real PingOne-backed.

**Architecture:** Add a BFF-owned, user-scoped CIMD facade service. Agent creation remains the existing PingOne `AI_AGENT` flow; after creation, the service creates a non-secret metadata document, invokes the existing local `registerClientByUrl` mock, and persists only the association/provenance needed by the UI and registry. Personal-agent invocation continues to use the PingOne application id for actor credentials and RFC 8693 exchange.

**Tech Stack:** Node.js/CommonJS, Express, Jest, LMDB-backed services, React/Vite/Vitest.

**Spec:** User-approved chat design in the 2026-09-20 conversation.

## Global Constraints

- PingOne remains the issuer and actor identity for the final personal-agent RFC 8693 exchange.
- CIMD/DCR behavior is explicitly mock-only because PingOne does not support it.
- CIMD metadata must not expose client secrets or user OAuth tokens.
- Keep existing Agent Builder ownership checks and lifecycle events intact.
- UI changes must preserve the repository emoji allowlist and pass `npm run test:unit && npm run build`.
- Work only in the isolated worktree and stage intended paths explicitly.

### Task 1: Define the user-scoped CIMD registration contract

**Status:** Complete — focused service and store tests pass.

**Files:**
- Create: `demo_api_server/services/personalAgentCimdService.js`
- Create: `demo_api_server/services/lmdb/personalAgentCimdStore.lmdb.js`
- Test: `demo_api_server/src/__tests__/personalAgentCimdService.test.js`

**Interfaces:**
- Consumes: `{ user, pingoneAgent }` from `agentBuilderService.createAgentForUser`.
- Produces: `registerPersonalAgentCimd(user, pingoneAgent)` returning `{ ok, mocked, clientId, metadataUrl, steps, pingoneAgentId }`; `getPersonalAgentCimd(user)` returning the persisted public-safe association or `null`.

- [ ] **Step 1: Write failing tests** for metadata URL/client_id equality, no secret/token fields, automatic registration through the existing `registerClientByUrl`, persistence, idempotent re-read, and user ownership isolation.
- [ ] **Step 2: Run the focused Jest test and verify it fails because the service/store do not exist.**
- [ ] **Step 3: Implement the minimal LMDB-backed association store and service.** Use a stable user key, a generated metadata URL under `/api/cimd/personal-agents/<opaque-id>/client-metadata.json`, and the existing `oauthClientRegistry.registerClientByUrl` with an injected fetch implementation that returns the service’s generated metadata document. Do not store or return the mock client secret.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Commit** with `feat: add personal agent CIMD facade service`.

### Task 2: Publish the automatic personal-agent metadata document

**Status:** Complete — focused route tests pass.

**Files:**
- Modify: `demo_api_server/routes/cimdAgentMetadata.js`
- Test: `demo_api_server/src/__tests__/cimdAgentMetadata.route.test.js`

**Interfaces:**
- Consumes: metadata lookup by opaque registration id and the existing public route mount.
- Produces: `GET /api/cimd/personal-agents/:registrationId/client-metadata.json` with a public-safe CIMD document.

- [ ] **Step 1: Add failing route tests** for a valid document, `client_id` equal to the document URL, allowed `client_credentials` grant, topology-compatible scope, absent secrets, and unknown id returning 404.
- [ ] **Step 2: Run the focused route test and verify the new cases fail.**
- [ ] **Step 3: Add the route using the service lookup.** Keep existing topology-agent routes unchanged and return `Cache-Control: public, max-age=300`.
- [ ] **Step 4: Run the focused route test and verify it passes.**
- [ ] **Step 5: Commit** with `feat: publish personal agent CIMD metadata facade`.

### Task 3: Trigger CIMD automatically after real PingOne agent creation

**Status:** Complete — focused Agent Builder tests pass.

**Files:**
- Modify: `demo_api_server/services/agentBuilderService.js`
- Modify: `demo_api_server/routes/agentBuilder.js`
- Test: `demo_api_server/src/__tests__/agentBuilderService.cimd.test.js`

**Interfaces:**
- Consumes: the existing `createAgentForUser` result and current session user.
- Produces: Agent Builder state with `agent.cimd` evidence; creation remains successful if the mock CIMD facade fails, but the response must expose a clear `cimd.status` failure rather than claiming registration succeeded.

- [ ] **Step 1: Write failing tests** proving a newly created PingOne agent triggers exactly one mock CIMD registration, returns public-safe evidence, does not replace the PingOne id, and returns the persisted association on subsequent `/state` reads.
- [ ] **Step 2: Run the focused test and verify it fails.**
- [ ] **Step 3: Integrate the service after successful PingOne creation and in the state route.** Preserve idempotency for existing agents and avoid running CIMD on unrelated reference-agent reads.
- [ ] **Step 4: Run the focused test and verify it passes.**
- [ ] **Step 5: Commit** with `feat: run personal agent CIMD facade automatically`.

### Task 4: Surface registration provenance in NHI inventory and Agent Builder UI

**Status:** Complete — focused registry/UI tests pass and the UI build passes.

**Files:**
- Modify: `demo_api_server/services/agentRegistryService.js`
- Modify: `demo_api_ui/src/components/AgentBuilderPage.jsx`
- Test: `demo_api_server/src/__tests__/agentRegistryService.cimd.test.js`
- Test: `demo_api_ui/src/components/__tests__/AgentBuilderPage.cimd.test.jsx`

**Interfaces:**
- Consumes: persisted user-scoped CIMD association keyed by the PingOne agent id.
- Produces: registry rows with `registrationType: 'cimd-facade'`, `registrationStatus`, and `metadataUrl`; Agent Builder renders the automatic mocked CIMD steps and the real PingOne identity separately.

- [ ] **Step 1: Write failing tests** for registry provenance and the UI’s mocked disclosure, metadata URL, and PingOne-backed continuation copy.
- [ ] **Step 2: Run the focused BFF/UI tests and verify the new assertions fail.**
- [ ] **Step 3: Add the read-only provenance fields and the smallest existing-page facade component.** Use plain text/semantic HTML and only allowlisted symbols if any icon is needed.
- [ ] **Step 4: Run focused tests, then `cd demo_api_ui && npm run build`.**
- [ ] **Step 5: Commit** with `feat: show personal agent CIMD provenance in NHI surfaces`.

### Task 5: Verify the protected end-to-end contract

**Status:** Partial — focused checks pass; topology/authz checks are blocked by missing worktree dependencies (`lodash.mergewith`), and the full UI suite did not emit a final result within the bounded run.

**Files:**
- No new production files.

- [ ] **Step 1: Run focused BFF tests for the four changed service/route areas.**
- [ ] **Step 2: Run UI unit tests and build.**
- [ ] **Step 3: Run `npm run topology:verify` and `npm run authz:verify` if generated routes or use-case metadata changed.**
- [ ] **Step 4: Run `graphify update .` from the worktree.**
- [ ] **Step 5: Inspect `git diff`, confirm only intended paths are staged, and report evidence without claiming live PingOne verification unless the configured stack was exercised.**
