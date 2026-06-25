# Architecture Diagram Accuracy & Completeness — Design

**Date:** 2026-05-15
**Status:** Implemented (2026-05-15). All three workstreams shipped. Verification: ArchitectureDiagram.completeness 28/28, ArchitectureTabsPanel.anon 3/3, `npm run build` exit 0, all 4 PNG mtimes > their `.mmd` sources, both regenerated diagrams render without Mermaid errors. §4 Bug Fix Log entry + §1-row supplement note added. Mid-implementation scope correction: `i4ai-ref-arch.mmd` was found to be the source for `/architecture/token-flow` and moved in-scope (see correction note below).
**Scope:** Audit and correct every diagram reachable from the **Architecture** side-nav menu so it matches the actually-implemented 9-service topology. Three outcomes, decided with the user:
1. Fix the `architecture.mmd` port bug **and regenerate the PNG**.
2. Make **all** Architecture diagrams complete (every running service + current flows represented).
3. Make the **conceptual model accurate** — the default agent is the BFF in-process LangGraph agent; gateway routing is `MCP_GATEWAY_HTTP_URL`-conditional.

**Out of scope:** Non-Architecture-menu diagrams (`docs/diagrams/*.drawio`, `docs/CHATGPT_INTEGRATION_PLAN.md`); the `mcp-security-gateway.mmd` source (renders `token-flow2.png`, not surfaced by any Architecture-menu route); any non-diagram refactor.

> **Scope correction (2026-05-15, mid-implementation):** the original draft excluded `i4ai-ref-arch.mmd` as "not in the Architecture menu." This was wrong — `/architecture/token-flow` renders `token-flow.png`, which `scripts/build-diagrams.sh` builds **from `i4ai-ref-arch.mmd`**. The token-flow page's JSX (`ArchitectureTokenFlowPage.js` + `config/diagram-token-flow-regions.js`) only positions highlight-overlay rectangles over that PNG; it does not draw service boxes. Therefore W2 for the token-flow page edits `i4ai-ref-arch.mmd` (a Mermaid **sequenceDiagram**) and regenerates `token-flow.png` via the pinned pipeline. `i4ai-ref-arch.mmd` is now **in scope**; only `mcp-security-gateway.mmd` remains out.

---

## Context: this is the second pass on Phase 270

REGRESSION_PLAN §4 (2026-05-14, Phase 270) already ran an "architecture diagram completeness audit" and added a Jest enforcer (`ArchitectureDiagram.completeness.test.js`) that parses `SVC_LIST` from `run-demo.sh` and asserts every service name appears in at least one `.mmd` source. **That test checks name *presence* only — not port correctness, not per-page completeness, not the conceptual model.** This pass closes the gaps the presence test cannot see.

§1 protected row ("Architecture diagram completeness", line 78) governs this work. **Invariants this change must not break:**
- The completeness Jest test must still pass (all `SVC_LIST` services present in `.mmd` sources).
- No emoji outside the `⚠️ ✅ ❌` allowlist in any `.mmd` source or UI text.
- No secret-value substrings (`VAULT_PASSWORD=`, `client_secret=`, `_SECRET=`, `api_key=value`) in any diagram label.
- Every regenerated PNG's mtime must be **newer** than its `.mmd` source.
- The `/architecture/*` route group stays anon-safe — no new admin-only mount-time fetches (§4 2026-05-12).
- `cd banking_api_ui && npm run build` exits 0 after any UI edit.

This is a **documentation-accuracy fix**, so it gets a §4 Bug Fix Log entry (the port collision is a shipping-affecting factual error in a customer-facing educational page).

---

## Findings (audited 2026-05-15 against implemented code)

Ground truth: 9 services — `banking_api_server` :3001, `banking_api_ui` :4000, `banking_mcp_server` :8080, `banking_mcp_gateway` :3005, `banking_mcp_invest` :8081, `banking_hitl_service` :3009, `banking_agent_service` :3006, `banking_mortgage_service` :8082, `langchain_agent` :8888 (uvicorn) / :8889 (chat WS) / :8890 (health+inspector).

### F1 — 🔴 Port collision bug in `architecture.mmd` (the only hard error)

- `architecture.mmd:96` — `HealthInsp["Health :8081\n/health · /inspector/mcp-host"]`. langchain_agent's health/inspector is **:8890**, not :8081. :8081 is `banking_mcp_invest`. The same file lists invest correctly on :8081 at line 110 → **two services collide on :8081 in one diagram**.
- Same line uses a literal `\n` instead of `<br/>` (mermaid renders the backslash-n literally).
- `architecture.mmd:94` — subgraph title `langchain_agent (Python · FastAPI + WS)` omits all three ports (8888/8889/8890).
- **Not** present in `architecture-simple.mmd` — that file (line 50) is correct: `:8888 chat WS :8889 - health :8890`. Per Phase 270 §4 note, `architecture-simple.mmd` is the source for `overview.png`; `architecture.mmd` is the detailed 14-node source for `overview2.png`.

