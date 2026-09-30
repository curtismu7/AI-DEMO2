# Trusted Agent Transactions Design

## Goal

Add an explicit trusted-mode path for the full agent tool catalog. In that path, the signed-in user, approved logical agent, running SPIRE workload, agent run, transaction, purpose, and immediate caller are independently represented and checked. The existing default governed path remains available unchanged.

## Scope and success criteria

The first release is one independently testable vertical slice spanning the BFF, agent service, transaction-token issuer, both MCP gateways, downstream adapters, PingFederate configuration, SPIRE configuration, live PingOne Authorize request context, and the UI toggle.

Trusted mode succeeds only when all of these are true:

1. A signed-in user enables the visible trusted-mode toggle for an agent run.
2. The agent workload presents an attested SPIRE identity through the authenticated BFF callback.
3. PingFederate validates the PingOne user subject token and the SPIRE JWT-SVID actor token in one RFC 8693 exchange. PF OGNL mappings bind `sub`, `act`, and the verified SPIFFE ID; caller-provided agent identity is never authoritative.
4. A dedicated local transaction-token issuer validates PF's signed exchange result and issues a short-lived JWT with `typ: txntoken+jwt`, `iss`, `aud: bxfinance.demo`, `iat`, `exp`, `txn`, `sub`, `scope`, `req_wl`, `act`, `agentic_ctx`, and `tctx`.
5. The same token is sent in exactly one `Txn-Token` header on every owned internal HTTP hop. It is verified and forwarded byte-for-byte; it is never used as an OAuth bearer or workload authentication credential.
6. The immediate caller is authenticated independently with SPIFFE mTLS on BFF → gateway, gateway → MCP server, MCP server → resource/API, and agent → BFF callback hops where those hops are owned by this repository.
7. Both the Ping Identity Agent Gateway path and the Node demo gateway path require the trusted transaction token and use live PingOne Authorize. Trusted mode never falls back to mock P1AZ or local scope permits.
8. P1AZ receives verified transaction attributes: user, logical agent, current workload, transaction ID, run ID, purpose, tool, arguments digest, scope, caller SPIFFE ID, and gateway hop. Existing scope, amount, resource-owner, intent, HITL, and step-up rules remain active.
9. Every tool in the catalog is either routed through a trusted gateway adapter or rejected as unsupported. A local BFF/vertical handler cannot silently bypass trusted checks.
10. Tests prove valid flow, missing/forged/expired/wrong-audience tokens, altered arguments, wrong SPIFFE peer, gateway mismatch, P1AZ outage, and mock-policy selection all fail closed.

## Architecture

The UI stores trusted mode as run-scoped state. The BFF remains the sole browser-token custodian. The agent service receives only an opaque run reference and calls the BFF callback. The callback authenticates the agent workload with SPIFFE mTLS and obtains the agent JWT-SVID from the workload API or a mounted helper output; it does not accept an agent ID supplied in JSON.

The BFF sends the user's PingOne access token as the RFC 8693 subject token and the agent JWT-SVID as the actor token to PF. PF validates the subject issuer/JWKS and SPIRE issuer/JWKS, requires the actor, and maps the verified actor `sub` to an approved logical-agent record. PF returns a signed short-lived delegation result. A dedicated `trusted-transaction-issuer` service, reachable only over SPIFFE mTLS, validates that result and signs the Txn-Token. This keeps PF's supported access-token generator contract intact while giving the application the exact transaction-token header and JWT semantics.

The BFF calls the selected gateway with the normal OAuth access token for gateway authentication and the separate `Txn-Token` header for transaction context. The Ping Identity gateway's Groovy policy filter and the Node gateway's TypeScript middleware perform the same validation and P1AZ attribute derivation. Each gateway forwards the unmodified header to its next owned hop. External third-party APIs receive only the adapter's permitted API credential; the repository does not claim that an external API understands `Txn-Token`.

## Token profile

The issuer uses an asymmetric signing key with a JWKS endpoint and key rotation. The protected header is `typ=txntoken+jwt`, `alg=RS256`, and a rotating `kid`. The trust-domain audience is the exact configured value `bxfinance.demo`.

Required claims:

```json
{
  "iss": "https://local.ping-devops.com:3045",
  "aud": "bxfinance.demo",
  "iat": 0,
  "exp": 0,
  "txn": "uuid",
  "sub": "pingone-user",
  "scope": "read mcp:invoke",
  "req_wl": "spiffe://bxfinance.demo/agent",
  "act": { "sub": "urn:agent:banking" },
  "agentic_ctx": {
    "current_actor": "urn:agent:banking",
    "originator": "urn:agent:banking",
    "chain_metadata": { "hop_count": 1 }
  },
  "tctx": {
    "run_id": "run-id",
    "purpose": "tool invocation",
    "tool": "get_my_accounts",
    "args_sha256": "sha256:..."
  }
}
```

