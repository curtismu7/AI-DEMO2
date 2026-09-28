# Security and Networking Assessment

**Assessment date:** 2026-09-28

**Scope:** Repository-defined hosted Kubernetes and local Docker networking, ingress, TLS, workload boundaries, and pod hardening.

**Assessment type:** Static configuration review. No live cluster, cloud account, host firewall, container runtime, or external endpoint was inspected.

## Executive summary

The repository contains useful safeguards: an internet-facing AWS ALB is configured with an HTTPS listener and HTTP-to-HTTPS redirect, an initial Kubernetes NetworkPolicy excludes two IPv4 AWS metadata addresses, the Kubernetes workloads generally use ClusterIP services, and some OAuth and BFF hops use TLS. These controls are not enough to establish production network isolation.

The highest-priority gaps in the checked-in hosted configuration are:

1. The AWS frontend NGINX configuration disables upstream certificate verification for BFF HTTPS routes.
2. The namespace NetworkPolicy allows every pod in `ai-demo` to reach every other pod, allows ingress from every pod in `ingress-nginx`, and permits broad internet egress over HTTP, HTTPS, and DNS.
3. Several gateway-protected MCP services accept direct unauthenticated calls. Kubernetes currently allows every pod in the namespace to reach them, so gateway policy can be bypassed from another workload.
4. Kubernetes Pod Security Standards are configured for `warn` and `audit`, but not `enforce`; restricted pod hardening is not admission-enforced by this namespace manifest.
5. Docker Compose publishes several app, observability, and backend ports to all host interfaces by default and connects services to one bridge network. This is suitable for a local demo harness only when the host is suitably protected; it is not a production network layout.
6. The MCP Origin allowlist is empty by default, so any browser Origin is accepted by the Streamable HTTP server.
7. The API-key backend authenticates a shared service credential but does not bind the call to a user identity or OAuth audience; its records are explicitly demo data.

The ALB TLS policy is a positive control and currently advertises TLS 1.2 and 1.3. The 2026 IETF update says new protocols using TLS must require TLS 1.3; whether that applies to this deployment depends on whether an application protocol is newly specified here. This report does not claim the ALB setting violates that requirement. The direct finding is disabled certificate verification on selected internal TLS clients.

### Severity overview

| ID | Severity | Finding |
|---|---|---|
| N-01 | High | AWS NGINX does not verify BFF TLS certificates |
| N-02 | High | Namespace network policy permits unrestricted east-west access |
| N-03 | High | Gateway-protected MCP backends are directly callable inside the namespace |
| N-04 | Medium-High | Kubernetes workloads can use broad HTTP/HTTPS/DNS egress |
| N-05 | Medium; potentially High if shared/reachable | Local Compose publishes app, backend, and telemetry ports broadly |
| N-06 | Medium | Restricted Pod Security is audit/warn only |
| N-07 | Medium | Several Kubernetes service hops use plain HTTP |
| N-08 | Medium | MCP Streamable HTTP accepts every browser Origin by default |
| N-09 | Medium | API-key backend trusts a shared service credential without caller identity |

Severity reflects likely impact if the deployment is reachable as configured, adjusted for evidence limitations. No live exposure or exploitability was tested.

## Diagram scope and end-to-end path coverage

The reviewed topology source contains **35 service nodes, 58 directed connection records, and 10 playback scenarios** (`demo_api_ui/src/components/serverTopologyData.js`). I traced the playback paths and connection classes against `service-topology.json`, the Compose services, the Kubernetes Deployments/Services/Ingresses, and the relevant gateway/backend request handlers. This is a repository-grounded audit of declared paths, not proof that every runtime flag, secret, route, or cloud rule is active.