### F2 — 🟠 Per-page completeness gaps (presence test can't see these)

The Jest test only requires a service to appear in *one* `.mmd`. Individual rendered pages are still incomplete:

| Page (route) | Source | Missing vs. reality |
|---|---|---|
| `/architecture/system` (ArchitectureTabsPanel → InteractiveArchDiagram) | hardcoded JSX, 5 nodes | Self-labeled "intentionally partial". Comment already points to `overview.png` as authoritative (Phase 270). **Decision: leave the 5-node interactive view; it is deliberately a teaser, and §4 records the user chose to keep it.** Only verify the pointer comment is accurate. |
| `/architecture/overview` (ArchitectureOverviewPage) | `architecture-simple.mmd` → `overview.png` | Complete already (Phase 270 brought it current). Verify PNG mtime ≥ source after F1 regen. |
| `/architecture/token-flow` (ArchitectureTokenFlowPage) | hardcoded JSX, 15-step | No `banking_hitl_service`, no `banking_mortgage_service`, no `banking_resource_server`. Vintage pre-Phase-266. |
| `/architecture/flow` (ArchitectureFlowPage) | hardcoded JSX, 28-step React Flow | `banking_mcp_invest` absent; HITL only a generic node. |
| `/architecture/phase-266` (Phase266ArchitecturePage) | live Mermaid in JSX | No `banking_mcp_invest`, no `banking_hitl_service`. **Decision: acceptable — this page is scoped to the Phase 266 three-credential-path story; invest/HITL are out of that scope. Add a one-line scope caption instead of forcing unrelated nodes in.** |

### F3 — 🟡 Conceptual-model inaccuracy (user chose "make it accurate")

- The **default** agent is the BFF in-process LangGraph agent (`/api/banking-agent/*` in `banking_api_server`). `banking_agent_service` :3006 and `langchain_agent` are optional alternatives. Token-flow and flow diagrams draw "Agent" as a standalone box in the main path, implying the separate service is the default.
- Gateway routing is **conditional** on `MCP_GATEWAY_HTTP_URL`; when unset, BFF talks to `banking_mcp_server` directly (legacy fallback). Token-flow/flow show the gateway as unconditional.

---

## Approach

Three independent workstreams, smallest-diff each. No cross-cutting refactor.

### W1 — `architecture.mmd` port fix + PNG regen (closes F1)

Edit `architecture.mmd` only:
- Line 94 subgraph title: `langchain_agent (Python · FastAPI + WS)` → `langchain_agent (Python · uvicorn :8888 · chat WS :8889 · health :8890)`.
- Line 96: `HealthInsp["Health :8081\n/health · /inspector/mcp-host"]` → `HealthInsp["Health :8890<br/>/health · /inspector/mcp-host"]` (correct port + real `<br/>`).
- No other line in `architecture.mmd` changes.

Regenerate PNGs via the **existing pinned pipeline** (`scripts/build-diagrams.sh`, mermaid-cli@11) — do not hand-render. Only `overview2.png` (the `architecture.mmd` output) must change, but running the script regenerates all four; that is fine and matches the §1 "PNG newer than source" rule. Verify all four PNG mtimes ≥ their `.mmd` source mtime after the run.

### W2 — Token-flow & flow page completeness (closes F2 for the two interactive pages)

These are hardcoded JSX, not `.mmd`. The change is **additive node/edge data + labels**, no logic change to the simulation engines.

- `ArchitectureTokenFlowPage.js`: add `banking_hitl_service` (:3009), `banking_mortgage_service` (:8082), `banking_resource_server` (logical on :3001) to the participant set and the relevant credential-path scenarios. The page already encodes the three Phase 266 paths in narrative steps — extend the node list to match.
- `ArchitectureFlowPage.js`: add a `banking_mcp_invest` (:8081) node + the invest WS edge; promote the generic `hitl` node label to `banking_hitl_service :3009`.

Minimal-diff rule: touch only the node/edge/participant declaration arrays and their labels. Do not restyle, re-layout, or refactor the React Flow / step-engine code.

### W3 — Conceptual-model accuracy (closes F3)

Lowest-risk form: **labels + one annotation line**, not structural redraws.

