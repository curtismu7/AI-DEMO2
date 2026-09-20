# Direct A2A Federated Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose LangChain's A2A endpoint directly to multiple allowlisted customer IdPs while preserving the existing PingOne Privilege transaction-token path.

**Architecture:** Add a tenant-aware bearer validator with per-issuer JWKS configuration and a common validated caller context. Update the A2A Agent Card and public route configuration to advertise each tenant's OAuth/OIDC metadata, while preserving Privilege as a separate compatibility branch and keeping internal LangChain/MCP surfaces private. The existing PingOne/Privilege MCP gateway broker is not reused as a general federation broker because it issues a different audience.

**Tech Stack:** Python 3.11+/3.12/3.13, FastAPI, PyJWT, httpx, pytest, Kubernetes YAML, existing LangChain/LangGraph runtime.

**Spec:** `docs/superpowers/specs/2026-09-19-direct-a2a-federated-auth-design.md`

## Global Constraints

- The BFF remains the browser-token custodian; LangChain receives only the credentials required by its own direct A2A contract.
- Never accept tenant, issuer, subject, audience, or privilege claims from JSON-RPC payloads or untrusted headers.
- Keep Privilege `txn-token` validation and routing working exactly as a separate compatibility path.
- No public exposure of health, status, metrics, MCP inspector, internal `/run`, or MCP credentials.
- Fail closed when no tenant trust record or accepted audience is configured.
- Run focused LangChain pytest checks and rendered Kubernetes/topology checks before claiming completion.

## File map

- Create `langchain_agent/src/authentication/federated_token_validator.py`: tenant registry model, configuration parsing, per-issuer JWKS cache, and validated identity result.
- Modify `langchain_agent/src/config/settings.py`: expose federated registry, A2A audience/scope, and public URL settings through the existing configuration SSOT.
- Modify `langchain_agent/src/api/a2a_handler.py`: standard bearer authentication, Privilege compatibility dispatch, common caller context, and per-tenant Agent Card OAuth declarations.
- Modify `langchain_agent/src/main.py`: initialize the A2A auth configuration from settings without changing MCP credential custody.
- Create `langchain_agent/tests/test_federated_token_validator.py`: registry and validation tests with isolated tenant JWKS fixtures.
- Modify `langchain_agent/tests/test_a2a_handler.py`: Agent Card, bearer, scope, identity-partitioning, and Privilege compatibility tests.
- Modify `langchain_agent/tests/test_config_settings.py`: configuration parsing and fail-closed tests.
- Modify `k8s/40-agent-service-deployment.yaml`, `k8s/02-configmap.yaml`, and the applicable public ingress/config: route and environment wiring, with no public internal endpoints.
- Create or update external-client documentation under `langchain_agent/docs/`: direct A2A OAuth setup, tenant registration, token claims, examples, and Privilege compatibility.

### Task 1: Federated tenant configuration and token validator

**Files:**
- Create: `langchain_agent/src/authentication/federated_token_validator.py`
- Modify: `langchain_agent/src/config/settings.py`
- Test: `langchain_agent/tests/test_federated_token_validator.py`
- Test: `langchain_agent/tests/test_config_settings.py`

**Interfaces:**
- Produces `TenantTrustRecord`, `FederatedCaller`, `FederatedTenantRegistry`, and `FederatedTokenValidator.validate(token) -> FederatedCaller`.
- Consumes existing `PingOneConfig`/settings values only for defaults and does not replace the existing Privilege validator.

- [ ] Write tests for two tenants, exact issuer matching, audience/scope checks, missing configuration, malformed duplicate records, and separate JWKS cache behavior.
- [ ] Run `pytest langchain_agent/tests/test_federated_token_validator.py langchain_agent/tests/test_config_settings.py -q` and verify the new tests fail for missing symbols/behavior.
- [ ] Implement strict registry parsing from one JSON setting, exact issuer lookup, configured-JWKS-only retrieval, bounded HTTP/JWKS behavior, RS256/expiry/issuer/audience/scope checks, and sanitized caller identity.
- [ ] Re-run the focused tests and verify all pass.
- [ ] Run the existing token-validator tests to prove current PingOne validation behavior is unchanged.
- [ ] Commit `feat: add federated A2A token validation`.

### Task 2: Direct A2A authentication and Agent Card contract

