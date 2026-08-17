# SPIFFE / SPIRE — Implementation Plan (Super Banking demo)

**Status:** Phase 0 (education) shipped. Phases A–D not built.
**Last corrected:** 2026-08-17.

> **This document was rewritten because the previous version was wrong.** Its Phase 2
> instructed the reader to "Create a JWT Issuer in PingOne → Security → JWT Issuers" so
> PingOne would trust SPIRE-signed JWTs as `actor_token`. **That feature does not exist.**
> The old version also named services (`banking_api_server`, `banking_mcp_server`) that
> were renamed, and an npm package (`@spiffe/spiffe-workload-api`) that is not published.
> Everything below was verified against Ping's documentation, the live discovery document
> for environment `01d89b06-66d5-430e-9f28-65636843788b`, the SPIRE GitHub releases API,
> and the npm registry. Do not re-derive it — see the Decision log.

---

## What SPIFFE provides

SPIFFE (Secure Production Identity Framework For Everyone) is a CNCF standard for
cryptographic **workload** identity. Instead of a secret passed between services, each
workload is issued an **SVID** (SPIFFE Verifiable Identity Document) by a trusted
authority, after that authority inspects what the process actually is.

| Concept | Description |
|---|---|
| **Trust domain** | Namespace for identities, e.g. `spiffe://bxfinance.demo` |
| **SPIFFE ID** | URI naming one workload, e.g. `spiffe://bxfinance.demo/bff` |
| **X.509-SVID** | Short-lived TLS certificate — used for mTLS between workloads |
| **JWT-SVID** | Short-lived signed JWT — used as a bearer or actor token |
| **Workload API** | Local endpoint (Unix socket) each workload calls to fetch its own SVID |
| **Trust bundle** | CA root(s) distributed to all workloads to verify peers |
| **Attestation** | The issuer identifies the caller by runtime evidence (container image, k8s service account, process UID) — never by a password |

The user-facing explanation of all of this now lives in the UI:
`demo_api_ui/src/components/education/SpiffePanel.js` (Learn menu → Security & standards →
"SPIFFE / SVID workload identity"). Keep the two consistent.

---

## The blocking constraint: what PingOne can actually consume

Verified against `docs.pingidentity.com` (reached via `llms.txt`) and the live
`https://auth.pingone.com/01d89b06-.../as/.well-known/openid-configuration`.

| Capability | PingOne verdict | Constraint |
|---|---|---|
| `private_key_jwt` with `jwksUrl` or inline `jwks` | **Supported** | Assertion `iss` **and** `sub` must both equal the PingOne `client_id`. `RS256/384/512` only — no ES\*, no EdDSA. `exp` rejected if more than 1h out. `iat`/`jti` not validated. |
| RFC 8693 token exchange | **Supported** | — |
| SPIRE-issued JWT as `subject_token` / `actor_token` | **NOT supported** | Docs, verbatim: *"The issuer of the subject token and the actor token matches the issuer of the current PingOne environment."* There is no trusted-external-issuer, token-provider, or attribute-provider object in the PingOne authorization server. |
| `act` claim on the issued token | Supported, **not automatic** | Requires a custom resource attribute named `act` driven by a PingOne Expression Language expression, plus a `may_act` claim on the subject token. |
| RFC 8705 mTLS client authentication | **NOT supported** | Four token-endpoint auth methods exist; none is mTLS. Absent from live discovery. |
| Certificate-bound tokens (`cnf` / `x5t#S256`) | **NOT supported** | No `tls_client_certificate_bound_access_tokens` key. Zero hits across the 902-entry PingOne docs index. |
| DPoP (RFC 9449) | **NOT supported** | No `dpop_signing_alg_values_supported`, in PingOne *or* PingFederate docs. |
| SPIFFE / SPIRE | **PingFederate only** | PingFederate's JWT Token Processor 2.0 can trust the SPIRE OIDC Discovery Provider as an issuer, accept a JWT-SVID as an actor token, and land the full `spiffe://…` URI in `act.sub`. The equivalent PingOne guidance uses client secrets and never mentions SPIFFE. |
| `AI_AGENT` application type | GA 2026-03-31, **licensed** | Behind the Agent IAM Core package. Whether it exists in env `01d89b06` is an open question — see below. |

