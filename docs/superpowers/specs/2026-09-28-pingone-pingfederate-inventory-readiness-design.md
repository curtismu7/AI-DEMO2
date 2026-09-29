# PingOne and PingFederate Demo Identity Inventory Readiness Design

**Status:** Design committed for user review

**Scope decision:** Validate demo-owned provider objects from an explicit, checked-in inventory. Do not fail on unrelated objects in a shared tenant unless a source-backed ownership selector classifies them as demo-owned.

## Goal

Before a demo, prove that every PingOne application/AI-agent identity and every PingFederate OAuth client or service-provider profile used by the 46 Demo Steps and 21 separate provider-feature checks exists and has the exact failure-relevant configuration declared by repository sources. An incomplete inventory or unsupported provider readback must keep readiness NOT READY.

This is a read-only readiness check. It does not create, update, delete, enable, or rotate provider objects. Existing, separately approved repair classes remain the only candidates for confirmed repair.

## Current gap

The current PingOne audit enumerates applications and compares application IDs with the declared grant inventory, then checks grants. It does not compare the full application/client profile or enumerate PingOne AI-agent identities. The current PingFederate audit reads OAuth clients and checks declared roles, but the committed role profiles are unresolved and it does not prove that every demo-owned client/profile is represented or read completely. Neither provider audit can yet support a claim that all relevant agent/application configurations are correct.

The PingFederate role file contains ten unresolved roles. The existing readiness guide also records that the production worker identity mapping and supported provider readbacks are incomplete. This work must resolve those source and access gaps or report them as blockers; a live object must never be used as its own source of truth.

## Scope and ownership

The inventory covers every object owned by this demo and used by:

- All 46 executable Demo Steps entries.
- All 21 separately registered provider-feature checks.
- The isolated readiness workers and management clients once their production identity contract exists.

Object families include PingOne applications/OAuth clients, PingOne Agent IAM identities, PingFederate OAuth clients, and any service-provider or supporting provider configuration required by those roles, such as token managers, processor policies, resource URIs, authentication adapters, or ID-JAG settings.

The implementation must discover and document the authoritative repository source for each logical object and property. A secret-free inventory may normalize those sources into stable logical roles, immutable object-ID references or source-backed ownership selectors, exact expected values, and the use cases/features that depend on each object. It must not invent an object name, ID, property, or owner rule. If a provider cannot expose a complete inventory or the repository cannot establish ownership, the result is BLOCKED pending source reconciliation. Unrelated records in shared environments are outside the check only when the ownership contract can distinguish them. For a dedicated demo tenant/instance with an approved exact-set contract, any unexpected object is a failure.

## Expected checks

For each inventory entry, compare only fields that are backed by a committed provisioner, configuration source, or reviewed profile contract. Relevant fields may include:

- Object identity, type, enabled/lifecycle state, ownership, and stable provider ID.
- OAuth/OIDC grant types, response types, redirect URIs, token-endpoint client-authentication method, and protocol settings.
- Allowed resources, audiences, scopes, application grants, access/group assignments, and agent/user/actor bindings.
- For PingFederate roles, the applicable access-token-manager and processor-policy references, service-provider resource URIs, native ID-JAG values, DaVinci adapter/policy association, CIMD and RAR settings, and issuer/JWKS relationships.
- For PingOne Agent IAM, agent lifecycle, owner/actor association, registered OAuth identity, and delegated/downscoped resource permissions when the provider API supports authoritative readback.

Set-valued security properties such as grants, scopes, redirect URIs, audiences, and enabled protocol features are compared using explicit per-role exact-set or allowed-set rules. No general subset comparison is allowed where an extra value could make a demo use an unintended grant, audience, redirect, or resource. Fields that the API omits or masks are not assumed correct. Secret values are never fetched into reports or compared; configuration presence and protocol functionality are proven through separate isolated login/exchange probes. If a credential cannot be functionally proven without an isolated identity, its dependent lane is BLOCKED.

The inventory contract is linked to the case/feature catalog. Contract verification fails if any case or feature references an undeclared identity role, any required role has no expected fields, or a declared inventory entry is unused without an explicit infrastructure-role classification. The identity audit adds provider-object finding rows; it does not silently change or omit the derived 800 scenario rows.

## Provider readback and finding behavior

Provider adapters must enumerate every page, fetch all required object details, respect the shared deadline and cancellation signal, and use supported read-only APIs with least-privilege worker credentials. They must distinguish a complete empty result from an unavailable, unauthorized, truncated, or malformed response.