- Where diagrams show a standalone "Agent" box on the default path, relabel to make the default explicit, e.g. `Agent (BFF in-process LangGraph — default)` and annotate `banking_agent_service :3006` / `langchain_agent` as **optional / alternative** (dashed or "(optional)" suffix consistent with each diagram's existing convention for planned/aspirational nodes — `architecture.mmd` already uses dashed for Phase 268 K8s).
- Where the gateway is on the path, add a short edge/footnote label: `via banking_mcp_gateway when MCP_GATEWAY_HTTP_URL set; else direct WS to :8080`.
- Apply consistently across `ArchitectureTokenFlowPage.js`, `ArchitectureFlowPage.js`, and `architecture.mmd` (the detailed source) so the rendered Overview and the interactive pages tell the same story.

### Per-page disposition summary

| Page | Action |
|---|---|
| `/architecture/system` | **No diagram change.** Verify the InteractiveArchDiagram top-comment still correctly names `overview.png` / `architecture-simple.mmd` as authoritative. |
| `/architecture/overview` | **No source edit.** PNG regenerated as a side effect of W1; verify mtime. |
| `/architecture/token-flow` | W2 + W3. |
| `/architecture/flow` | W2 + W3. |
| `/architecture/phase-266` | Add one scope caption line: "Scope: Phase 266 credential-disposition paths only — investment & HITL services intentionally omitted." No node changes. |
| (source) `architecture.mmd` | W1 + W3. |

---

## Non-goals

- No change to the simulation/step-engine logic in any interactive page — node/edge/label data only.
- No restyle, re-layout, or visual redesign. (If a visual polish pass is wanted later, that is a separate `impeccable` task.)
- No deletion of the intentionally-partial 5-node `InteractiveArchDiagram`.
- No edit to `i4ai-ref-arch.mmd` / `mcp-security-gateway.mmd` (not in the Architecture menu).
- No change to `ArchitectureDiagram.completeness.test.js` assertions (it must keep passing as-is — we are adding accuracy on top, not weakening the presence guard).
- No hand-rendered PNGs — only the pinned `scripts/build-diagrams.sh`.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Editing `banking_api_ui/` files (§1 protected, `/architecture/*` route group) | Required gate | State §1 invariants before edit (done above). Data-only edits to node/label arrays. `npm run build` must exit 0. Run `ArchitectureTabsPanel.anon` + `ArchitectureDiagram.completeness` Jest tests after. |
| PNG regen pipeline drift (mermaid-cli version, missing local dep) | Medium | Use `scripts/build-diagrams.sh` exactly (mermaid-cli@11 pinned per §1). If the script fails locally, **stop and report** — do not hand-edit a PNG (that would violate §1 and produce an unreproducible artifact). |
| Adding nodes to interactive pages breaks the step simulation (index/length assumptions) | Medium | Inspect each page's step-engine for hardcoded participant counts before adding nodes. Add nodes without renumbering existing steps; extend, don't reorder. Manual click-through of each page after the change. |
| Over-cluttering token-flow/flow by forcing every service in | Low | Add only services that genuinely participate in that page's flow. Phase-266 page gets a scope caption instead of forced nodes. |
| Completeness test already green — a new node label typo could falsely satisfy/fail it | Low | Test matches service names from `SVC_LIST`; keep exact `banking_*` spellings. Re-run the test after edits. |
| Regenerated PNG accidentally drops a node vs. prior render | Low | Visually diff `overview2.png` before/after the regen; confirm only the langchain port label changed. |

---

## Verification gate

```bash
# 1. mmd lint: no disallowed emoji, no secret substrings (manual scan + the Jest test covers it)
cd banking_api_ui && CI=true npx react-scripts test --watchAll=false \
  --testPathPattern='ArchitectureDiagram.completeness'        # must pass

# 2. PNG regen via pinned pipeline
bash scripts/build-diagrams.sh
ls -la --time-style=full-iso architecture.mmd banking_api_ui/public/architecture/overview2.png
#   → overview2.png mtime MUST be newer than architecture.mmd

# 3. UI build gate (mandatory after banking_api_ui edits)
cd banking_api_ui && npm run build                            # exit 0

# 4. Regression: anon-safe route group not broken
cd banking_api_ui && CI=true npx react-scripts test --watchAll=false \
  --testPathPattern='ArchitectureTabsPanel.anon'              # still passes

# 5. Manual: click through all 5 /architecture/* pages
#    - token-flow & flow: new nodes render, simulation still steps without console errors
#    - overview: PNG shows langchain :8890 (not :8081)
#    - phase-266: scope caption visible
```

**Done =** all five commands green + manual click-through clean + a §4 Bug Fix Log entry added for F1 (the port collision) with the template, and a §1-row note that the Phase 270 presence test was supplemented by this accuracy pass.

---

## Rollout

Reviewable commits:

1. **W1** — `architecture.mmd` port fix only. Regenerate PNGs. Verify mtimes. (1 source file + 4 PNGs.)
2. **W2** — token-flow + flow page node/edge additions. UI build. Manual click-through.
3. **W3** — conceptual-model labels across token-flow, flow, `architecture.mmd`; regen PNGs again. Phase-266 scope caption.
4. **Docs** — REGRESSION_PLAN §4 entry for F1 + §1-row supplement note.

Each commit: `npm run build` 0 and the two Jest tests green before the next.

---

## Next steps

1. User review of this spec.
2. On approval: invoke `superpowers:writing-plans` for the commit-by-commit plan.
3. Implement W1 → W2 → W3 → Docs, verifying at each commit.
