# Agentic Architecture Gaps — What's Built, What's Left

**Date:** 2026-08-26 · **Status:** scoped, not started · **Scorecard:** <https://claude.ai/code/artifact/3fa621fe-6154-44d6-a0c9-2913a04e206b>

> **For agentic workers:** this is a scoping document, not a task-by-task plan. Each numbered
> item below is one PR in its own worktree. Before implementing any of them, re-verify the
> "what exists" claims — they were traced on 2026-08-26 and code moves.

**Goal:** score every box in the Ping agentic reference architecture against what AI-DEMO2
actually runs, and scope only the boxes that are genuinely ours to build.

---

## 0. The two framing decisions

**AI Gateway *is* PingOne Privilege.** Not a box to build, not a product to buy alongside
Privilege — it is what Privilege is now called. All four sub-gateways (LLM, MCP, A2A, AI Guard)
are its features. The repo already reflects this: the nav entry reads "AI Gateway Client", and
the string "AI Gateway" appears nowhere else in the codebase except as the Privilege product
name (`demo_api_server/routes/privilegeMcpClient.js`,
`demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`).

This cancels four previously-scoped build items: the A2A depth-cap/cycle guard, the
registry-driven virtual-MCP refactor of `demo_mcp_gateway/src/router.ts`, LLM
allow-list/quota/cost work in `demo_llm_proxy/router.js`, and replacing the prompt-injection
regexes with a classifier. `demo_llm_proxy` stays a local dev convenience and is no longer on a
path to becoming an enterprise gateway.

**Integration is not free.** Three of the four sub-gateways have **no demo traffic passing
through Privilege today** — LLM calls go to the local proxy, A2A delegation is BFF-local, and
prompt guarding runs in-process. Only the MCP tool-call path is wired. Proving each of the other
three means routing that path through Privilege and surfacing the decision in the UI. That cost
cannot be estimated until the new Privilege feature's config surface is visible.

**Secret Stores is already filled** by the existing `secrets.vault` (Argon2id KEK, per-entry
DEK), 1Password CLI at startup, K8s Sealed Secrets and dotenvx. Vendor integrations (Delinea,
CyberArk, AWS Secrets Manager, GCP Secret Manager) are deliberately out of scope.

**"NHI inventory / Workload IDP" is not a separate item.** The diagram's Workload IDP box has
contents identical to the JIT Policy box (Credential Vault, SVIDs, JIT Injection, Rotation &
revocation) — the same capability aimed at workloads instead of agents. Its halves fold into
Items 1 and 2: the broker is built subject-agnostic, and the registry enumerates workload
identities (`client_credentials` clients) alongside agents via an `identityType` field.

### Open item: the thin local fallback

If demo traffic does not route through Privilege's guard, the seven regexes in
`demo_api_server/services/promptSanitizer.js` remain the only prompt protection on that path —
and a prospect typing `Ignore all prior directives` (not "previous instructions") walks straight
past them on stage. Either route that path through Privilege, or label the regexes explicitly as
a local fallback so nobody demos them as the control.

---

## 1. Generalize the JIT credential broker

### What exists (verified 2026-08-26, with the trap named)

Two gateways implement the same disposition **differently**:

- **PingGateway / IG** (`ff_mcp_gateway_pinggateway` default ON) *does* broker:
  `ping-gateway/scripts/groovy/apikey-dispatch.groovy:130` fetches
  `{BFF_VAULT_KEY_URL}?name=DEMO_API_RESOURCE_SERVER_KEY` behind the
  `x-internal-gateway-secret` guard, then attaches the result as `X-API-Key` at `:143`.
- **Node gateway** (`demo_mcp_gateway`) does **not** broker at all: it reads the key from
  `process.env` once at boot (`src/config.ts:339,:396`) and reuses it for the process lifetime
  (`src/apiKeyDispatch.ts:99,:141-143,:147-154`).

`demo_api_server/routes/vaultServiceKey.js:72` returns `{ name, value }` — the raw plaintext
key. No expiry, no nonce, no binding to caller or tool, **and no audit write**. Downstream,
`demo_api_resource_server/server.js:72-77` does a constant-string compare, so it has no concept
of expiry to enforce — which is why a TTL alone would be theatre.

Ten tools use this path (`demo_mcp_gateway/src/router.ts:160-171`), one per vertical, with
`show_investment` using a second key against the invest service.

**Dead code, not a broker:** `routes/apiKeyExchange.js` + `services/apiKeyService.js` run the
opposite direction (key→JWT), have zero callers, and 403 on every input because `API_KEY_STORE`
is unset repo-wide. `apiKeyExchange.js:7` claims the groovy calls it; it does not. Do not build
on these. Deleting them and their mount (`server.js:1144`) is a reasonable scoped cleanup since
they actively misdescribe this subsystem — but treat it as optional and separable.

