# PingFederate ID-JAG Resource Server Skill

## Goal

Create one repository-local skill that guides agents through creating or extending an MCP resource server for the PingFederate native ID-JAG flow, from assertion redemption to downstream access-token validation. Include a README that explains when and how to invoke the skill.

## Repository model

The skill must distinguish three trust checks in the current path:

1. `oauth-mcp` is the authorization server. It accepts the raw PF ID-JAG through its JWT-bearer grant, verifies the assertion, and mints an access token with its own signing key.
2. `demo_mcp_gateway` validates that access token against `oauth-mcp`'s JWKS and enforces its issuer, audience, expiry, and gateway token policy before dispatch.
3. The downstream MCP resource server validates the token it receives for its hop. The active deployment may use a gateway-mediated exchange and PF-issued token here, so the skill must trace the actual issuer and audience instead of assuming that the ID-JAG or `oauth-mcp` token is sent directly to every backend.

The raw ID-JAG is an authorization assertion for the token endpoint; a resource server must not accept it as a bearer access token. The skill should preserve the BFF's server-side token custody and prevent mock or unrelated provider paths from standing in for PF-native issuance.

## Deliverables

Add these files under `.claude/skills/creating-pingfederate-id-jag-resource-server/`:

- `SKILL.md`: concise triggers, workflow, layer routing, and links to focused references.
- `README.md`: human-facing invocation instructions and a prompt example.
- `references/id-jag-redemption.md`: `oauth-mcp` verifier, grant handler, PF issuer/JWKS trust, audience/resource checks, replay handling, and focused verification sources.
- `references/downstream-validation.md`: gateway and MCP resource-server validation, issuer/JWKS selection, audience/scope policy, deployment configuration, and focused verification sources.

The skill applies to new and existing resource-server work. It must tell agents to read root and nearest-service `CLAUDE.md`, `REGRESSION_PLAN.md` sections 0–1, and invoke `regression-guard` before editing protected auth or token paths. PingFederate documentation begins at `https://docs.pingidentity.com/llms.txt` when current product-specific behavior needs confirmation.

## Required guidance

- Trace each token hop and record the issuer, verification JWKS, accepted audience/resource, required scopes, and deployment owner before editing.
- Keep `MCP_SERVER_RESOURCE_URI` (banking MCP authorization server) distinct from `MCP_RESOURCE_SERVER_RESOURCE_URI` (downstream invest resource server).
- Keep issuer strings exactly aligned across BFF, `oauth-mcp`, gateway, and authorization policy configuration; a scheme mismatch changes trust selection.
- Verify signatures against the issuer's own keys. An unverified `iss` may select a key source but never establishes trust.
- Keep ID-JAG type, signature algorithm, issuer, audience, timestamps, resource allowlist, and single-use `jti` checks fail-closed. Document that replay protection is process-local unless a shared store is configured.
- Preserve ordinary PingOne/PF behavior, gateway policy checks, and server-side token custody. Never log or expose assertions, access tokens, or secrets.
- Separate repository code/config edits from live PingFederate provisioning. Do not mutate shared PF state unless the user explicitly requests that operation.
- Use scoped service builds/tests and topology verification when resource IDs, scopes, or routes change. Do not assume this documentation authoring task itself changes runtime behavior.

## Out of scope

- Changing service code, Compose/Kubernetes wiring, PingFederate profiles, or live OAuth clients as part of adding the skill.
- Treating raw ID-JAG as a resource-server bearer token.
- Creating separate skills for the two layers; one invocation should preserve the end-to-end contract.

## Acceptance criteria

- The skill entrypoint describes when it applies without loading both layer references unconditionally.
- Each reference names the actual service boundary and points to current implementation and test files.
- The README explains how to invoke the skill and what target resource, audience, scopes, and provisioning intent to include in a request.
- Guidance does not imply that the current downstream service receives the raw ID-JAG or that all downstream tokens use the same issuer/JWKS.
- Skill implementation adds only the four files listed under Deliverables; no service/config code changes are made. This design document is a workflow artifact for review.
