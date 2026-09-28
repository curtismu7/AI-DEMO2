# Security and Networking Remediation Workplan

**Status:** Working checklist; no remediation is implemented by this document.

**Agreed scope:** Prioritize hosted Kubernetes. Treat the API-key resource server as demo-data-only; do not connect it to real customer data.

**Assessment basis:** [Security and Networking Assessment](SECURITY_NETWORKING_ASSESSMENT.md), a static repository review dated 2026-09-28.

**Purpose:** Review each risk, make the architecture decision, then update code/manifests and record evidence before closing it.

## How to use this document

For each item, record a decision and an evidence link. Keep the finding open until both the code/configuration change and its verification are complete. “Verified” means the deployed configuration was checked in an authorized environment, not only that a repository file changed.

Decision: `Accept / Change / Defer` · Owner: `__________` · Review date: `__________` · Evidence: `__________`

The assessment reviewed checked-in Compose, Kubernetes, ingress, and service code. It did not inspect a live cluster, cloud account, host firewall, or runtime secrets. Runtime checks in this workplan are limited to namespaces the team is authorized to use: `cmuir` and `curtismuir`. Do not infer cluster-wide state from either namespace.

The editable diagram input and its detailed data companion are in [`docs/exports/`](exports/). The assessment remains the finding source of truth until a finding is changed with new evidence.

### Import the topology into Lucidchart

1. Open the Shapes panel, click **Import Data**, choose **Process diagram**, then click **Import Your Data**.
2. Select [`server-topology-lucidchart.csv`](exports/server-topology-lucidchart.csv). It contains 35 service boxes and 58 directed connections.
3. Keep [`server-topology-details.csv`](exports/server-topology-details.csv) as the companion inventory for RFCs/specifications, network/security notes, deployment endpoints, playback scenarios, Demo Step IDs, candidate/optional security approaches, outline/line color keys, audit caveats, and matching Lucidchart import IDs.