The issuer chooses `sub`, `act`, `req_wl`, and agent context from PF-verified claims and a server-side agent registry. It accepts tool, purpose, run, and argument data only from the BFF run context and binds the argument digest to the exact request body. It does not copy the user's access token into the Txn-Token.

## PF and OGNL changes

Add a PingOne subject JWT processor with the configured PingOne issuer and JWKS endpoint. Retain the SPIRE JWT processor but publish the SPIRE JWKS rather than an embedded static key. Update the token-exchange processor policy to require an actor and expose `subject`, `scope`, `client_id`, and `spiffeId`. Add issuance criteria that reject an unknown SPIFFE ID, a non-approved actor, a missing user subject, or a scope that expands the user's grant. Use OGNL in the access-token mapping to produce the nested `act` object and the PF-signed delegation claims consumed by the issuer. Generated PF JSON remains source-controlled and is validated against the live descriptor before any live import.

## PingOne Authorize contract

Extend the generated snapshot and request contract with `TrustedMode`, `TxnTokenValid`, `TxnId`, `RunId`, `Purpose`, `AgentId`, `AgentInstanceId`, `WorkloadSpiffeId`, `ImmediateCallerSpiffeId`, `TxnTool`, `TxnArgsDigest`, `TxnScope`, and `TxnReqWorkload`. Trusted mode requires `TrustedMode=true`, `TxnTokenValid=true`, exact trust-domain audience, and equality between the token tool/digest and the current MCP request. The policy denies a missing or mismatched tuple, wrong workload-to-agent mapping, scope expansion, stale hop metadata, and any request evaluated by a mock or local-fallback engine.

Existing P1AZ conditions remain the authority for tool scope, amount limits, resource ownership, intent binding, HITL, and step-up. The Node client and PingGateway Groovy filter must send the same attribute names and values. A trusted request that cannot reach live P1AZ is denied.

## Gateway and hop behavior

The two gateways share a validation contract: one `Txn-Token` header, valid signature/JWKS `kid`, issuer, trust-domain audience, time window, required claims, tool and argument digest, and an allowed immediate SPIFFE peer. Duplicate headers, bearer-only trusted requests, token rewrites, upstream-audience tokens, and direct backend calls are rejected. Forwarding code copies the original header value without decoding and re-serializing it.

Gateway adapters cover all entries in `demo_mcp_gateway/src/router.ts`, plus BFF-local vertical handlers. Read-only discovery may return the catalog, but a trusted `tools/call` must always pass through the same transaction and P1AZ gate.

## UI and operational behavior

Add a visible “Trusted transaction mode” toggle beside the agent run controls. It is off by default, is captured when the run starts, and cannot be changed mid-run. Turning it on requires a signed-in session and displays the active trust domain and live P1AZ requirement. Token-chain events expose claims and decision metadata only; raw access tokens, actor JWT-SVIDs, private keys, and Txn-Tokens are never sent to the browser or logs.

The mode is disabled with a clear error if SPIRE, PF, the transaction issuer, mTLS, or live P1AZ is unavailable. There is no trusted-mode fallback to the mock policy, local scope engine, direct BFF handler, or bearer-only forwarding.

## Testing and rollout

Implement in stages: token issuer and validator; PF/SPIRE wiring; BFF and agent callback; Node gateway; PingGateway; local adapters and catalog coverage; UI and trace events; then live P1AZ policy import only after generated snapshot and focused tests pass. Tests run against deterministic fixtures first, then the running local Docker profile. Live PingOne policy mutation is a final operator action and is not performed implicitly by tests.

The acceptance run records one full catalog matrix and one representative call through each gateway, with evidence for the five steps and negative cases. The report must call out any external API boundary where the Txn-Token cannot be propagated.

## References

- IETF Transaction Tokens draft: https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/
- IETF Transaction Tokens for Agents draft: https://datatracker.ietf.org/doc/draft-araut-oauth-transaction-tokens-for-agents/
- PingFederate token exchange: https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_defining_token_exchange_processor_policies.html
- PingFederate JWT token processor: https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_config_json_web_token_process_instance.html
- PingGateway JWT validation: https://docs.pingidentity.com/pinggateway/2026/reference/JwtValidationFilter.html
