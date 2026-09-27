# Security Review — 2026-09-26

## Executive summary

This is a static, repository-based review of the hosted Kubernetes demo deployment and the application paths reachable through it. It covers the BFF, MCP service boundary, CodeGraph proxy, Kubernetes network and pod policy, logging, and release image references. It does not include live cluster probing, penetration testing, dependency advisory scanning, or review of every standalone teaching/lab example in the repository.

The app has meaningful controls: the hosted admission gate is separate from application login, the BFF holds browser tokens, internal agent routes require a shared secret, and hosted deployment rewrites first-party images to commit-tagged registry references. The remaining issues are primarily at the network boundary and in demo-mode configuration.

**Disposition:** the repository now contains mitigations for H-01 and M-01 through M-03. They have not been deployed or exercised against a live cluster. M-04 and the Low findings remain open; immutable image selection and Restricted/egress enforcement need compatibility or external-cluster evidence before promotion. A read-only query of the configured Kubernetes context failed because the EKS API hostname did not resolve.

## High

### H-01 — Direct in-cluster access bypasses MCP gateway authorization

**Evidence:** `k8s/30-mcp-server-deployment.yaml:53-57` sets `MCP_AUTH_DISABLED=true` because the gateway is expected to enforce authorization. The former namespace-wide policy permitted all same-namespace ingress. `k8s/04-network-policies.yaml` now keeps that legacy rule for other pods but excludes `mcp-server`; the MCP public ingress routes ordinary requests through `ping-gateway` (`k8s/aws/se-ingress.yaml:214-220`).

**Impact:** before the repository policy change, any compromised or overly permissive workload in `ai-demo` could connect directly to `mcp-server` and avoid the gateway authorization layer. This path remains possible if the revised NetworkPolicy is not applied, the CNI does not enforce policies, or another cluster policy grants broader access. The MCP server's built-in auth checks remain explicitly disabled.

**Recommendation:** apply and smoke-check the `mcp-server` ingress allowlist for PingGateway, the in-cluster MCP gateway, and the ingress controller's resource-metadata route. Keep the public ingress routed through PingGateway for MCP traffic. The optional manually installed gateway is not in the hosted deployment path; add it explicitly if that changes.

**Confidence / false-positive notes:** high confidence in the manifest-level path. Impact depends on what MCP tools and credentials are enabled at runtime; this review did not exercise the deployed server.

**Repository remediation:** `k8s/04-network-policies.yaml` excludes `mcp-server` from the namespace-wide same-namespace ingress rule and permits ingress only from PingGateway, the in-cluster MCP gateway, and the ingress controller needed for the protected-resource metadata endpoint. Both Kubernetes deploy scripts apply the policy. Existing broad network egress is retained. Live CNI enforcement and MCP smoke behavior remain unverified.

## Medium

### M-01 — Demo-mode `NODE_ENV` disables production session-cookie and secret fail-closed behavior

**Evidence:** `k8s/20-api-server-deployment.yaml:40-47` deliberately sets `NODE_ENV=development` while enabling independent session flags. In `demo_api_server/server.js:537-558`, the session secret startup guard formerly only exited for production/Replit, an unset secret fell back to the committed literal `dev-session-secret-change-in-production`, and the cookie's `secure` attribute was selected from `isProduction`. `SESSION_SECRET` is normally supplied by the generated Kubernetes secret.

**Impact:** before the repository change, an incomplete secret could make session signatures predictable and the non-Secure cookie could be sent over HTTP. Hosted configuration now closes those two paths. If either new deployment flag is removed, the prior risk returns. The TLS ingress and one-hop Express proxy trust support the Secure cookie on the normal public path.

**Recommendation:** preserve simulated Authorize behavior while adding an explicit hosted-deployment security mode that requires a non-default session secret and sets secure cookie attributes behind the TLS-terminating proxy. Configure Express proxy trust narrowly for the known ingress. Add a deployment preflight that verifies the required secret exists without printing its value.

**Confidence / false-positive notes:** high confidence in the configuration behavior; the live secret value and all possible internal HTTP routes were not inspected. This finding is specifically about the fail-open fallback and cookie configuration, not a claim that the current secret is known.