| Diagram playback | Path traced | Main network/security boundary | Assessment |
|---|---|---|---|
| PingOne login | Browser → public edge → frontend/BFF → PingOne authorize/token → BFF session | Public TLS, OAuth code/state/PKCE; backend token exchange is outbound HTTPS | Source path is represented. Hosted ingress-to-pod protocol differs by deployment: the ALB terminates TLS then forwards HTTP to frontend; the SE ingress uses a separate nginx-public controller. |
| PingFederate login | Browser → public edge → frontend/BFF → PingFederate authorize/token → BFF session | OAuth code/state/PKCE; callback and provider configuration are dynamic | Same path shape, but the provider issuer, token URL, and trust configuration are deployment-specific. Not verified against a live PingFederate issuer/certificate. |
| Direct MCP client | Local Compose client → published `mcp-server:8080`; hosted MCP → PingGateway → MCP server | OAuth/MCP bearer checks depend on which listener receives the request | The playback explicitly represents the local Compose direct listener. Hosted `/mcp` requests route through PingGateway; only Protected Resource Metadata goes directly to `mcp-server`. |
| Protected API | BFF/agent → Node gateway → Authorize → token exchange → MCP server → BFF API | User token, policy decision, audience-specific exchange, BFF bearer-route authorization | The playback now shows the MCP server's `BankingAPIClient` call to a BFF API with the delegated user bearer. This is separate from the Node gateway's API-key backend path. |
| API-key backend | BFF/agent → Node gateway → Authorize → API-key backend | Gateway decision, static or JIT service credential, plain HTTP in declared backend path | The playback shows Authorize followed by a direct `X-API-Key` backend call; this branch returns before RFC 8693 exchange. The backend currently does not consume the forwarded `X-User-Sub` header. |
| MCP resource server | BFF/agent → Node gateway → Authorize → RFC 8693 exchange → MCP server → resource server | Audience-bound token at gateway/MCP boundary; downstream service uses internal HTTP/API-key path depending on tool | The primary gateway exchange is represented. Backend protocol/auth varies by tool and must not be presented as one universal bearer-protected hop. |
| PingGateway | Client/BFF → PingGateway → authz/PingOne → MCP/tool backend | Gateway policy, backend routes, sidecar and provider credentials | Core route is present, but weather/Brave and OLB/investment use distinct backends. The one diagram line to the MCP server does not show PingGateway's direct HTTP backend routes to resource/weather/Brave services. |
| Weather | BFF/agent → gateway policy → weather MCP | Scope/policy at gateway; internal backend HTTP | Gateway check is present. Weather service itself accepts unauthenticated MCP requests, so enforcement depends on network isolation. |
| Brave | BFF/agent → gateway policy → Brave MCP → external Brave API | Scope/policy at gateway; backend uses provider API key | Same gateway dependency as weather. Direct service callers can invoke the search tool without passing gateway policy if they can reach the service. |
| Telemetry | Gateway audit → audit service; Prometheus → service metrics → Alertmanager | Internal HTTP and service credentials only on selected outbound calls | Several metric endpoints are unauthenticated; `mcp-audit` accepts MCP requests without an inbound credential. Kubernetes has no `mcp-audit` Service/Deployment in the checked-in manifests. |

The connection catalog also includes optional RAG, Privilege/OpenSearch, agent, SPIFFE, and telemetry paths. Those are not all part of the ten playback scenarios. They are assessed below as conditional/profile paths, and their live enablement is unknown. The inventory contains two explicitly missing Kubernetes resources referenced by the diagram: `mcp-discovery-agent` and `mcp-audit`. This makes those Kubernetes edges illustrative rather than evidence of an available hosted hop.

### Public paths supported by the repository but absent from the playback list