Lucid documents [Process diagram CSV import](https://help.lucid.co/hc/en-us/articles/15927090927508-Create-a-process-diagram-from-CSV-import) as an experimental importer. It places shapes automatically and does not import shape colors/styles, so expect to adjust the layout and apply the colored outlines in Lucidchart. Lucid also supports importing Draw.io diagrams, but the CSV here uses Lucidchart's documented process-diagram schema directly.

## Review order

1. [ ] **Pin the hosted Kubernetes revision.** Hosted Kubernetes is the first remediation track. Record the exact deployed revision and manifest/rendering source before comparing runtime state. The local Compose track follows separately.
2. [ ] **Correct the communication map.** Review the diagram corrections below, then agree on the permitted caller → destination → port/protocol matrix. Network policy and egress work depends on this inventory.
3. [ ] **Close the high-risk trust gaps.** Address N-01, N-02, and N-03, validating both permitted and denied paths in an authorized non-production namespace before any rollout decision.
4. [ ] **Reduce outbound and transport exposure.** Decide N-04 and N-07 together with DNS, IPv6, certificate, and external dependency owners.
5. [ ] **Harden workload admission and browser-origin checks.** Address N-06 and N-08, keeping explicit exceptions for workloads and non-browser clients that need them.
6. [ ] **Apply the demo-data boundary to N-09.** Keep the API-key backend limited to demo records and verify hosted secrets/networking do not expose it as a real-data authorization pattern.
7. [ ] **Handle local Compose after the hosted pass.** Address N-05 for shared/reachable developer hosts without making the local browser demo unusable.
8. [ ] **Run the evidence checklist.** Attach repository diffs, rendered manifests, and authorized positive/negative connectivity results. Update finding status and the topology after each accepted design change.

## Finding decisions and implementation checklist

### P0 — High risk

#### N-01 — Verify the NGINX-to-BFF TLS peer

Assessment: [`N-01`](SECURITY_NETWORKING_ASSESSMENT.md#n-01--high-aws-nginx-does-not-verify-bff-tls-certificates)

- [ ] Choose the internal certificate authority and upstream service identity/SAN.
- [ ] Mount the trusted CA into the frontend NGINX workload; enable certificate-chain and hostname verification, SNI, and an explicit expected upstream name.
- [ ] Keep certificate renewal/rotation and CA overlap in the deployment procedure.
- [ ] Add a configuration guard so the hosted override cannot silently disable upstream verification.
- [ ] Verify a valid certificate succeeds and an untrusted or wrong-name certificate fails closed.

**Close with:** the rendered hosted NGINX config, certificate identity/issuer evidence with secrets removed, and positive plus negative verification results.

#### N-02 — Replace broad east-west access with an explicit flow policy

Assessment: [`N-02`](SECURITY_NETWORKING_ASSESSMENT.md#n-02--high-namespace-network-policy-permits-unrestricted-east-west-access)

- [ ] Approve the caller/destination/port matrix after reviewing the exported connections and hosted routes.
- [ ] Start with default-deny ingress and egress; add narrow allows for public ingress controllers, required service callers, telemetry, cluster DNS, and explicitly approved external endpoints.
- [ ] Keep policy selectors and ports workload-specific. Do not treat NetworkPolicy as encryption or as a replacement for backend authorization.
- [ ] Identify the deployed CNI and confirm it enforces NetworkPolicy.
- [ ] From authorized `cmuir` or `curtismuir` workloads, test required connections succeed and representative unrelated-pod connections fail.

**Close with:** rendered policies, CNI/effective-policy evidence, and a redacted allow/deny test matrix. The source manifests alone do not prove runtime enforcement.

#### N-03 — Prevent direct calls from bypassing gateway authorization

Assessment: [`N-03`](SECURITY_NETWORKING_ASSESSMENT.md#n-03--high-unauthenticated-mcp-backend-relies-on-a-broad-network-trust-boundary)

- [ ] Decide which backends must validate credentials themselves and which may rely on an exact gateway-only network boundary.
- [ ] Add audience- and operation-scoped backend authorization where practical, especially for privileged audit operations.
- [ ] For any intentionally unauthenticated listener, allow only its named gateway caller and required port; apply this to MCP, weather, Brave, and audit paths where deployed.
- [ ] Set production runtime modes explicitly; document any deliberate development-mode exception.
- [ ] Test a permitted gateway call and a direct call from an unrelated workload; confirm the latter is denied at the network or service-auth layer.

**Close with:** the backend-auth decision, resulting service/policy changes, and both positive and negative call evidence. A reachable gateway-only backend is not considered protected just because the public route passes through a gateway.

### P1 — Medium-high and medium risk

#### N-04 — Restrict workload egress

Assessment: [`N-04`](SECURITY_NETWORKING_ASSESSMENT.md#n-04--medium-high-kubernetes-workloads-can-use-broad-httphttpsdns-egress)

- [ ] Inventory required destinations by workload (identity providers, model APIs, package/config services, and any other verified dependency).
- [ ] Permit DNS only to cluster DNS; remove plaintext TCP 80 unless a dependency is documented.
- [ ] Choose the enforcement point for external destinations: egress proxy, cloud firewall, or CNI-specific FQDN policy. Standard Kubernetes NetworkPolicy cannot express DNS-name allowlists.
- [ ] Confirm IPv6 routing, IPv6 metadata access, DNS bypass, and cloud egress controls.
- [ ] Validate representative allowed destinations and denied arbitrary destinations from each workload class.

**Close with:** destination inventory, policy/firewall configuration, IPv4/IPv6 evidence, and allowed/denied egress results.

#### N-05 — Keep local Compose ports local and split trust zones (follow-up track)

Assessment: [`N-05`](SECURITY_NETWORKING_ASSESSMENT.md#n-05--medium-potentially-high-if-sharedreachable-local-compose-publishes-ports-broadly-and-uses-a-flat-network)

- [ ] Confirm which machines run the Compose demo and whether any are shared or network-reachable.
- [ ] Bind developer-facing and observability ports to loopback by default; publish only the UI/reverse-proxy entry point needed for the demo.
- [ ] Keep backend and telemetry ports unpublished. Review optional OpenSearch and observability profiles for unauthenticated listeners.
- [ ] Split edge, application, data, and observability networks where Compose use cases permit; preserve the documented local browser origin and any explicitly supported remote-client workflow.
- [ ] Verify from another host that unpublished/local-only ports are unreachable when the host is shared or reachable.

**Close with:** effective port bindings, profile list, and host-reachability evidence. This is local-demo hardening and does not define the hosted Kubernetes perimeter.

#### N-06 — Move Pod Security from audit/warn toward enforcement

Assessment: [`N-06`](SECURITY_NETWORKING_ASSESSMENT.md#n-06--medium-restricted-pod-security-is-auditwarn-only)

- [ ] Collect the current Restricted-profile warnings for the exact workload revision.
- [ ] Update workloads to satisfy Restricted controls where feasible (non-root UID, no privilege escalation, seccomp, and dropped capabilities).
- [ ] Record each workload that cannot comply, why it needs an exception, and the compensating controls.
- [ ] Decide whether to enforce `restricted` in the application namespace or use narrower admission policy/namespace boundaries for exceptions.
- [ ] Prove compliant workloads are admitted and exceptions are limited to the approved workloads.

**Close with:** warning/audit output, workload security-context changes, exception register, and admission evidence.

#### N-07 — Encrypt and authenticate sensitive internal hops

Assessment: [`N-07`](SECURITY_NETWORKING_ASSESSMENT.md#n-07--medium-several-kubernetes-service-hops-use-plain-http)

- [ ] Rank HTTP hops by whether they carry credentials, user data, authorization decisions, or privileged operations.
- [ ] Choose per-service TLS or workload PKI/service mesh for each sensitive hop; document health-check and lower-sensitivity exceptions.
- [ ] For workload mTLS, define identity issuance, trust-bundle distribution, rotation, peer-name validation, and fail-closed behavior at both endpoints.
- [ ] Enable certificate verification on clients and restrict the same hops with NetworkPolicy.
- [ ] Verify encryption and peer identity for the chosen sensitive routes; confirm policy-only paths are still accurately described as plaintext.

**Close with:** a hop-by-hop decision table and runtime evidence for TLS version, peer identity validation, and certificate failure behavior.

#### N-08 — Configure exact MCP browser Origin allowlists

Assessment: [`N-08`](SECURITY_NETWORKING_ASSESSMENT.md#n-08--medium-mcp-streamable-http-accepts-every-browser-origin-by-default)

- [ ] List the exact browser origins for each supported local and hosted deployment.
- [ ] Set `MCP_ALLOWED_ORIGINS` explicitly in each deployment; reject a supplied unlisted Origin with 403.
- [ ] Preserve supported non-browser clients that omit Origin.
- [ ] Confirm the raw MCP listener is not unintentionally exposed by the active ingress or Compose profile.
- [ ] Verify allowed origin, denied origin, and absent Origin behavior.

**Close with:** per-environment origin configuration and request results for all three cases.

#### N-09 — Keep the API-key backend demo-data-only

Assessment: [`N-09`](SECURITY_NETWORKING_ASSESSMENT.md#n-09--medium-api-key-backend-trusts-a-shared-service-credential-without-caller-identity)

- [x] **Decision recorded:** this resource server is for demo records only. Do not connect it to real customer data or present its shared API-key model as a production user-authorization pattern.
- [ ] Confirm the hosted Kubernetes instance contains demo data only and has no production/customer-data source configured.
- [ ] Store the hosted demo key in the deployment's protected secret source; use a non-default value, keep it server-side, and avoid logging it. Do not reuse a repository or local Compose fallback key in hosted Kubernetes.
- [ ] Restrict backend network access to the intended gateway/caller and use verified TLS on the hop as part of N-02/N-07.
- [ ] Confirm the resource server does not trust a free-form `X-User-Sub` header as authenticated identity.
- [ ] Record the re-open trigger: any proposal to use real user/customer data requires a new decision and validated audience/user-bound authorization at the resource server before that data is connected.

**Close with:** evidence that the hosted instance is demo-data-only, the key is protected and non-default, and only the intended caller can reach the backend. The demo-only authorization limitation is an accepted boundary; reopen N-09 before introducing real user/customer data.

## Architecture and diagram corrections

These items prevent the topology from overstating the security boundary. Update source topology/playbacks and exported diagrams alongside the corresponding service/configuration changes.

- [ ] **Hosted direct MCP route:** show local Compose direct publishing separately from hosted routing. In the audited hosted ingress, regular MCP calls route through PingGateway; only Protected Resource Metadata routes directly to `mcp-server`.
- [ ] **API-key branch:** remove RFC 8693 exchange from the API-key playback. The branch makes an Authorize decision and calls the backend with `X-API-Key`; it returns before the generic token-exchange branch.
- [ ] **Distinct API paths:** distinguish the API-key MCP tool call from `BankingAPIClient` calls to BFF APIs using a bearer token. Do not label the API-key resource-server hop as bearer-protected.
- [ ] **mTLS state:** label SPIFFE/workload mTLS as optional or candidate unless the selected deployment configures and verifies it at both endpoints. RFC 8705 applies to OAuth client authentication/certificate-bound tokens; it is not a general workload-mTLS mandate.
- [ ] **Audit and discovery:** remove “secret-guarded” from the MCP audit edge unless inbound authentication is implemented. Mark `mcp-audit` and `mcp-discovery-agent` as having no matching checked-in Kubernetes Service/Deployment.
- [ ] **PingGateway backend routes:** represent its direct resource/weather/Brave routes separately from the path through the OAuth MCP server.
- [ ] **Missing use cases:** add the external MCP Protected Resource Metadata/authorization discovery and callback chain, the direct A2A ingress/auth path, optional Privilege/OpenSearch profiles, and deployment-specific BFF agent/RAG/HITL paths where supported.
- [ ] **Hosted configuration truth:** keep ALB and shared nginx-public ingress paths distinct; map each path to the exact deployment source and active profile.

**Close with:** updated topology source, playback tests/verification required by the repo, and a fresh export. Do not mark an illustrative optional service as deployed without matching deployment resources or runtime evidence.

## Security mechanisms: decide what each layer must do

These controls solve different problems and should not be presented as interchangeable choices:

| Mechanism | Provides | Does not provide by itself | Workplan use |
|---|---|---|---|
| NetworkPolicy / firewall | Limits which workloads or networks can connect to a destination and port | Encryption, caller identity, or user authorization | N-02, N-03, N-04, N-05, N-09 |
| OAuth token exchange (RFC 8693) and resource indicators (RFC 8707) | A token scoped to a resource/audience and, when configured, delegated user authorization | Transport encryption or workload peer identity | N-03, N-09; only on token-authenticated branches |
| Workload mTLS / SPIFFE | Encrypts a connection and authenticates workload identities when both endpoints validate identities | End-user identity, tool-level policy, or proof that a call is authorized | N-03, N-07, N-09; complements application authorization |
| OAuth mTLS (RFC 8705) | OAuth client certificate authentication and optional certificate-bound tokens | General service-mesh mTLS unless separately configured as workload mTLS | OAuth client-auth design only |
| API key | Possession of a shared service secret | Per-user identity, narrow audience, or fine-grained authorization unless the receiving service adds those checks | N-09; retain only with documented scope/rotation and demo-data boundary |

## Verification and closure record

- [ ] Render the exact deployment manifests for the reviewed revision and compare with repository evidence.
- [ ] Confirm the effective CNI/policies and run positive and negative connectivity checks only in authorized namespaces.
- [ ] Verify public TLS/certificate coverage, ALB/security-group reachability, upstream certificate validation, and HTTP-to-HTTPS behavior.
- [ ] Enumerate workload egress, including DNS, IPv6, metadata, and approved external destinations.
- [ ] Review Pod Security warnings/exceptions and ingress Origin checks.
- [ ] Verify gateway-only backend reachability and backend authorization failures.
- [ ] Confirm local Compose bindings/profiles separately from hosted configuration.
- [ ] Update each finding’s status, evidence, accepted risk or follow-up issue; update the diagram and this workplan when the architecture changes.

| Finding | Decision | Implementation reference | Verification evidence | Status |
|---|---|---|---|---|
| N-01 |  |  |  | Open |
| N-02 |  |  |  | Open |
| N-03 |  |  |  | Open |
| N-04 |  |  |  | Open |
| N-05 | Local Compose follow-up after hosted pass |  |  | Deferred |
| N-06 |  |  |  | Open |
| N-07 |  |  |  | Open |
| N-08 |  |  |  | Open |
| N-09 | Demo-data-only boundary accepted |  |  | Guardrail verification open |