**Files:**
- Modify: `langchain_agent/src/api/a2a_handler.py`
- Modify: `langchain_agent/src/main.py`
- Test: `langchain_agent/tests/test_a2a_handler.py`

**Interfaces:**
- Consumes `FederatedTokenValidator`, `FederatedCaller`, and existing `validate_privilege_transaction_token`.
- Produces `Authorization: Bearer` support on `/a2a/jsonrpc`, a shared internal caller context, and Agent Card `securitySchemes`/`securityRequirements` fields.

- [ ] Add failing tests for a valid federated bearer, unknown issuer, wrong scope, tenant-header spoofing, and preservation of Privilege `txn-token` requests.
- [ ] Run the focused A2A tests and verify the new cases fail before implementation.
- [ ] Implement a standard bearer branch with 401/403 behavior, keep the `txn-token` branch explicit, derive session partitioning from validated identity, and ensure no credential/claims are echoed.
- [ ] Update the public Agent Card to advertise direct URL, OAuth metadata URL, scope, and JSON-RPC interface without advertising internal routes.
- [ ] Add tenant OAuth/OIDC metadata to the Agent Card; do not add an unauthenticated token minting shortcut or reuse the MCP gateway broker.
- [ ] Re-run focused A2A tests and the existing A2A handler suite.
- [ ] Commit `feat: secure direct LangChain A2A access`.

### Task 3: Public Kubernetes route and runtime configuration

**Files:**
- Modify: `k8s/40-agent-service-deployment.yaml`
- Modify: `k8s/02-configmap.yaml`
- Modify: the existing public ingress/config file that owns the LangChain public host/path
- Test: existing Kubernetes/config/topology checks plus a focused manifest test if no suitable test exists

**Interfaces:**
- Consumes the A2A route and environment contract from Tasks 1–2.
- Produces public Agent Card/OAuth/A2A routing and private health/status/metrics/inspector/internal MCP routing.

- [ ] Add a manifest regression assertion for the exact public paths and prohibited internal paths.
- [ ] Run the manifest assertion before edits and confirm it fails for the missing public route.
- [ ] Wire the tenant registry, audience, scope, public URL, and per-tenant OAuth metadata through the approved ConfigMap/Secret path.
- [ ] Add only the dedicated HTTPS A2A route, preserving the existing Privilege route and proxy timeouts; do not expose a new broker path.
- [ ] Run `npm run topology:verify` and the focused Kubernetes/config checks.
- [ ] Commit `feat: expose federated LangChain A2A ingress`.

### Task 4: External-client documentation and end-to-end contract checks

**Files:**
- Create or modify: `langchain_agent/docs/DIRECT_A2A_OAUTH.md`
- Test: direct A2A contract tests and existing LangChain integration tests

**Interfaces:**
- Documents the public Agent Card URL, tenant metadata URLs, tenant registration fields, token claims, OAuth/PKCE flow, direct bearer example, A2A `message/send` example, errors, and Privilege compatibility.

- [ ] Add documentation tests or deterministic examples that match the implemented URLs, scope, headers, and JSON-RPC shape.
- [ ] Run focused contract tests and verify the documentation examples fail if they drift from the implementation.
- [ ] Document that customer issuers must be pre-allowlisted and that arbitrary issuer selection is rejected.
- [ ] Document the internal-vs-public route boundary and the no-token-echo guarantee.
- [ ] Run the LangChain curated and full pytest commands appropriate to touched surfaces.
- [ ] Commit `docs: document direct federated A2A clients`.

### Task 5: Full verification, PR, merge, and local deployment

- [ ] Run `git diff --check`, focused LangChain tests, `bash langchain_agent/scripts/run-pytest.sh`, `npm run topology:verify`, and relevant hygiene/authz checks.
- [ ] Review `git diff` and `git status`; stage only intended paths.
- [ ] Push `codex/direct-a2a-federated-auth` and open a PR with the test evidence and deployment scope.
- [ ] Wait for required PR checks; address failures with fresh verification.
- [ ] Merge the PR using the repository's normal GitHub workflow.
- [ ] Sync the shared main checkout with `scripts/sync-main-checkout.sh` after merge.
- [ ] Deploy only to local Docker using the repository's worktree-serving/deploy flow; do not deploy to the remote SE/Kubernetes cluster without an explicit target override.
- [ ] Verify live Agent Card, OAuth metadata, direct A2A authentication, and Privilege access, pinning the stack generation before and after any browser/live-stack validation.