- **External MCP authorization door:** the `cmuir-mcp` hosted ingress sends MCP requests through PingGateway, while the gateway's `/oauth/` and authorization-server metadata routes are separately published through the AWS frontend NGINX override. The current playback does not show the full Protected Resource Metadata → authorization-server discovery → client registration → browser authorization → callback/token → MCP request chain. The exact public routing differs between the ALB and shared nginx-public ingress configurations.
- **Direct A2A ingress:** `langchain-a2a.ai-demo.ping-devops.com` publishes only the Agent Card and `/a2a` to the LangChain service ([`k8s/aws/se-ingress.yaml:222-255`](../k8s/aws/se-ingress.yaml)). The A2A handler requires either a validated bearer token or a validated Privilege transaction token ([`langchain_agent/src/api/a2a_handler.py:143-172`](../langchain_agent/src/api/a2a_handler.py)); this is a separate public identity boundary that the current playback list does not show.
- **Optional Privilege/OpenSearch paths:** Compose can publish the Privilege proxy, OpenSearch, and OpenSearch MCP when their profile is selected. Those paths are conditional and do not belong to the default stack; the profile setting and network reachability must be included in a deployment-specific diagram.
- **BFF agent and code-search paths:** BFF calls to LangChain, alternate agent service, discovery, HITL, and RAG/code-search services are distinct HTTP edges. Some are absent from Kubernetes manifests or are profile-gated, so a generic BFF-to-agent edge is insufficient to claim hosted parity.

## Findings

### N-01 — High: AWS NGINX does not verify BFF TLS certificates

**Evidence:** [`k8s/aws/nginx-http-configmap.yaml:65-68`](../k8s/aws/nginx-http-configmap.yaml), [`:79-82`](../k8s/aws/nginx-http-configmap.yaml), [`:95-106`](../k8s/aws/nginx-http-configmap.yaml), and [`:116-120`](../k8s/aws/nginx-http-configmap.yaml) configure HTTPS to `demo-api-server:3001` and set `proxy_ssl_verify off` for the webhook, codegraph, API, and MCP façade routes. In contrast, [`demo_api_ui/nginx.conf:51-67`](../demo_api_ui/nginx.conf) shows the local NGINX configuration trusting a CA, enabling verification, and setting the expected server name.

**Why it matters:** TLS encryption without server-certificate validation does not reliably authenticate the upstream. A network attacker or compromised workload able to intercept or impersonate the BFF inside the cluster could return forged API responses or receive proxied requests and credentials. This is particularly consequential for browser API and OAuth-related traffic.