### Design

**The static key becomes a signing key and stops travelling on the wire.** The broker mints a
short-TTL HMAC-signed credential; the backend verifies it with the secret it already holds. No
new secret to provision, and rotation reuses the existing `ROTATE_SERVICE_KEYS=1` path.

Credential shape (HS256, signed with the existing `API_RESOURCE_SERVER_API_KEY`):

```text
{ jti, iss: 'bff-broker', aud: <backend route>, tool: <toolName>,
  sub: <requesting gateway>, iat, exp: iat + 30s }
```

**BFF (`demo_api_server`)**

- `services/jitCredentialBroker.js` *(new)* — `mintCredential({ keyName, tool, requester })`
  → `{ value, jti, expiresAt, ttlMs }`. Signing secret via
  `configStore.getEffective('demo_api_resource_server_key' | 'demo_invest_service_key')`.
  Refuses to mint when `killSwitchService.isAgentRevoked(requester)` — this is the diagram's
  "revocation" bullet, reusing the existing kill switch rather than inventing one.
- `routes/vaultServiceKey.js` — **PROTECTED** (`REGRESSION_PLAN.md:3957`, `:9265`). Accept a
  new `?tool=` param; when `ff_jit_credentials` is ON return the minted credential plus
  `expiresAt`, when OFF behave byte-identically to today. Keep all five existing guards in the
  same order with the same response bodies (503 `vault_disabled_insecure_secret`, 403
  `forbidden`, 404 `not_allowlisted`, 404 `key_unset`, 503 `key_not_provisioned`).
- Audit the issuance into the existing durable store via the `mcpAuditIngest` path —
  `eventType: 'credential_issued'`, `{ tool, keyName, jti, ttlMs, requester }`. Reuses
  `services/lmdb/mcpAuditStore.lmdb.js` and its 5000-event cap; no new store.

**Backends** (`demo_api_resource_server/server.js:72-77`, plus the invest path in
`demo_mcp_resource_server`) — accept either a valid signed credential (verify HMAC, `exp`, and
that the `tool` claim matches the route being served) or, with the flag off, the legacy static
key. Replay defence: bounded `jti` set, mirroring the sweep-then-FIFO-evict shape of
`demo_mcp_gateway/src/boundedTokenCache.ts:29-47`.

**Gateways — both, so the broker is the single chokepoint**

- IG: `apikey-dispatch.groovy:130` — append `&tool=<toolName>` to the bridge URL. The value
  handling is unchanged; it still just puts the returned string in `X-API-Key`.
- Node: `src/apiKeyDispatch.ts` — replace the `config.apiResourceServerApiKey` read with a
  per-call broker fetch, mirroring `src/dualTokenDispatch.ts:39-54` (`fetchIdTokenFromBff`),
  which already does exactly this handshake with the same `x-internal-gateway-secret`. Add
  `bffVaultKeyUrl` to `config.ts`. **Do not cache** — per-call is the point.

**Flag:** `ff_jit_credentials`, three-point wiring per topology bundle K2/K13 — `FLAG_REGISTRY`
in `routes/featureFlags.js`, `FIELD_DEFS` in `services/configStore.js`, optionally `QUICK_FLAGS`
in `QuickFlagsPill.js`.

### Verification

- **Regression gate first:** `demo_api_server/tests/vaultServiceKey.test.js` must pass
  **unchanged** with the flag off. That file pins the protected behaviour.
- New tests: flag on → credential carries a future `expiresAt`; an expired credential is
  rejected by the backend; a replayed `jti` is rejected; a `tool`-claim mismatch is rejected; a
  revoked agent gets no credential at all.
- Extend `demo_mcp_gateway/tests/apiResourceServerDispatch.test.ts` — assert the Node path now
  calls the broker rather than reading `process.env`.
- Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`. Do **not** pass
  `--testPathIgnorePatterns` (it replaces rather than appends and drags `/tests/real/` against
  the live stack). Gateway: `cd demo_mcp_gateway && npm test`.
- **Live check, per `verify-ai-demo2`:** which gateway serves a call is a runtime flag decision.
  Confirm from container logs which path actually handled the request — code existing is not
  evidence it ran.

---

## 2. Real control-plane catalog / registry

### What exists

No unified registry — nine disconnected stores, of which four hold genuinely real data. The
mock `IgaForAiPage.jsx` describes the target UX (stat tiles + rows with source/owner/status);
`agentStudioMockStore.js` is localStorage and its `registerAgent()` has zero callers. The
control-plane roster's ChatGPT / Copilot / Glean rows are hardcoded and session-scoped.
`AgentLifecyclePage.jsx:10-27` step 1 is a video captioned "live registration isn't built yet"
— steps 2–4 are real. `AgentBuilder` **is** real: it creates actual PingOne applications and
stores nothing locally, so PingOne is the authoritative inventory.

### Design

Copy the one existing unify pattern in the repo — `demo_api_server/data/serverInventory.js` +
`GET /api/health/inventory` + `ServersPage.jsx`: source list, live probe, **always-200 merged
payload with per-source `{ up, error }`** so a PingOne outage degrades one section instead of
500ing the page.

#### Row sources (all real)

| Source | Call | `identityType` |
|---|---|---|
| PingOne applications | `agentBuilderService.listEnvironmentAgents()` (carries `builderCreated`) | `agent` |
| Demo OAuth clients | `oauthClientRegistry.listClients()` — `client_credentials` only | `workload` ← the NHI fold-in |
| A2A specialists | `a2aAgentCardService.buildAllSpecialistAgentCards()` | `agent` |
| MCP servers | `data/serverInventory.js`, `category: 'mcp'`, with its live probe | `service` |
| Personal agent doors | `routes/mcpFacade.js` doors (LM Studio / LibreChat / Claude) | `external` |

A2A cards are computed today but have **no HTTP route mounted** — adding one is a few lines and
makes 11 specialists catalog-visible.

#### Joins that turn a list into governance

- Expected scopes from `scope-topology.json` (`scopeTopology.appGrantedScopes()`) vs actual
  grants from `agentBuilderService.getAgentGrants()` → **scope drift** flag. Real signal, from
  data that already exists, and the single most demo-worthy column here.
- Lifecycle/JML from `agentLifecycleEvents.query({ agentId })` (durable LMDB, cap 2000).
- Revoke action wired to the existing `killSwitchService`.

#### Files

- `demo_api_server/services/agentRegistryService.js` *(new)* — the union + joins.
- `demo_api_server/routes/agentRegistry.js` *(new)* — `GET /api/registry/agents`,
  `GET /api/registry/agents/:id`.
- A2A Agent Card route *(small addition)*.
- `demo_api_ui/src/pages/AgentRegistryPage.jsx` *(new)* — built on the shared
  `components/shared/InspectorShell.jsx` set per the `inspector-template` skill: left =
  searchable list grouped by `identityType`, middle = identity detail, right = tabs
  (Grants + drift, Lifecycle, Audit, Raw JSON). Model the multi-source handling on
  `McpInspectorPage.jsx`'s `.source-switcher` + `?source=` deep-link pattern.
- `AdminSideNav.jsx` — add to an **existing** topical group, not a new one.
- `AgentLifecyclePage.jsx:10-27` — replace the video slot with a link into the real
  `AgentBuilder`, closing the "Onboarding for Developers" box.

#### Deliberately out of scope

Certification / access review (not in the diagram — that is the IGA-for-AI gap that
`/platform-gaps` correctly says Ping does not ship) and Agent Discovery.

Once the real registry lands, point `/iga-for-ai` at it rather than leaving a fake beside a real
one. Leave `/platform-gaps` alone — it is honest and is an asset.
`PrivilegesGatewayPreviewPage.jsx`'s hardcoded `MOCK_LOG` and literal stats are a separate
decision, not bundled here.

### Verification

- `cd demo_api_server && CI=true node_modules/.bin/jest tests/agentRegistry* --forceExit`
- `cd demo_api_ui && npm run test:unit && npm run build` (build must exit 0)
- Assert the registry returns 200 with `up: false` on a source when PingOne is unreachable —
  degradation is the design, so it needs a test.
- Assert a seeded scope mismatch surfaces as drift.
- Manual click-through per `inspector-template`: row select → detail fills → tabs render. A
  green suite is not a substitute for clicking it once.

---

## 3. SPIFFE SVID validation + exchange

### Why this is not "just a mock"

`docs/SPIFFE_PLAN.md:53` records the real constraint: **PingOne cloud** has no
trusted-external-issuer object, so a SPIRE-issued SVID can never be an `actor_token` there.
But **PingFederate's JWT Token Processor 2.0 does** trust the SPIRE OIDC Discovery Provider,
accept a JWT-SVID as an actor token, and land the full `spiffe://…` URI in `act.sub`.

Decision: PingFederate is not in reach, so build the local validator — but scope it as a
**parity mock of PingFederate's documented behaviour**, not an invention. Only the trust
decision is stood in for; the cryptography is real. The demo line is "PingOne cloud is a closed
trust domain; PingFederate can do this and here is that behaviour" — which survives scrutiny in
a way "we mocked SPIFFE" does not.

