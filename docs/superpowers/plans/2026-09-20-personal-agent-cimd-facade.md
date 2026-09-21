# Personal Agent CIMD Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run the existing mocked CIMD registration for the PDF-aligned Consumer & Partner Agent path, expose truthful registration evidence in the Agent Builder, and keep the final RFC 8693 path real PingOne-backed for the separate Workload Agent: Digital Assistant path.

**Architecture:** Keep the PDF distinction between Personal Agents and Workload Agents. Personal/Consumer & Partner Agents use dynamic CIMD registration and Authorization Code delegation; Workload Agents such as the Digital Assistant are pre-registered and use their own PingOne identity with RFC 8693 OBO/token exchange. The current PingOne `AI_AGENT` implementation is therefore named and demonstrated as `Workload Agent: Digital Assistant`, not as a CIMD Personal Agent. Add a BFF-owned, user-scoped CIMD facade only for the Personal/Consumer & Partner lane, while preserving the existing real PingOne-backed workload-agent invocation.

**Tech Stack:** Node.js/CommonJS, Express, Jest, LMDB-backed services, React/Vite/Vitest.

**Spec:** User-approved chat design in the 2026-09-20 conversation.

## Global Constraints

- PingOne remains the issuer and actor identity for the final Workload Agent: Digital Assistant RFC 8693 exchange.
- CIMD/DCR behavior is explicitly mock-only because PingOne does not support it.
- Use the maturity-model taxonomy: Employee Personal Agent, Consumer & Partner Agent, Workload Agent (Digital Assistant/Digital Worker), and SaaS-Embedded Agent.
- Do not represent the Digital Assistant as merely a UI channel; it is a Workload Agent with a unique pre-registered identity acting OBO for the user.
- Do not represent the server-side PingOne `AI_AGENT` as a CIMD Personal Agent; its current implementation belongs to the Workload Agent: Digital Assistant lane.
- CIMD metadata must not expose client secrets or user OAuth tokens.
- Keep existing Agent Builder ownership checks and lifecycle events intact.
- UI changes must preserve the repository emoji allowlist and pass `npm run test:unit && npm run build`.
- Work only in the isolated worktree and stage intended paths explicitly.

## PDF-aligned CIAM use-case plan

The reference architecture is `ID4AI - Maturity Model - Architecture 501`,
especially the four-agent taxonomy and the Personal Agent versus Workload Agent
delegation distinction.

| Plan name | Reference architecture name | Registration/delegation | Demo emphasis |
| --- | --- | --- | --- |
| Employee Personal Agent | Employee Personal Agent | Dynamic CIMD; Authorization Code | Native/browser/coding agent on a user device |
| Consumer & Partner Agent | Consumer & Partner Agent | Dynamic CIMD; user delegation | Customer-facing digital channel / new front door |
| Workload Agent: Digital Assistant | Workload Agent: Digital Assistant | Pre-registered PingOne identity; RFC 8693 OBO | Assistant acts for the authenticated user |
| Workload Agent: Digital Worker | Workload Agent: Digital Worker | Unique workload identity; client credentials/token exchange | Autonomous enterprise workload |
| SaaS-Embedded Agent | SaaS-Embedded Agent | Vendor/application-managed identity | Future optional lane |

The current Agent Builder implementation is mapped to **Workload Agent:
Digital Assistant** because it creates a real PingOne `AI_AGENT` and uses RFC
8693. The CIMD facade is retained as a registration demonstration for the
Consumer & Partner Agent lane, but must not be used as evidence that the
workload-agent registration is CIMD-native.

Follow-on implementation tasks:

- [ ] Add explicit catalog entries named `Consumer & Partner Agent` and `Workload Agent: Digital Assistant`.
- [ ] Map existing UC38/Agent Builder CIMD evidence to the Consumer & Partner Agent registration story only where the facade is shown.
- [ ] Map UC1, UC6, UC7, UC8, UC22, and UC26 to the Workload Agent: Digital Assistant OBO story.
- [ ] Map UC2, UC2.5, UC2.6, UC2.7, UC3, UC4, and UC13 to the Workload Agent multi-agent delegation story.
- [ ] Keep UC-NHI1 and UC-NHI2 cross-cutting across all workload-agent identities rather than duplicating them per agent type.
- [ ] Add UI labels that distinguish `CIMD registration` from `PingOne workload-agent identity` and `RFC 8693 delegation`.

### Task 1: Define the user-scoped CIMD registration contract

**Status:** Complete — focused service/store tests pass, including retry, cleanup, and safe-name behavior.

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

**Status:** Complete — focused Agent Builder tests pass, including CIMD cleanup on delete and upgrade.

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

**Status:** Complete — focused registry/UI tests pass and the UI build passes; Digital Assistant naming is aligned in the navigation and studio.

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

**Status:** Complete — the worktree dependency paths were repaired using the
existing local dependency trees; focused BFF/UI tests, UI build, use-case
checks, `authz:verify`, and `topology:verify` pass. One Supertest route suite
remains sandbox-limited because local socket binding returns `EPERM`.

**Files:**
- No new production files.

- [ ] **Step 1: Run focused BFF tests for the four changed service/route areas.**
- [ ] **Step 2: Run UI unit tests and build.**
- [ ] **Step 3: Run `npm run topology:verify` and `npm run authz:verify` if generated routes or use-case metadata changed.**
- [ ] **Step 4: Run `graphify update .` from the worktree.**
- [ ] **Step 5: Inspect `git diff`, confirm only intended paths are staged, and report evidence without claiming live PingOne verification unless the configured stack was exercised.**

### Task 6: Make the Digital Assistant operator flow real

**Status:** Complete — inline and pop-out Digital Assistant clients use the
real `/api/agent/invoke` route with `workload-digital-assistant-obo`; the legacy
`personal-agent-concierge` slug remains accepted for compatibility. See the
operator sequence in [`docs/use-cases/ciam-agent-types-demo.md`](../../use-cases/ciam-agent-types-demo.md).

### Current execution note

The PDF-aligned catalog entries and generated use-case docs are now implemented:
`UC43` is Consumer & Partner Agent CIMD registration and `UC44` is Workload
Agent: Digital Assistant OBO. Existing `UC38` remains the concrete airlines
concierge scenario but is named as a Workload Agent: Digital Assistant flow;
its legacy `useCaseId` remains unchanged for runtime compatibility.