- **PASS:** complete inventory and detail readbacks match the source-backed contract.
- **FAIL:** a source-backed required object is missing, disabled, duplicated, or has a concrete configuration mismatch; an unexpected object is classified as demo-owned by the approved selector/exact-set contract; or an exact security-sensitive set differs.
- **BLOCKED:** an object cannot be classified, expected source is absent or contradictory, role contract remains unresolved, API permissions/readback are unsupported, or enumeration/detail data is incomplete.
- **NOT RUN:** the shared deadline or cancellation signal expires before a check completes.

Incomplete or empty required inventories can never pass. Errors and report evidence are sanitized; reports contain stable logical role/object references and compared field names, not client secrets, access tokens, passwords, cookies, private keys, or raw provider responses. Mismatch evidence is bounded and redacted.

## Repair boundary and Reset Demo

The identity inventory audit remains read-only. A mismatch in an application, agent, or PingFederate client is manual/release-only until a distinct repairability contract proves an exact repository source, unique object mapping, least-privilege write, idempotency, confirmation binding, and readback. Do not expand the current scope/grant repair allowlist by inference. Admin sidebar Reset Demo continues to withhold cleanup/sign-out when any required identity finding is failed, blocked, or not run. The standalone CLI remains no-write.

## Verification requirements

Focused tests must prove:

1. Every committed inventory role maps to a provider object family, and the union of case/feature dependencies is fully covered.
2. Both providers handle multi-page inventories and details; an incomplete page, denied request, malformed record, or deadline expiry blocks or records NOT RUN instead of passing.
3. Missing, duplicate, misconfigured, disabled, and source-classified unexpected demo-owned objects fail with stable, sanitized evidence.
4. Unrelated objects in a shared tenant do not fail readiness when a reviewed ownership selector excludes them; an ambiguous object blocks until classified.
5. Exact and explicitly allowed set comparisons catch dangerous extra grants/scopes/redirects/audiences without over-checking unrelated mutable metadata.
6. Agent IAM identities, user applications, PF client roles, and role-specific supporting objects are not substituted for one another.
7. No secret-bearing provider fields, raw response bodies, tokens, or credentials appear in result objects, logs, serialized reports, or CLI output.
8. Empty/missing inventories, unresolved source contracts, or unsupported readback cannot yield READY and keep Admin Reset Demo gated.
9. Adapter tests are mocked/offline by default. No live provider, configuration write, Docker Compose, hosted deployment, or reset operation is part of implementation verification.

The implementation task must run the readiness contract check, focused BFF tests, provider inventory fixture tests, `npm run topology:verify`, `npm run authz:verify`, `npm run hygiene:check`, and relevant UI test/build checks if the UI or generated contract changes. Update `docs/demo-readiness.md` in the same implementation commit. Benchmark the expanded full matrix before making any runtime claim; the 12-minute target and 15-minute deadline remain unproven until measured against working isolated identities and targets.

## References

- Existing audit: `demo_api_server/services/demoReadinessAuditService.js`.
- Current PF role contracts: `demo_api_server/config/demoReadinessPingFederateProfiles.json`.
- Case and feature inventories: `demo_api_server/config/demoReadinessInventory.json`, `demo_api_server/config/demoReadinessFeatureChecks.json`, and root `scope-topology.json`.
- PingOne application settings describe redirect URIs, enabled state, application access, and resource scopes: [Creating a web application](https://docs.pingidentity.com/pingone/applications/p1_mfa_creating_a_web_application.html), [Resources](https://docs.pingidentity.com/pingone/applications/p1_resources.html).
- PingOne documents AI agent identities as separately registered, lifecycle-managed OAuth identities: [AI Agents](https://docs.pingidentity.com/pingone/ai_agents/p1_ai_agents.html), [Viewing AI agent identities](https://docs.pingidentity.com/pingone/ai_agents/p1_viewing_ai_agents.html). The implementation must verify the supported Management API endpoints and required permissions for the deployed PingOne version before relying on this readback.
- PingFederate client behavior includes enabled state, redirect URIs, authentication, grant types, and authorization-detail configuration: [Configuring OAuth clients](https://docs.pingidentity.com/pingfederate/12.2/administrators_reference_guide/pf_configuring_oauth_clients.html). The current client inventory read is the PingFederate Admin API; exact fields and pagination must be confirmed against the Admin API schema for the deployed server version.

## Acceptance criteria

- The user reviews and approves this design before an implementation plan or code change begins.
- Every demo-owned identity/application used by a case or feature has an authoritative source, explicit role, complete expected profile, supported complete readback, and tests; unresolved items block.
- The end-to-end runner and Admin Reset Demo cannot report READY while an identity inventory check is missing, incomplete, failed, blocked, or not run.
- No automatic identity/application/agent writes are introduced by this check.
- The master guide documents object coverage, ownership rules, verified fields, blockers, repairs, and validation evidence.