**Repository remediation:** hosted BFF configuration now requires a non-default `SESSION_SECRET` and enables Secure cookies through explicit environment flags while retaining `NODE_ENV=development`. The normal secret source and OAuth/session lifecycle are unchanged. A missing hosted secret will now prevent the BFF from starting; the current running deployment has not been inspected.

### M-02 — Public CodeGraph reindex and query can consume shared compute and model quota

**Evidence:** `demo_api_server/server.js:1504-1507` mounts the CodeGraph query and reindex handlers without application authentication. The BFF proxy adds its internal secret (`demo_api_server/routes/codegraphProxy.js:69-84`), so the FastAPI secret gate does not prevent a caller from using the BFF as a proxy. The handler explicitly documents the feature as public and the indexer as CPU-heavy (`langchain_agent/src/api/codegraph_handler.py:35-38`); reindex launches a subprocess (`:123-130`), and queries use the LLM agent (`:41-57`). The hosted access gate at `demo_api_server/middleware/hostedAccessGate.js:57-65` still restricts these requests to admitted visitors when enabled.

**Impact:** an admitted visitor can still consume shared CPU and provider quota. The repository now limits each client IP to 10 queries per minute and one reindex per five minutes; distributed source IPs and process restarts can evade these process-local limits.

**Recommendation:** retain the implemented per-IP limits and observe their effect during a hosted demo. If multiple admitted visitors behind shared NAT see 429s, adjust the query budget without removing the reindex cooldown; consider building the index during release preparation if reindex abuse remains a concern.

**Confidence / false-positive notes:** high confidence that the routes are intentionally public; this is an availability and cost-control risk, not an accidental authentication omission. The hosted admission gate reduces exposure but is not a per-feature abuse control.

**Repository remediation:** the query endpoint is limited to 10 requests per minute per client IP, and reindex is limited to 1 request per 5 minutes per client IP. The existing public feature and admission gate remain unchanged. Rate limiting is process-local and can be bypassed across multiple source IPs; cluster behavior was not exercised.

### M-03 — OAuth callback authorization codes are recorded in access logs

**Evidence:** `demo_api_server/server.js:502-529` configures the BFF access logger. Previously it used Morgan's `combined` format, which records the request URL including its query string. The OAuth callback receives `code` and `state` in query parameters (`demo_api_server/routes/oauth.js:191-194`).

**Impact:** before the repository change, authorization codes and state values could persist in application/container logs and potentially in BFF log storage. New access logs omit query strings. Historical logs may still contain values until their retention expires or they are removed. Codes are short-lived and PKCE-bound, which limits replay.

**Recommendation:** retain the query-redacting logger and review retention/access for already collected logs. Remove historical OAuth callback entries according to the log retention policy where feasible.

**Confidence / false-positive notes:** high confidence in URL logging from Morgan's standard combined format and the callback path. Whether an attacker could redeem a logged code depends on timing and access to the matching PKCE verifier; this review found only a truncated verifier prefix in the route's explicit debug log.

**Repository remediation:** access logs now record URL path only and reduce the Referer to origin/path, preserving method/status/length/user-agent while removing query values. OAuth callback processing and state validation were not changed.

### M-04 — Some hosted workloads still use mutable third-party image tags

**Evidence:** `k8s/aws/deploy.sh:95-108` rewrites first-party image names in `IMAGE_MAP` to a commit-derived tag and changes pull policy. The map does not rewrite third-party references. For example, `k8s/71-ping-gateway-deployment.yaml:33-34` uses `ig:latest`; `k8s/72-rag-stack.yaml:121-123` uses `weaviate:latest`; `k8s/54-seed-llm-models.yaml:73` uses `curlimages/curl:latest`; and llama.cpp workloads use the mutable `ghcr.io/ggml-org/llama.cpp:server` tag.

**Impact:** a rebuild or restart can resolve a different upstream image under the same tag, making releases non-reproducible and allowing upstream tag changes to alter the deployed code without a repository change. Image provenance and rollback become harder to establish.

