# PRD — Graphify Education Panel

**Date:** 2026-07-08  
**Status:** SHIPPED, but **not to this spec** — see note below. Verified 2026-08-17.  
**Audience:** SE / engineers / “how agents navigate this repo”  
**Surface:** Education drawer panel (same pattern as Weaviate RAG), not a customer banking page

> **Shipped differently than specced.** Graphify education landed as
> `demo_api_ui/src/components/GraphifyPage.jsx` — a standalone page reached from
> `AdminSideNav.jsx`, registered in `config/navStructureCatalog.js` and
> `config/heroVariants.js`. The **Surface** line above calls for an education
> *drawer panel* following the Weaviate RAG pattern; no such panel exists.
>
> Open decision, the only work left here: either move this content into the
> drawer as specced, or accept the page and amend the Surface line. Until that is
> decided this PRD reads as unmet while the feature is in fact live.

---

## Problem

Agents and humans exploring this monorepo default to blind grep. The repo already ships a **graphify** knowledge graph (`graphify-out/`) with `query` / `path` / `explain`, but nothing in the demo UI teaches what it is, why agents use it first, or how it differs from Code Search (Weaviate) and Code Explorer (codegraph).

## Goal

Add an education panel that teaches:

1. **What** a codebase knowledge graph is (nodes, edges, communities, EXTRACTED vs INFERRED).
2. **Why** agents run `graphify query` before Read/Grep (scoped subgraph, cross-file edges grep misses).
3. **How** it is wired in *this* demo (`graphify-out/`, CLI, Cursor rule).
4. **Try it** — three canned demos that map to real commands, plus links to related tools.

**Non-goal:** Live shell execution of `graphify` in the browser for v1. Canned outputs + copyable commands are enough to teach. A later phase can proxy read-only queries if useful.

## Teaching thesis (one line)

> Agents don’t grep blindly — they traverse a graph, then open only the files the graph pointed at.

## Placement

| Item | Choice |
|------|--------|
| Host | `EducationPanelsHost` + `EDU.GRAPHIFY` id |
| Pattern | `EducationDrawer` tabs (mirror `WeaviateRagPanel`) |
| Nav | Education bar / agent-tooling cluster next to Vector RAG / Code Explorer |
| Auth | Same as other edu panels (no new auth) |
| Not | New top-level marketing route; not part of token-chain / PingOne story |

## Tabs

### 1. What it is
- Knowledge graph over code + docs: symbols, files, communities.
- Edge honesty: **EXTRACTED** (AST/import) vs **INFERRED** vs **AMBIGUOUS**.
- Three verbs: `query` (BFS context), `path` (A→B), `explain` (one concept).
- Contrast table:

| Tool | Question it answers | Backing store |
|------|---------------------|---------------|
| **Graphify** | “What’s related / how do A and B connect?” | `graphify-out/graph.json` |
| **Code Search (Weaviate)** | “Find code *like* this meaning” | Vector ANN |
| **Code Explorer (codegraph)** | “Show me the source for X / callers” | SQLite AST index |

### 2. How it’s wired here
- Artifact: `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, optional `wiki/`).
- Agent rule: `.cursor/rules/graphify.mdc` / `CLAUDE.md` — query before explore.
- Update: `graphify update .` after code edits (AST-only, no API cost).
- ASCII flow: question → `graphify query` → scoped nodes → Read those files.

### 3. Try it (canned demos)
Three buttons; each shows the command + a short pre-captured result snippet (refreshable offline):

| Demo | Command | Teaching point |
|------|---------|----------------|
| Orient | `graphify query "token exchange BFF session"` | Broad subgraph beats grep |
| Path | `graphify path "ToastContainer" "TokenChainDisplay"` | Why toasts sat on the token chain |
| Explain | `graphify explain "HITL"` | One concept → related nodes |

Link out: Code Search (`/code-search`), Code Explorer (`/code-explorer` or current route).

### 4. For agents (optional short tab)
- When to use graphify vs codegraph vs Weaviate.
- “Do not skip graphify because files are already known.”
- After edits: `graphify update .`

## Success criteria

- [ ] SE can open the panel and explain graphify in &lt;2 minutes without reading `CLAUDE.md`.
- [ ] Clear differentiation from Weaviate + Code Explorer (no “another search box” confusion).
- [ ] Three canned demos run with zero backend dependency.
- [ ] Registered in `educationIds` + `EducationPanelsHost` + EducationBar entry.
- [ ] Emoji allowlist respected; minimal diff; no protected auth/token-chain changes.

## Out of scope (v1)

- Live `graphify` CLI from the UI / BFF proxy.
- Rebuilding or serving the full interactive HTML viz inside the drawer.
- Replacing Code Explorer or Code Search.
- Customer-facing banking narrative.

## Implementation sketch (v1)

1. `EDU.GRAPHIFY = "graphify"` in `educationIds.js`.
2. `GraphifyPanel.js` — four tabs, `EducationDrawer`, width ~`min(660px, 100vw)`.
3. Wire `PANEL_MAP` in `EducationPanelsHost.js`.
4. Add EducationBar / catalog entry in the agent-tooling / RAG cluster.
5. Optional: snapshot JSON under `demo_api_ui/src/components/education/graphifyDemos.json` for canned outputs.
6. Unit smoke: panel renders tabs; id present in educational catalog tests if any.

## Open questions

1. **Live query later?** Worth a read-only BFF endpoint that shells `graphify query` against committed `graphify-out/`, or keep canned forever?
2. **Embed viz?** Link to `graphify-out` HTML artifact in docs, or iframe a static export?
3. **Naming in UI:** “Graphify” (product) vs “Code knowledge graph” (concept-first)?

## Recommendation

Ship **v1 as a public SPA page** at `/graphify` (canned demos + contrast table),
wired next to Code Explorer / Code Search in the side nav. Education drawer can
follow later if SE walkthroughs want an in-context chip.

### Implemented (2026-07-08)

- Route: `/graphify` → `GraphifyPage` via `GraphifyPageRoute` / `AppShell`
- Files: `GraphifyPage.jsx`, `GraphifyPage.css`, `graphifyDemos.js`
- Nav: AdminSideNav entry after Code Search
- Hero variant: `graphify` (teal)
- Live CLI / BFF proxy: still out of scope
