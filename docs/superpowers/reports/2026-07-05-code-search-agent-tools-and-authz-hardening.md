# Code Search Agent Tools + Token-Authz-Chain Hardening — Work Report

**Date:** 2026-07-04 → 2026-07-05
**Author:** Claude Code session
**Merged PRs:** #138, #139, #151, #175, #178, #180 (all to `main`)

---

## 1. Executive summary

Starting from "finish setting up Weaviate," this effort grew into: getting the RAG
code-search stack working, indexing the codebase, exposing it to agents as three
**scoped MCP tools** wired end-to-end through the demo's **real PingGateway (IG) +
PingOne + RFC 8693** authorization chain, and finally **hardening** that chain so a
new tool can't silently break any of its authorization layers again.

Six PRs landed. The headline results:

- Code search works: 24,712 chunks indexed; UI page functional; three agent tools
  (`code_search`, `get_code`, `list_codebases`) callable **end-to-end through real
  PingGateway** with a new `code:search` scope.
- Live PingOne provisioned via the startup reconciler across the whole exchange
  chain (Agent Gateway → MCP Gateway → MCP Server).
- **Four hidden authorization layers** (beyond the scope-topology SSOT) were
  discovered by driving a live agent call and fixed.
- A **drift-prevention gate** (`topology:verify` steps 6–7 + a pre-commit
  auto-regen) now stops those layers from silently diverging.

---

## 2. Weaviate + indexing (PRs #138, #139, #151)

**Two config bugs made the index 500 on every write** (see also the
`project-weaviate-code-search-setup` memory):

1. **Weaviate raft had no leader** — the node derives its raft ID from the random
   container hostname, but the persisted volume referenced a dead node ID; every
   schema/index op returned `500 "leader not found"` while the raft-free
   `/v1/meta` healthcheck stayed green. Fixed by wiping the empty volume; made
   durable with `CLUSTER_HOSTNAME` in compose.
2. **Embeddings batch was 512 tokens** — real 40-line code chunks are often
   1000-2000 tokens, so `/v1/embeddings` 400'd. Fixed with `-c 32768 -b/-ub 8192`.
3. **BFF had no `MCP_CODE_SEARCH_URL`** — defaulted to `localhost:8095` (itself).