### What is actually broken today

`demo_api_server/routes/spiffeDemo.js` `/verify` **validates nothing**. It calls
`decodeDemoJwt` (`utils/demoJwt.js`) — a base64 decode with no signature, `exp`, `aud`, or
`iss` check — then string-splits `sub` for the trust domain. Minting is `alg: none` with the
literal signature `demo-signature-not-cryptographically-valid`. Any SVID can be forged by
hand. This is a correctness hole, not just a fidelity gap.

### Design

- **Real signing.** Replace `alg: none` with RS256, and publish the trust domain's public keys
  as a JWKS (reuse `services/jwksService.js` / `routes/oauthJwks.js`; `oauth-mcp`'s
  `SigningKeyManager` is the key-management precedent).
- **Real verification** in `/verify`: signature against the trust bundle, `exp`, `aud`, `iss`,
  and SPIFFE ID format per the spec. Existing JWT verification to model on —
  `jwt-verifier-mcp-server/src/services/jwtVerifierService.ts`,
  `demo_mcp_jwt_verifier/server.py`, `services/tokenValidationService.js`.
- **SVID → token exchange** in `demo_authz_server` — the mock-PingOne AS, which already issues
  tokens (`routes/token.js`), already implements the PingOne API surface, and already carries
  `mockCloudParity` tests as the established idiom for "PingOne can't, so we built parity."
  Add an RFC 8693 branch accepting a JWT-SVID as `actor_token`
  (`actor_token_type: urn:ietf:params:oauth:token-type:jwt`), validated against the trust
  bundle, landing `spiffe://…` in `act.sub` — mirroring the PingFederate behaviour above.
- Flag-gated, off by default, per the three-point wiring (K2/K13).

Issuer stays mocked (no SPIRE container) — real crypto, simulated attestation. Phases A/B/D of
`docs/SPIFFE_PLAN.md` (real SPIRE, `spiffe-helper`, mTLS on owned hops) remain unbuilt and are
the upgrade path; Phase C still cannot run on a laptop against real PingOne because PingOne
fetches `jwksUrl` from the public internet.

### Verification

Forgery is the test that matters: an SVID with a tampered payload, a wrong `iss`, an expired
`exp`, or a foreign trust domain must all be **rejected** — today every one of them passes.

---

## 4. Parked — decisions with reasons on record

**Real SPIRE (Phases A/B/D).** [SPIRE](https://github.com/spiffe/spire) (Apache-2.0, CNCF
graduated) — cited in `docs/SPIFFE_PLAN.md` at `:79` and `:268`, along with
[spiffe-helper](https://github.com/spiffe/spiffe-helper) and the SPIFFE / JWT-SVID specs. That
doc scopes the phases and records why it stopped at Phase 0. An earlier version was wrong on
this exact point — it told the reader to create a PingOne "JWT Issuer" that does not exist —
and was rewritten 2026-08-17. **Read the current version, not a memory of it.**

**ReBAC** — needs SpiceDB alongside P1AZ; evaluated and rejected in
`docs/superpowers/specs/2026-08-02-intent-routing-and-p1az-authz-design.md`.

**Agent Discovery** — scanning Bedrock / Vertex / Foundry / browsers for unmanaged agents is
CASB/EDR work, not IAM.

**Secret-store vendor integrations** — the existing vault stack fills that box (§0).

**Ephemeral K8s pod agents** — cheap once Item 2 exists (a Job that gets a workload identity at
start and loses it at exit), pointless before it.

All of these stay listed on
`demo_api_ui/src/components/agentStudioPreview/PlatformGapsPage.jsx` (`/platform-gaps`), which
is honest about Ping not shipping them and is worth keeping that way.

---

## 5. Cross-cutting

- **Worktree required** — edit/test/commit only in an isolated git worktree; a hard-block hook
  denies `Write`/`Edit` in the main checkout. One branch and one PR per item.
- **regression-guard** before the first edit of Items 1 or 2 — `demo_api_ui` and
  `routes/vaultServiceKey.js` are both protected areas.
- **Emoji allowlist:** `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only.
- **Never conclude from a piped command's exit status** — redirect to a file and read it, or
  check `${PIPESTATUS[0]}`.
- Live drives: pin the stack generation before and after
  (`gen="$(npm run -s stack:generation)"` … `npm run -s stack:generation -- --check "$gen"`).

## 6. Order

Item 1 first (broker, flag-gated and off by default until its tests are green), then Item 2,
then Item 3. They share no files, so they can also run in parallel worktrees if several
sessions are available. Item 2 is blocked on nothing external and is the highest-value item the
demo can build on its own.