**Therefore:** PingOne cloud is a closed trust domain. A SPIRE-issued SVID can never be an
`actor_token` there, and PingOne cannot issue a sender-constrained token at all. A SPIFFE
ID can only ride along as a non-authenticating custom claim.

### The one achievable win

Register a workload's PingOne application with `private_key_jwt`, point its `jwksUrl` at
SPIRE's OIDC Discovery Provider, and have the workload sign its client assertion with a
SPIRE-issued, auto-rotating RSA key. **The static `client_secret` is deleted.** The
assertion's `iss`/`sub` remain the PingOne `client_id`; the SPIFFE ID is decorative.

Everything below builds toward that, plus real SPIFFE mTLS on the hops we control.

---

## Phase A — stand up the SPIFFE server (SPIRE)

**Component: SPIRE.** The CNCF reference implementation of SPIFFE and the server this
demo will use.

| | |
|---|---|
| Project | <https://github.com/spiffe/spire> — CNCF graduated |
| License | **Apache-2.0** |
| Version verified | **v1.15.2**, released 2026-07-09 (pin an explicit tag; do not use `latest`) |
| Images | `ghcr.io/spiffe/spire-server:1.15.2`, `ghcr.io/spiffe/spire-agent:1.15.2` |
| Helper sidecar | `ghcr.io/spiffe/spiffe-helper:0.11.0` — see Phase B |
| OIDC bridge | `ghcr.io/spiffe/oidc-discovery-provider:1.15.2` — see Phase C |

SPIRE has two halves: a **server** (the CA and registration authority, holding the trust
domain's signing keys) and an **agent** per node (which runs the Workload API socket,
attests local workloads, and hands them SVIDs).

### A1. Compose profile

Add `spire-server` and `spire-agent` to `docker-compose.yml` behind a new `spiffe`
profile, following the `rag` profile precedent (`docker-compose.yml:840`) so the lean
default stack is unaffected. `./run-docker.sh` starts without them; `--profile spiffe`
opts in.

The agent's socket directory must be a shared volume mounted into every workload
container that needs an SVID.

### A2. Trust domain and workload map

Trust domain `spiffe://bxfinance.demo` (keep — it already appears in the education
material). Note the mock route in `demo_api_server/routes/spiffeDemo.js` uses
`demo.local`; leave that alone, it is a self-contained playground fixture.

| Workload | SPIFFE ID | Container | Secret it would replace |
|---|---|---|---|
| BFF / API server | `spiffe://bxfinance.demo/bff` | `demo-api-server` | `PINGONE_ADMIN_CLIENT_SECRET` |
| AI agent identity | `spiffe://bxfinance.demo/agent` | `demo-api-server` (embedded) | `PINGONE_AI_AGENT_CLIENT_SECRET` |
| MCP gateway | `spiffe://bxfinance.demo/mcp-gateway` | `demo_mcp_gateway` | `MCP_GW_CLIENT_SECRET` |
| MCP server | `spiffe://bxfinance.demo/mcp-server` | `oauth-mcp` (compose `mcp-server`) | WS bearer header |

### A3. Attestation

- **Node attestation** (server trusts agent): use `join_token` for local Compose — simplest
  thing that works, one token minted at stack start. In Kubernetes (`k8s/`, SE AWS) switch
  to the `k8s_psat` node attestor.
- **Workload attestation** (agent identifies the caller): use the `docker` workload
  attestor locally, selecting on a container label, and `k8s` in-cluster. Registration
  entries are created with `spire-server entry create -spiffeID … -parentID … -selector …`.

### A4. Key type — the trap that will bite

PingOne accepts `RS256/384/512` only. SPIRE's defaults are elliptic-curve. The SPIRE
server config must be set to RSA before any of Phase C works:

```hcl
server {
  trust_domain = "bxfinance.demo"
  ca_key_type  = "rsa-2048"   # X.509-SVID / CA key
  jwt_key_type = "rsa-2048"   # JWT-SVID signing key
}
```

**Verify these key names against the SPIRE 1.15 configuration reference before writing the
file** — they are recorded here from the general SPIRE configuration surface, not copied
from a version-pinned page.

**Deliverable:** `docker compose --profile spiffe up` yields a running SPIRE server and
agent; `spire-server entry show` lists the four workload entries; a test container can
fetch an SVID from the Workload API socket.

---

## Phase B — get the SVID into Node

**There is no official SPIFFE client library for Node.** The npm registry has no
`@spiffe/*` Workload API package (the old version of this document cited
`@spiffe/spiffe-workload-api`, which returns `{"error":"Not found"}`). The packages that
do match a `spiffe` search are third-party and unvetted.

**Use `spiffe-helper` instead** — an official SPIFFE-project sidecar (Apache-2.0, v0.11.0).
It calls the Workload API, writes the SVID and key to disk as PEM, rewrites them on every
rotation, and can signal or exec a command afterwards. Node then only has to read files.

This fits the existing code exactly: `clientAssertionService.getPrivateKeyPem()`
(`demo_api_server/services/clientAssertionService.js:26`) already returns a PEM string.

New `demo_api_server/services/spiffeWorkloadClient.js`:

- `getJwtSvid(audience)` — read the JWT-SVID written by `spiffe-helper`.
- `getSigningKeyPem()` / `getKid()` — read the current SVID private key PEM and its key id.
- Watch the PEM path with `fs.watch` and invalidate the in-process cache on rotation. This
  is load-bearing: the key changes every few minutes, and any caching that survives
  rotation produces intermittent `invalid_client` from PingOne — the worst possible
  failure mode to debug.
- Config keys `spiffe_svid_path`, `spiffe_key_path`, `spiffe_bundle_path`,
  `spiffe_trust_domain` registered in `demo_api_server/services/configStore.js`
  (`FIELD_DEFS`), with env aliases.

**Deliverable:** the BFF can read a live, rotating SVID key pair at runtime.

---

## Phase C — replace one PingOne client secret

Wire the SVID key into the existing `private_key_jwt` path. **No change to
`oauthService.js:83` `applyTokenEndpointAuth()`** — `private_key_jwt` is already a branch
there, and `clientAssertionService.resolveAuthMethod()` already decides when to use it.

1. In `clientAssertionService.js`, source the PEM and `kid` from `spiffeWorkloadClient`
   instead of the static `pingone_client_jwt_private_key` config value, behind a new flag
   (`ff_spiffe_client_auth`) so the existing behaviour is untouched when off.
2. Publish SPIRE's JWKS. Run `oidc-discovery-provider`, which serves the trust domain's
   public keys at a standard OIDC discovery endpoint.
3. Set the PingOne application's `jwksUrl` to that endpoint.

### The deployment constraint that decides where this can run

**PingOne fetches `jwksUrl` from the public internet over HTTPS, unauthenticated, with no
custom trust certificate.** A SPIRE OIDC Discovery Provider running in local Docker
Compose is not reachable from PingOne, so **Phase C cannot be demonstrated on a laptop
against real PingOne.** Options, in order of preference:

- **Deploy on the SE AWS cluster**, which already has a public hostname
  (`ai-demo.ping-devops.com`) and ingress — expose the discovery provider on a path there.
- Inline the JWKS on the PingOne app instead of a URL. **Rejected as the primary path:**
  SPIRE rotates its JWT signing key, so an inline JWKS goes stale and authentication
  breaks on the next rotation.
- A tunnel for local demos. Acceptable for development, not for a repeatable demo.

**Deliverable:** one workload authenticates to PingOne with no `client_secret` anywhere in
its environment, and its key rotates automatically.

---

## Phase D — SPIFFE mTLS on the hops we own

PingOne is not involved here, so full SPIFFE fidelity is achievable.