**PR #138** landed these durably in `docker-compose.yml`. **Codebase indexed:**
2,826 / 2,881 files → 24,712 chunks (the rest are minified/generated files whose
40-line chunks exceed nomic's 8192-token limit).

**PR #139** — the Code Search UI page rendered blank rows: `SearchResults.jsx`
read `file_path`/`relevance_score`/`code_snippet` but the API returns
`file`/`relevance`/`snippet`; also a React-StrictMode `useEffect` clobbered the
saved codebase list on reload. Both fixed.

**PR #151** — the codebase menu only came from per-browser `localStorage`, so an
API-indexed codebase never appeared. Added a server-backed `GET /codebases`
(service → BFF → UI) so the menu always shows what's actually indexed.

---

## 3. Code search as scoped agent tools (PR #175)

Designed via brainstorming (spec:
`docs/superpowers/specs/2026-07-04-code-search-agent-tools-design.md`), planned,
and executed with subagent-driven TDD (8 tasks, each reviewed).

**What shipped:**

- **`demo_mcp_code_search`** — `getCode()` reconstructs a file line-range by
  stitching the indexed 40-line overlapping chunks (no repo mount, no re-index);
  exposed as `POST /code`.
- **`demo_mcp_server`** — three handlers (`code_search`/`get_code`/
  `list_codebases`) calling the code-search service via `MCP_CODE_SEARCH_URL`,
  registered as tools with `requiredScopes: ['code:search']`, `readOnly: true`,
  `requiresUserAuth: false`, and `outputSchema`.
- **`scope-topology.json` (SSOT)** — new `code:search` scope (home = MCP Server
  resource), mirrored onto the MCP Gateway + Agent Gateway resources so the
  reconciler provisions it across the exchange chain; three tool→scope entries.
- **Whole-app touch-point audit** — confirmed the SSOT drives the reconciler,
  bootstrap, the hardening verify gate, and the mock gateway's tool→scope map.

**Review notes surfaced + fixed during TDD:** `getCode` returning requested
(vs actual stitched) line bounds; `list_codebases` not mapping 503→"unavailable";
the 3 tools missing `outputSchema` (broke the `outputSchemas` contract test); a
`limit` clamp (1–25). One subagent mis-committed to the wrong branch (the
documented worktree-cwd hazard) — caught and redone by the controller.

---

## 4. Live PingOne provisioning — Agent Gateway + MCP chain (part of Task 7)

The BFF's **`twoExchangeReconciler`** runs at startup, reads `scope-topology.json`,
and self-heals live PingOne. After landing the manifest and restarting the BFF, it
logged (`"Healed"`):

- Created `code:search` on the **Super Banking Agent Gateway** resource →
  granted to the **AI Agent** app (Two-Exchange **Step 1** audience).
- Created `code:search` on the **Super Banking MCP Gateway** resource → granted to
  the **MCP Exchanger** app (Two-Exchange **Step 2** audience).
- Created `code:search` on the **Super Banking MCP Server** resource → granted to
  the **MCP Gateway** app (final backend audience).

So the whole RFC 8693 exchange chain (User/Agent token → Agent Gateway → MCP
Gateway → MCP Server) carries `code:search`. The **User App grant was NOT needed**
— `code_search` is `requiresUserAuth:false` and runs on the agent/actor token
(later confirmed by e2e, and the speculative User-App grant was removed in #180).

**Note:** the live hardening gate `verify-scope-configuration --manifest-diff`
needs `PINGONE_MGMT_CLIENT_ID/SECRET` (absent in this env; the reconciler uses
other creds), so that particular check couldn't run here — the reconciler's own
create/grant is the authoritative live mutation.

---

## 5. Runtime activation + live end-to-end (Task 8, PR #178)

Rebuilt the built images (`demo-mcp-code-search`, `mcp-server`) and — critically —
the **gateway images** (`mcp-gateway`, `authz-server`) that **bake** `scope-topology.json`
(they have no repo mount), so the gateway enforces `code:search` rather than
falling back to `read`.

Driving a **live agent tool call** (`POST /api/mcp/tool`, logged-in session)
through the real chain surfaced **four authorization layers that are NOT
SSOT-derived** — each rejected `code_search` at a different point. PR #178 fixed
the first three:

| # | Layer | Symptom | Fix |
|---|---|---|---|
| 1 | `intentTokenService.js` `permitted_tools` (prompt-injection allowlist) | gateway HTTP 400 | add code-search tools to `INTENT_TO_PERMITTED_TOOLS` + `READ_ONLY_TOOLS` |
| 2 | `configStore.js` `buildAllowedScopesByAudience()` (RFC 8707 allowlist) | `SCOPE_MISMATCH` for mcpserver.ping.demo | add `code:search` to the MCP Gateway + MCP Server audiences |
| 3 | `mcp-tool-schemas.json` (PingGateway tool config, generated) | `Unknown tool: code_search` from PingGateway | regenerate via `gen:tool-schemas` (219 tools) |
| 4 | mock gateway `toolScopes` | (already SSOT-derived + gated) | image rebuild only |

**Verified end-to-end against REAL PingGateway** — confirmed the path is Ping's
Identity Gateway product (`us-docker.pkg.dev/forgeops-public/images-base/ig:latest`),
`X-Authz-Simulated: false`, real PingOne introspection, real RFC 8693 exchanges
(only the TraT header is simulated). All three tools returned **HTTP 200**:
`list_codebases` (24,712 chunks), `code_search` (ranked snippets @ 81%), `get_code`
(actual source lines).

---

## 6. P1AZ (PingOne Authorize) integration touched

`code:search` flowing through the manifest reached the P1AZ decision path via the
existing derivations (no hand-editing needed, but verified):

- The **P1AZ cloud-policy snapshot** (`snapshots/…P1AZ.snapshot.json`) is
  auto-regenerated by the pre-commit hook whenever the scope surface changes; the
  `scopeTopology.regression` guard pins the P1AZ decision-path constants
  (`gatewayAudience()`, `gatewayToolNames()`) to the manifest.
- The **mock PingOne Authorize rule store** (`demo_authz_server`) parity test
  (`topology.parity.test.js`) confirmed `allowedScopes()` / `gatewayToolNames()`
  and per-tool `requiredScopes` all match the manifest after adding `code:search`
  and the three tools.
- Both are steps in `topology:verify` (3/7 and 5/7), so P1AZ stays in lock-step.

The mock authz gateway (`demo_mcp_gateway`) vs the real PingGateway: the demo
toggles via `FF_MCP_GATEWAY_PINGGATEWAY` (real is the running default). Decision
recorded to **keep both** (the mock's transparent Node implementation has teaching
value) and keep them in sync — which motivated the hardening below.

---

## 7. Token-authz-chain drift hardening (PR #180)

**Problem:** onboarding `code_search` required editing four hidden authorization
lists; three had no (or one-directional) drift guard, so breakage only appeared at
live e2e. Spec:
`docs/superpowers/specs/2026-07-05-tool-authz-chain-drift-hardening-design.md`.

**Design revised during implementation** after measuring the live tool set:

- **Inv-1 — PingGateway schema drift: GATED.** `mcp-tool-schemas.json` is now
  checked by the existing `toolSchemaDrift` test in `topology:verify` (step 6/7)
  and **auto-regenerated in `.husky/pre-commit`** when tool sources change
  (mirroring the P1AZ-snapshot auto-regen precedent). The pre-commit trigger was
  extended to fire on `demo_mcp_server/src/tools/**`, `investTools.ts`,
  `gatewayTools.ts`, `intentTokenService.js`, `configStore.js`, and
  `mcp-tool-schemas.json`.
- **Inv-2 — permitted_tools coverage: DROPPED.** Only 42 of 204 gateway-surface
  tools are in the curated `permitted_tools` map; the other 163 (generated vertical
  + demo tools) are intentionally absent. "Every tool must be permittable" is
  false, so no coverage invariant is workable without a new "agent-reachable"
  signal (out of scope). The existing forward parity guard stays.
- **Inv-3 — scope-audience coverage: FIX + GATE.** A new parity test (step 7/7)
  asserts every gateway-surface tool's `requiredScopes` are in the RFC 8707
  allowlist for the MCP Gateway (and MCP Server, minus the documented gateway-only
  `transfer` asymmetry). Implementing it exposed **5 latent missing scopes**
  (`invest/permits/transcript/workorders/sensitive:read`) — the same
  `SCOPE_MISMATCH` bug `code:search` hit, for the investment/government/university/
  workforce/sensitive tools through PingGateway. Fixed by adding them to
  `buildAllowedScopesByAudience()` for both audiences.

**Also corrected a pre-existing PR #175 drift:** removed `code:search` from the
User App grant. It is on the MCP Server resource (agent-invoked), not the enduser
API the User App's `/authorize` targets — so it could never be requested there
(and would trip PingOne's "multiple resources" rule). This was surfaced by the
`oauthUser.js authorize scopes ⊇ topology grant` guard, which my new gate correctly
flagged.

**Result:** `topology:verify` is now **7 steps, all green**. Adding a tool now
either auto-updates PingGateway's schema at commit time or the gate fails loudly
with a precise "add X to Y" message across the schema, scope-audience, and P1AZ
layers.

---

## 8. PRs (all merged to `main`)

| PR | Title |
|---|---|
| #138 | durable Weaviate/embeddings/BFF config for the RAG index |
| #139 | Code Search UI: render result fields + StrictMode localStorage fix |
| #151 | server-backed codebase list (menu always shows indexed codebases) |
| #175 | code search as scoped agent tools (`code:search`) |
| #178 | wire code-search tools through the full agent token chain (intent + configStore + PingGateway schema) |
| #180 | gate PingGateway schema + scope-audience coverage (drift hardening) |

---

## 9. Known open items / follow-ups

- **`verify-scope-configuration --manifest-diff`** (live PingOne diff) can't run in
  this env — missing `PINGONE_MGMT_CLIENT_ID/SECRET`. The reconciler's live
  create/grant is the authoritative check used instead.
- **5 vertical scopes newly allowed at the exchange layer** (invest/permits/
  transcript/workorders/sensitive) — the configStore/scope-audience layer is now
  consistent, but each vertical's full end-to-end path (permitted_tools mapping,
  PingGateway schema, PingOne grants) was not individually e2e-verified. The new
  gate makes any remaining gap visible.
- **Stray commit `e945fa4ae`** on `fix/architectural-improvements` — a harmless
  byte-identical duplicate of the mcp-server `MCP_CODE_SEARCH_URL` env line (a
  subagent misfire). Left in place (removing it risks the dirty running checkout);
  no-ops on merge.
- **Weaviate `CLUSTER_HOSTNAME`** — applied live via a one-time volume-wipe +
  reindex; a future force-recreate would need the same one-time step (documented).
- **Main-checkout live state** — the running stack (on `fix/architectural-improvements`)
  carries the merged changes as uncommitted working-tree landings; they match
  `origin/main`.

---

## 10. Lessons

- **The tool-authz chain has more layers than the SSOT.** `scope-topology.json`
  drives most consumers, but three enforcement layers (intent `permitted_tools`,
  the RFC 8707 scope-audience allowlist, and PingGateway's generated tool schema)
  are hand-maintained or generated-but-ungated. Onboarding a tool touches all of
  them; only a gate makes that safe.
- **Component tests pass while the assembled chain fails.** Every unit was green
  and `topology:verify` passed, yet the live agent call failed four times. Driving
  the real end-to-end path (through real PingGateway) is what found the gaps — and
  motivated hardening them.
- **Guards encode intent, including asymmetries.** The `transfer` gateway-only
  exclusion and the sparse `permitted_tools` map are deliberate; a naive "cover
  everything" invariant would fight them. The gate must respect documented
  asymmetries, not flatten them.
