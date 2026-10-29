# PLAN: Personal Agent Protocol (Poppy) support

Spec: https://personalagentprotocol.org/docs/0.3/spec (Draft 0.3, breaking changes possible before 1.0).
Status: plan only, nothing built. Written 2026-10-29. Gap list inferred from repo notes; verify against code in Phase 0.

## Goal and scope

Make AI-DEMO2 act as a Poppy **Company** (the side that publishes discovery docs and verifies agents). Phases 1 and 2 are the ask. Phases 3 and 4 are optional.

Not in scope: the Personal Agent side (a signer for delegated keys), the conversations API, browser session handoff.

## Success criteria (done =)

1. `GET https://<host>/.well-known/poppy.json` returns a document that validates against the Poppy kit's JSON Schema and validator (`kit/company/` in github.com/personal-agent-protocol/personal-agent-protocol).
2. `GET https://<host>/.well-known/oauth-protected-resource` returns `resource` exactly `https://<host>` with `authorization_servers` naming the issuer.
3. The issuer's RFC 8414 metadata includes `issuer`, `token_endpoint`, `revocation_endpoint`, `grant_types_supported` with `refresh_token`, `scopes_supported`, and `protected_resources` listing `https://<host>`.
4. A request carrying a Bearer token and no `Poppy-Session` header is rejected; a request with a valid session JWT is accepted; each failure mode returns HTTP 400 `invalid_session`.
5. Proven on local and SE with real requests (curl plus a test signer), not 200-only checks.

## Phase 0: confirm what exists (read-only)

- `demo_mcp_resource_server/src/index.ts:475` already serves RFC 9728 metadata at `/.well-known/oauth-protected-resource`. Check whether `resource` can be the bare `https://<host>` and where it is routed in ingress.
- `docs/2026-10-07-cimd-privilege-client-documents.md` and the PF CIMD port: record what the agent's `client_id` metadata URL looks like and whether it is publicly fetchable on SE (hosted-access wall 401s anonymous fetches).
- Decide which issuer is "the" issuer for the Company: PF or P1. Poppy needs exactly one per Company.

## Phase 1: discovery documents (static, low risk)

1. `poppy.json`: `protocol_version` "0.3", `organization` (name, domain), `auth.issuer`, `auth.scopes`, `auth.scope_hints` (`changes` and `personal_data` for every scope), `apis[]` (the `mcp` door URLs and any `openapi`).
2. Serve `/.well-known/poppy.json` from the BFF or nginx; the final path must be exactly that, HTTPS only.
3. `/.well-known/oauth-protected-resource` at the domain root (`resource` = `https://<host>`).
4. Authorization server metadata: PF will not emit `protected_resources`. Serve a wrapper document that copies PF's metadata and adds the field, or point `authorization_servers` at a small metadata proxy. Needs a decision (see open questions).
5. Follow the new-route checklist: `auth-requirements.json`, oauth-bypass ingress, e2e storageState seed. These documents must be reachable anonymously, which the SE wall currently blocks.

Verify: kit validator against the live URLs on local and SE.

## Phase 2: Poppy-Session verification (the real work)

Where: a shared verifier module used by the BFF and `demo_mcp_resource_server` (MCP servers may ignore the header per spec 7, but the resource server is the natural first target).

Checks in spec order:
1. Parse `Poppy-Session` header JWT: `typ` `poppy-session+jwt`, `alg` ES256, `kid` = JWK thumbprint of the delegated key, `pap_dlg` = compact delegation.
2. Verify the delegation JWT against the agent's `jwks_uri` (fetched via CIMD `client_id` metadata). `typ` `pap-delegation+jwt`, ES256 or PS384, `iss` = client_id, `exp` at most 24h after `iat`, `cnf.jwk` present, no identifying data.
3. Verify the session JWT with `cnf.jwk`. Check `aud` = issuer, `htm` and `htu` match the request, `iat` window, unique `jti`, `sid` present.
4. When an access token is present: `ath` = SHA-256 of the token, token's `client_id` = session `iss`. Reject token with no session header.
5. Errors: HTTP 400 `{"error":"invalid_session"}`; extra rule: `sub` must be stable per Session.

Also needed: a **test signer** (small script in `scripts/`) that builds a delegation plus session JWT, so the verifier can be tested without a real Personal Agent.

Tests: unit tests per failure mode (bad `typ`, expired delegation, over-24h delegation, wrong `htu`, wrong `ath`, replayed `jti`, missing header with a token). Mind the jest network guard: JWKS fetch must be stubbed.

## Phase 3 (optional): token side on PF/P1

- PF: confirm pairwise `sub` per Company, `private_key_jwt` client auth with ES256 and PS384, `resource=` handling, DPoP (SHOULD).
- P1: no DPoP and no CIMD; use only as plain OIDC behind PF if needed.
- Scopes: define `orders:read`-style scopes with `scope_hints`.

## Phase 4 (optional): conversations API

Five endpoints (`POST {endpoint}`, messages, events, handoff, close). Thin adapter over the existing agent runtime. Defer unless a Personal Agent counterpart exists.

## Decisions (owner, 2026-10-29)

1. Company domain: SE host `ai-demo.ping-devops.com`.
2. Issuer: PingFederate.
3. `protected_resources`: wrapper document copying PF metadata plus the extra field, served by the BFF.

Still open: whether a Personal Agent side (signer plus CIMD document) is wanted later; it changes where the test signer lives.

## Risks

- Spec is Draft 0.3; field names may change before 1.0.
- SE hosted-access wall blocks anonymous fetches of discovery documents and CIMD metadata; needs bypass rules.
- Repo is a shared checkout: use a worktree for the implementation.