**Standards and practice:** TLS best-current-practice guidance assumes peers validate the negotiated TLS connection and certificate identity. See [RFC 9325](https://www.rfc-editor.org/rfc/rfc9325.html), as updated by [RFC 9852](https://www.rfc-editor.org/rfc/rfc9852.html) and [RFC 10015](https://www.rfc-editor.org/rfc/rfc10015.html). The ALB setting [`ELBSecurityPolicy-TLS13-1-2-2021-06`](../k8s/aws/ingress.yaml#L29) is separate and does not fix this internal client verification gap.

**Recommendation:** Use a deployment CA that issues a certificate with a SAN matching the internal upstream identity; mount the CA into the frontend pod; enable `proxy_ssl_verify on`, `proxy_ssl_trusted_certificate`, SNI, and an explicit `proxy_ssl_name`. Add a deployment check that rejects `proxy_ssl_verify off` in hosted config.

**Confidence:** High. The directives are explicit in the checked-in AWS override. Runtime CA and certificate state were not inspected.

### N-02 — High: Namespace network policy permits unrestricted east-west access

**Evidence:** [`k8s/01-namespace.yaml:37-49`](../k8s/01-namespace.yaml) selects all pods in `ai-demo` and permits ingress from all pods in that namespace and all pods in the `ingress-nginx` namespace. [`:50-54`](../k8s/01-namespace.yaml) permits egress to every pod in `ai-demo`. No component-specific pod selectors or ports are specified. This is the only checked-in `NetworkPolicy` found under `k8s/`.

**Why it matters:** A compromised or misconfigured pod can initiate connections to unrelated app, auth, resource-server, and observability workloads. The broad ingress allowance from the entire ingress controller namespace also makes every such pod a potential source. Network reachability is a key boundary because some backend services intentionally trust upstream gateways rather than authenticating every caller; for example [`k8s/30-mcp-server-deployment.yaml:53-57`](../k8s/30-mcp-server-deployment.yaml) sets `MCP_AUTH_DISABLED` to `true` and states that the gateway enforces authorization.

**Standards and practice:** Kubernetes NetworkPolicy supports pod and namespace selectors and port restrictions, but enforcement requires a supporting network plugin; a manifest alone does not prove enforcement. See [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/).

**Recommendation:** Model the required communication edges, apply default-deny ingress and egress, then allow only named caller and destination components on the necessary ports. Restrict the ingress allowance to the actual ingress-controller pods. Keep gateway authorization and backend authentication assumptions explicit and test them from both permitted and denied pods. Confirm that the deployed CNI enforces policies.

**Confidence:** High for manifest breadth; unknown for effective runtime enforcement and CNI behavior.

### N-03 — High: Unauthenticated MCP backend relies on a broad network trust boundary

**Evidence:** [`k8s/30-mcp-server-deployment.yaml:40-57`](../k8s/30-mcp-server-deployment.yaml) sets `NODE_ENV` to `development` and `MCP_AUTH_DISABLED` to `true`; the comment says the gateway enforces authorization and the MCP server trusts all callers on the internal hop. The MCP transport documents that this setting skips bearer validation entirely ([`oauth-mcp/src/server/HttpMCPTransport.ts:214-219`](../oauth-mcp/src/server/HttpMCPTransport.ts)). The weather and Brave HTTP handlers accept MCP requests without checking an inbound credential ([`demo_mcp_weather/server.js:122-170`](../demo_mcp_weather/server.js), [`demo_mcp_brave/server.js:141-219`](../demo_mcp_brave/server.js)); the audit MCP handler likewise dispatches `tools/call` without authenticating the caller ([`demo_mcp_audit/server.js:181-243`](../demo_mcp_audit/server.js)). The audit tool then uses a PingOne worker token for its outbound audit query ([`demo_mcp_audit/server.js:39-66`](../demo_mcp_audit/server.js)). These listeners are cluster-local `ClusterIP` services, but N-02 permits every namespace pod to reach them. Local Compose also publishes MCP server, weather, Brave, and audit ports to the host ([`docker-compose.yml:866-867`](../docker-compose.yml), [`:1547-1548`](../docker-compose.yml), [`:1567-1568`](../docker-compose.yml), [`:1600-1601`](../docker-compose.yml)).

**Why it matters:** A pod that can reach one of these backends may bypass the gateway's token validation, per-tool policy, and scope checks. A direct call to the unauthenticated audit service could also exercise its outbound worker credential. The intended edge authorization is useful, but it is not a backend security boundary while all pods in the namespace are allowed to connect.

**Recommendation:** Add backend authentication/authorization where practical. For intentionally gateway-protected listeners, allow network access only from the exact gateway pods and ports, and test that unrelated pods cannot reach them. Apply the same reachability restriction to weather, Brave, and audit. Set `NODE_ENV=production` unless development mode is deliberately required and reviewed. Treat the audit service's outbound worker token as a privileged capability and do not place it behind an unrestricted listener.

**Confidence:** High for declared environment values and stated trust design; the exact public route and live policy enforcement were not tested.

### N-04 — Medium-High: Kubernetes workloads can use broad HTTP/HTTPS/DNS egress

**Evidence:** [`k8s/01-namespace.yaml:55-72`](../k8s/01-namespace.yaml) permits all pods selected by this policy to reach `0.0.0.0/0` on TCP 443, TCP 80, and TCP/UDP 53, excluding `169.254.169.254/32` and `169.254.170.2/32`.

**Why it matters:** Any selected pod can make outbound connections to arbitrary internet IPs using HTTPS or plaintext HTTP and can send queries to arbitrary DNS destinations. This increases exposure to SSRF, data exfiltration, command-and-control, and credential theft after a workload compromise. The IPv4 metadata exclusions are useful, but the repository does not establish whether IPv6 is enabled or separately blocked.

**Recommendation:** Permit DNS only to the cluster DNS service. Remove TCP 80 unless a documented dependency needs it. Restrict external service traffic through an egress proxy, firewall, or CNI-specific FQDN controls with an explicit destination inventory; standard Kubernetes NetworkPolicy does not provide domain-name allowlists. Verify IPv6 metadata and external egress controls in the cluster.

**Confidence:** High for the IPv4 manifest rules; actual routes, IPv6 behavior, egress gateways, and cloud firewalls are unknown.

### N-05 — Medium; potentially High if shared/reachable: Local Compose publishes ports broadly and uses a flat network

**Evidence:** [`docker-compose.yml:2446-2448`](../docker-compose.yml) defines one bridge network without `internal: true` or separate trust zones. Several ports are published without a host-IP restriction, including Jaeger `16686` and OTLP `4317` ([`docker-compose.yml:95-101`](../docker-compose.yml)), BFF `3001` ([`docker-compose.yml:259-270`](../docker-compose.yml)), UI `4000` ([`docker-compose.yml:839-849`](../docker-compose.yml)), MCP server `8080` ([`docker-compose.yml:866-867`](../docker-compose.yml)), and data backends `8082`, `8896`, `8897`, and `8898` ([`docker-compose.yml:1547-1548`](../docker-compose.yml), [`:1567-1568`](../docker-compose.yml), [`:1600-1601`](../docker-compose.yml), [`:1664-1672`](../docker-compose.yml)). The optional `mcpgw` profile publishes OpenSearch `9200` and OpenSearch MCP `9900`; OpenSearch has `DISABLE_SECURITY_PLUGIN=true` and the adapter has `OPENSEARCH_NO_AUTH=true` ([`docker-compose.yml:2162-2187`](../docker-compose.yml)). Observability services in their optional profile also publish Prometheus `9090`, Alertmanager `9093`, Loki `3100`, and Grafana `3000` ([`docker-compose.yml:109-121`](../docker-compose.yml), [`:136-165`](../docker-compose.yml), [`:196-205`](../docker-compose.yml)). In contrast, the BFF's auxiliary ports and MCP resource server explicitly bind to loopback ([`docker-compose.yml:261-270`](../docker-compose.yml), [`:1474-1477`](../docker-compose.yml)).

**Why it matters:** Docker publishes ports on all host interfaces by default when no host IP is specified. On a reachable or shared host, host firewall policy determines whether app, backend, observability, and unauthenticated OpenSearch interfaces are reachable by other machines. Several published backend listeners rely on their caller being a trusted gateway. All Compose services also share one bridge, so container-to-container reachability is broader than necessary.

**Standards and practice:** See [Docker port publishing documentation](https://docs.docker.com/engine/network/port-publishing/) and [Docker publishing and exposing ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/).

**Recommendation:** Treat this Compose topology as local-demo-only. For local use, bind developer-facing and observability ports to `127.0.0.1` by default. For a hosted deployment, expose only the ingress edge; keep backends and telemetry un-published and use separate edge, application, data, and observability networks. Apply host firewall rules independently.

**Confidence:** High for the Compose port bindings and network definition; host reachability depends on runtime and firewall configuration. Observability, OpenSearch, and several supporting services are profile-gated and do not start in the default profile.

### N-06 — Medium: Restricted Pod Security is audit/warn only

**Evidence:** [`k8s/01-namespace.yaml:7-14`](../k8s/01-namespace.yaml) explains this is a migration stage and configures `pod-security.kubernetes.io/audit: restricted` and `warn: restricted`. There is no `enforce: restricted` label.

**Why it matters:** Pods that violate the Restricted profile can still be admitted. The Kubernetes Restricted standard includes controls such as non-root execution, disabling privilege escalation, seccomp, and dropping Linux capabilities. Those controls reduce the impact of container compromise.

**Standards and practice:** See [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/), which support gradual movement from audit/warn to enforcement.

**Recommendation:** Use the current audit/warn results to migrate workloads, then enforce `restricted` for compliant workloads. For workloads that cannot comply, document the exception and constrain it with a namespace or admission policy. This report does not infer that any specific container runs as root; it finds that this namespace does not enforce the profile.

**Confidence:** High.

### N-07 — Medium: Several Kubernetes service hops use plain HTTP

**Evidence:** The AWS ingress terminates TLS at the ALB and sends plain HTTP to frontend NGINX, as documented in [`k8s/aws/ingress.yaml:4-5`](../k8s/aws/ingress.yaml); its health check also uses HTTP at [`:33-36`](../k8s/aws/ingress.yaml). PingGateway configures HTTP backends to MCP and tool services at [`k8s/71-ping-gateway-deployment.yaml:66-73`](../k8s/71-ping-gateway-deployment.yaml) and an HTTP API resource server at [`:84-85`](../k8s/71-ping-gateway-deployment.yaml). The MCP server also uses HTTP URLs for internal services ([`k8s/30-mcp-server-deployment.yaml:122-125`](../k8s/30-mcp-server-deployment.yaml)).

**Why it matters:** These hops do not encrypt traffic in transit or authenticate the peer at the transport layer. NetworkPolicy can limit IP/port reachability but does not add encryption or workload identity. A compromised node, network component, or permitted workload may observe or impersonate traffic on these paths.

**Standards and practice:** This is a defense-in-depth gap, not a claim that an RFC mandates TLS for every in-cluster service hop. [RFC 9852](https://www.rfc-editor.org/rfc/rfc9852.html) governs new protocols that use TLS, while Kubernetes NetworkPolicy explicitly operates at L3/L4 and does not provide TLS. OAuth mutual-TLS [RFC 8705](https://www.rfc-editor.org/rfc/rfc8705.html) is specific to OAuth client authentication and certificate-bound tokens; it is not a general workload-mTLS requirement.

**Recommendation:** Prioritize TLS with workload identity on hops that carry credentials, user data, authorization decisions, or privileged operations. A service mesh or workload PKI can manage certificates and enforce peer identity. Keep public edge TLS, health checks, and low-sensitivity internal hops as documented exceptions where risk and platform constraints justify it.

**Confidence:** High that the declared endpoints use HTTP; actual network encryption below the application layer was not inspected.

### N-08 — Medium: MCP Streamable HTTP accepts every browser Origin by default

**Evidence:** [`oauth-mcp/src/server/DemoMCPServer.ts:85-102`](../oauth-mcp/src/server/DemoMCPServer.ts) builds `allowedOrigins` from `MCP_ALLOWED_ORIGINS`, defaulting to an empty list. [`oauth-mcp/src/server/HttpMCPTransport.ts:1341-1351`](../oauth-mcp/src/server/HttpMCPTransport.ts) accepts any Origin when that list is empty. Neither Compose nor the checked-in MCP server Deployment sets `MCP_ALLOWED_ORIGINS`. The server binds to `0.0.0.0` in Compose ([`docker-compose.yml:879-880`](../docker-compose.yml)) and publishes port 8080 to the host ([`docker-compose.yml:866-867`](../docker-compose.yml)).

**Why it matters:** The code has an Origin check, but the default configuration makes the allowlist unrestricted. This weakens the DNS-rebinding defense for locally or internally reachable HTTP MCP listeners. Authentication remains required in Compose's default (`MCP_AUTH_DISABLED=false`), but the check does not meet the MCP transport specification's requirement to reject invalid supplied Origin values. In the hosted SE ingress, ordinary MCP calls route through PingGateway; the MCP server is directly routed only for Protected Resource Metadata. The exposure is therefore deployment-dependent.

**Standards and practice:** The [MCP Streamable HTTP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) says servers MUST validate `Origin` and return 403 for an invalid value, and SHOULD bind local servers to loopback and authenticate connections.

**Recommendation:** Configure exact expected origins for every deployment that accepts browser-originated traffic; reject all others with 403. Keep non-browser clients that omit Origin supported. Confirm the active public ingress does not expose the raw MCP listener. Bind developer-only Compose endpoints to loopback unless remote clients require them.

**Confidence:** High for the code default; effective exposure depends on which Compose profile or ingress is active.

### N-09 — Medium: API-key backend trusts a shared service credential without caller identity

**Evidence:** The API resource server states that its auth model is a shared `API_RESOURCE_SERVER_API_KEY` with no JWT or audience check ([`demo_api_resource_server/server.js:6-13`](../demo_api_resource_server/server.js)). Its routes require only that key and return configured demo records ([`demo_api_resource_server/server.js:134-153`](../demo_api_resource_server/server.js), [`:292-299`](../demo_api_resource_server/server.js)). The gateway calls the service over HTTP with `X-API-Key` and `X-User-Sub` ([`demo_mcp_gateway/src/apiKeyDispatch.ts:171-205`](../demo_mcp_gateway/src/apiKeyDispatch.ts)); the current resource-server handler does not consume `X-User-Sub`. Compose supplies a shared fallback key (`mortgage-compose-dev-key`) to both caller and service ([`docker-compose.yml:1315-1316`](../docker-compose.yml), [`:1667-1673`](../docker-compose.yml)). The BFF supports issuing route-bound JIT credentials, but the gateway feature flag determines whether it uses them ([`demo_mcp_gateway/src/apiKeyDispatch.ts:180-195`](../demo_mcp_gateway/src/apiKeyDispatch.ts)).

**Why it matters:** The API key proves possession of a service secret, not which user or workload made the request. If the key is exposed through a reachable backend, compromised pod, logs, or shared local configuration, the service cannot distinguish a gateway request from another caller or bind access to a user/audience. The records are explicitly demo data, so this is a boundary-design limitation rather than evidence of real customer-data exposure.

**Recommendation:** Require a unique high-entropy production credential, enable the route-bound short-lived credential path, and restrict backend ingress to the gateway/MCP workloads. Use TLS with peer verification for the hop. If this pattern is ever connected to real user data, bind the authenticated user and allowed operation cryptographically or validate an appropriately scoped token at the resource server; do not trust a free-form `X-User-Sub` header.

**Confidence:** High for the shared-key/no-audience design; actual hosted JIT-credential flag and secret values were not inspected.

## Diagram accuracy issues and corrections

These are material to interpreting the diagram as a security artifact, even where they are not independent exploitable vulnerabilities:

- **Direct MCP playback — corrected:** The hosted SE ingress routes the MCP request path to PingGateway, not directly to `mcp-server`; only the protected-resource metadata path goes straight to `mcp-server` ([`k8s/aws/se-ingress.yaml:183-220`](../k8s/aws/se-ingress.yaml)). Local Compose publishes the MCP server directly. The playback now names the direct listener as local Compose and points hosted requests to the separate PingGateway playback.
- **API-key playback — corrected:** The `apiKeyBackend` scenario no longer lists `nodegw-pingone` as an RFC 8693 step. [`authorizeMcpRequest.ts:1207-1230`](../demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts) dispatches API-key tools and returns before the generic RFC 8693 exchange at [`:1313-1351`](../demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts); the playback now ends at the `X-API-Key` backend call.
- **Protected API path — corrected:** The API resource server validates `X-API-Key`; the API-key feature handler drops the OAuth bearer before its backend call ([`apiKeyFeatureHandlers.ts:6-15`](../oauth-mcp/src/tools/handlers/apiKeyFeatureHandlers.ts), [`:38-68`](../oauth-mcp/src/tools/handlers/apiKeyFeatureHandlers.ts)). Separately, `BankingAPIClient` calls BFF `/api/...` endpoints with a bearer token. The playback now draws the latter as an MCP-server-to-BFF edge and keeps the API-key backend as a separate Node-gateway edge.
- **mTLS labels:** The diagram's Node-gateway-to-MCP edge describes mTLS as optional, and Compose has an `MCP_MTLS_ON` switch, but checked-in Kubernetes manifests do not configure this MCP workload hop for mTLS. Do not show a generic mTLS badge as active in hosted Kubernetes without checking the active deployment.
- **Telemetry/audit:** The topology describes MCP audit ingest as secret-guarded; the checked-in `demo_mcp_audit` HTTP MCP handler has no inbound credential check. The Kubernetes manifests do not define an `mcp-audit` Service or Deployment, so that edge is not a hosted Kubernetes path in this repository snapshot.
- **Discovery:** The diagram includes `mcp-discovery-agent`, but no matching Kubernetes resource was found. Its BFF edge is a local Compose path unless another external deployment supplies it.

Because the UI's playback paths are descriptions rather than generated from the deployed manifests, the remaining route differences and unmodeled paths above can make a step-by-step security walkthrough imply a stronger or different boundary than the selected deployment actually has.

## Positive controls observed

- The AWS ALB ingress is marked internet-facing and has HTTPS on port 443, an explicit TLS policy, and an HTTP-to-HTTPS redirect ([`k8s/aws/ingress.yaml:23-36`](../k8s/aws/ingress.yaml)). The certificate ARN is a placeholder in the repository, so certificate issuance and ALB security-group reachability remain runtime checks.
- The namespace NetworkPolicy excludes two IPv4 AWS metadata addresses from its broad egress rule ([`k8s/01-namespace.yaml:59-63`](../k8s/01-namespace.yaml)). Confirm the platform-specific metadata addresses and IPv6 configuration at runtime.
- The BFF HTTPS upstreams in the local NGINX config validate certificates ([`demo_api_ui/nginx.conf:51-67`](../demo_api_ui/nginx.conf)), demonstrating an existing repo pattern that can be carried into the AWS override.
- Kubernetes resource-server Services use `ClusterIP` ([`k8s/63-mcp-resource-server-deployment.yaml:100-115`](../k8s/63-mcp-resource-server-deployment.yaml)); this avoids creating a direct external Service endpoint, though it does not replace network policy.
- The Compose BFF's auxiliary HTTP and callback ports are loopback-bound ([`docker-compose.yml:261-270`](../docker-compose.yml)).

## Production verification still required

This report does not establish that the hosted environment has the same effective configuration as the checked-in manifests. Before calling a deployment production-ready, verify from an authorized `cmuir` or `curtismuir` namespace and cloud scope:

1. Render the exact manifests/Helm output used by the deployed revision; compare it with this evidence.
2. Identify the CNI and prove the NetworkPolicy is enforced. Run allowed and denied connectivity checks between representative pods.
3. Inspect effective ALB listeners, certificate coverage/expiry, redirect behavior, security groups, and ALB-to-target reachability. Confirm the target link's encryption assumptions.
4. From a frontend pod, confirm the BFF certificate chain and SAN validate with verification enabled; test failure on an untrusted certificate.
5. Confirm the MCP server cannot be reached except through the authorized gateway path, and test that direct calls from unrelated workloads fail.
6. Enumerate effective pod egress, including IPv6, DNS, metadata endpoints, and external destinations.
7. Review Pod Security Admission warnings/audit results, migrate exceptions, and determine whether restricted enforcement is practical.
8. If local Compose is used on a shared host, inspect host firewall exposure and confirm optional observability profiles are not unintentionally enabled.

## References

- [RFC 9325 — Recommendations for Secure Use of TLS and DTLS](https://www.rfc-editor.org/rfc/rfc9325.html)
- [RFC 9852 — New Protocols Using TLS Must Require TLS 1.3](https://www.rfc-editor.org/rfc/rfc9852.html)
- [RFC 10015 — Deprecating Obsolete Key Exchange Methods in TLS 1.2 and DTLS 1.2](https://www.rfc-editor.org/rfc/rfc10015.html)
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://www.rfc-editor.org/rfc/rfc8705.html)
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
- [Kubernetes Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/)
- [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/)