1. **BFF → MCP server.** `demo_api_server/services/mcpWebSocketClient.js` presents its
   X.509-SVID; `oauth-mcp/src/server/DemoMCPServer.ts` (already `requestCert: true` when
   mTLS is on) validates the peer against the SPIRE trust bundle instead of the SHA-256
   pin in `oauth-mcp/src/auth/mtlsMiddleware.ts`, and enforces the peer SPIFFE ID.
2. This replaces statically generated certificates from
   `scripts/ensure-gateway-mtls-certs.sh` with attested, auto-rotating ones.
3. **Blocker to clear first:** `MCP_MTLS_ON` is deliberately empty because the Privilege
   MCP console-configured backend breaks against an mTLS listener
   (`privilege/PRIVILEGE-MCP.md:444`). That has to be resolved or scoped around before
   mTLS can be turned on at all.
4. **Then, and only then**, `demo_api_ui/src/components/TokenChainDisplay.jsx`
   `fmtActNode()` (~line 2894) can detect a `spiffe://` URI in `act.sub` and render it
   distinctly. Doing it earlier is dead code — nothing in the demo emits such a value.

---

## What is deliberately NOT in this plan

| Ambition | Why it is out |
|---|---|
| JWT-SVID as the RFC 8693 `actor_token` at PingOne | PingOne validates that both exchange tokens were issued by its own environment. Requires PingFederate. |
| `cnf` / certificate-bound access tokens from PingOne | No RFC 8705, no DPoP, no `cnf` mechanism of any kind. |
| SPIFFE ID as the authenticated client identity | The client assertion's `iss`/`sub` must equal the PingOne `client_id`. |

If cryptographic workload attestation must reach the `act` chain for a customer story,
**PingFederate is the component that does it** and PingOne is not — that is a separate
plan, not a variation of this one.

---

## Open questions

1. **Is the `AI_AGENT` application type licensed in env `01d89b06`?** It is behind the
   Agent IAM Core package (GA 2026-03-31). Check with the PingOne MCP server or the admin
   console before designing around it.
2. **Exact SPIRE 1.15 config key names** for RSA key types (Phase A4).
3. **Where Phase C runs** given the public-`jwksUrl` constraint — SE AWS is the assumed
   answer, needs confirming with whoever owns that cluster.

---

## Decision log

| Decision | Rationale |
|---|---|
| Corrected this document rather than extending it | The previous Phase 2 depended on a PingOne "JWT Issuers" feature that does not exist; anyone following it would have burned a day before discovering that. |
| `spiffe-helper` sidecar, not an npm Workload API client | No official SPIFFE Node client is published. `spiffe-helper` is maintained by the SPIFFE project and writes PEMs that the existing `clientAssertionService` already knows how to consume. |
| SPIRE as the SPIFFE server | CNCF reference implementation, Apache-2.0, actively released (v1.15.2, 2026-07-09). |
| Education panel before any runtime work | Phase 0 delivers demo value at zero regression risk, and forces the honesty about what is mock versus real. |
| Keep the existing client-secret path as fallback | With `ff_spiffe_client_auth` off, behaviour is byte-identical to today. |
| `spiffe://bxfinance.demo` kept as the trust domain | Already used in the education material; the `demo.local` in the playground mock is separate and stays. |

---

## References

- [SPIFFE specification](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE.md)
- [SPIRE](https://github.com/spiffe/spire) — Apache-2.0, CNCF graduated
- [spiffe-helper](https://github.com/spiffe/spiffe-helper) — Apache-2.0
- [JWT-SVID spec](https://github.com/spiffe/spiffe/blob/main/standards/JWT-SVID.md)
- [RFC 8693 — OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693) §2.1 `actor_token`
- Ping: "Securing agents with PingFederate" — the only Ping-documented SPIFFE integration
- Internal: `demo_api_ui/src/components/education/SpiffePanel.js`,
  `demo_api_server/services/clientAssertionService.js`,
  `demo_api_server/services/agentMcpTokenService.js`, `docs/RFC-STANDARDS.md`