**Recommendation:** pin deployed third-party images to immutable digests (or fixed versions plus digest verification), include them in a reviewed update process, and keep non-deployment job images pinned as well when they run in the cluster.

**Confidence / false-positive notes:** high confidence for the cited references. Whether each optional RAG or seed manifest is applied in a given hosted profile varies; the cited Ping Gateway manifest is part of the hosted deployment path.

**Status:** open. The hosted image inventory is in `docs/security/HOSTED_WORKLOAD_READINESS_2026-09-26.md`, but the configured cluster could not be queried to capture running image IDs. Pinning an unverified version could change demo behavior, so immutable references remain a promotion prerequisite rather than being guessed here.

## Low

### L-01 — Restricted Pod Security Standards are warning-only

**Evidence:** `k8s/01-namespace.yaml:5-14` labels the namespace for `audit` and `warn` at the `restricted` level but does not set an `enforce` label. `k8s/aws/deploy.sh:162-169` targets a pre-existing namespace without applying these labels, so the repository deployment does not establish the hosted namespace policy.

**Impact:** workloads that violate restricted pod security settings are reported but admitted. This leaves a weaker containment baseline if a container is compromised. Multiple existing legacy workloads may currently require migration before enforcement can be enabled safely.

**Recommendation:** inventory audit violations, migrate workloads incrementally, then enable `enforce=restricted` (or equivalent admission policy) in the hosted namespace. Ensure the namespace labels are applied even when deploying into a pre-created namespace.

**Confidence / false-positive notes:** high confidence that this manifest alone does not enforce restricted PSS. Cluster-level admission policies could provide equivalent enforcement and were not inspected.

**Status:** open. Static workload inventory is in `docs/security/HOSTED_WORKLOAD_READINESS_2026-09-26.md`. No namespace policy was changed. Runtime workload audit and namespace-admin confirmation are still required before enforcement.

### L-02 — Namespace network policy permits broad outbound HTTP(S) and DNS

**Evidence:** `k8s/04-network-policies.yaml:26-46` and `:81-101` allow selected pods to connect to any IPv4 destination on TCP 80/443 and port 53, in addition to namespace-local destinations. Metadata link-local addresses are excluded, which is useful but does not restrict other external destinations.

**Impact:** a compromised pod can make outbound connections to arbitrary public endpoints over HTTP(S), supporting data exfiltration or command-and-control. Required PingOne and model-provider integrations explain some external egress, but the policy does not limit destinations to those dependencies.

**Recommendation:** use an egress proxy or maintained destination allowlists for the hosted profile where practical. At minimum, split broad egress permissions by workload so services without external-call requirements have no general Internet access.

**Confidence / false-positive notes:** high confidence in the policy's scope. Whether the cluster CNI enforces NetworkPolicy and whether additional cloud firewall rules restrict egress were not inspected.

**Status:** open. The new MCP ingress restriction preserves the existing egress rules. Destination narrowing requires a verified provider/DNS inventory and CNI confirmation; the configured cluster could not be reached to inspect either.

## Positive controls observed

- Hosted access admission is checked before API routes and is separate from the Demo application login (`demo_api_server/server.js:722`; `middleware/hostedAccessGate.js`).
- The langchain app gates internal AG-UI/CodeGraph routes with a shared secret and fails closed outside development (`langchain_agent/src/main.py`, `_gate_internal` middleware).
- The BFF disables automatic service-account-token mounting (`k8s/20-api-server-deployment.yaml`), as does the MCP deployment (`k8s/30-mcp-server-deployment.yaml`).
- First-party hosted images are rewritten to a commit-derived release tag in the AWS deployment script (`k8s/aws/deploy.sh:95-108`).
- The broad egress rule excludes the AWS metadata link-local addresses (`k8s/04-network-policies.yaml`).

## Review limitations

This report is based on source and deployment configuration only. It does not assert live exploitability, inspect cloud IAM, cluster RBAC/admission configuration, ingress-controller settings outside repository manifests, secret values, registry policy, runtime image digests, or dependency vulnerability databases. One read-only Kubernetes request was attempted and failed at DNS resolution for the configured API endpoint. No tests, scans, or deployments were run as part of this review or remediation.
