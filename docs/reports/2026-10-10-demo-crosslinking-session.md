# Demo cross-linking session — 2026-10-10

Closing the audit gaps between the Learning Hub, live demo steps, and the diagram
pages, so a presenter moves concept → live run → diagram → evidence without
hunting. PR: [feat/demo-crosslinking](https://github.com/cmuir_pingcorp/AI-DEMO2/pull/1098)

## What the audit found

Four parallel audits (Learning Hub → live tests, live tests → diagrams,
Learning Hub → diagrams, privilege client + LLM gateway → both) found:

- **Learning Hub → diagrams: the broken silo.** Zero links from the Hub to any
  diagram page; 17 natural hub↔diagram pairs with no link; PageGuide renders no
  links at all.
- **Live tests → diagrams: strong but asymmetric.** All 29 primary demo steps
  had diagrams with per-step "Diagram" links; 36 non-primary steps had none;
  diagram pages never linked back to the live step.
- **Learning Hub → live tests: healthy.** All 36 demoStep chips resolved, but
  4 pointed at semantically wrong use cases, and 2 lessons silently had no Run
  button.
- **Privilege client / LLM Gateway: inbound wired, outbound dead ends.**
  UC-LEARN11 deep-linked into `/llm-gateway` but the page linked to nothing.
- **Orphans:** 172 routes unreachable from any demo trigger; root `learning/*.html`
  served by nothing.

## What was built

### 1. Learning Hub → diagrams
- Data-driven **"Diagram ↗"** link on every hub demoStep card
  (`LearningHub.tsx`) — renders whenever the UC has a diagram config, so it
  covers new configs automatically.
- 9 hub topics re-pointed from education modals to real diagram pages
  (Architecture Diagram → `/architecture/system`, Token Chain → token-chain,
  Gateway vs P1AZ → `/gateway-enforcement-map`, CIMD → `/cimd-privilege`,
  Token Exchange → token-flow, Actor Token → token-chain, CUA →
  `/personal-agent-design`, Server Capabilities → server-topology, Agent
  Gateway → `/privilege-mcp-diagrams`).
- 4 mismatched chips corrected: Privilege MCP → **UC17** (was UC13, a
  confused-deputy attack), Kill Switch → **UC-NHI2** (was inventory-only NHI1).

### 2. Twelve new diagram configs
`src/config/useCaseDiagrams/`: UC3, UC16b, UC17, UC23, UC37, UC43, UC44,
UC-LEARN11, UC-LEARN15, UC-LOGIN, UC-NHI1, UC-NHI2 — each per the repo
standard (shared palette, walk-covers-every-edge-once, click-to-inspect
details) with its own structural test. Ten authored via a read→author→verify
agent workflow grounded in `useCases.js`/`demoStepGuides.js`; two by hand
(UC17, UC-NHI2 — demanded by the chip corrections). The gallery went from 29
to **41 diagrams**.

### 3. Reverse links (diagram → live test)
- Diagram page: "Step N of the demo script" dead-end → **"Run this step ↗"**
  to `/use-cases#UCxx`.
- Gallery: every card gets a "Run this step ↗" link.
- Lifeline audit: each step row links its diagram and live step; header notes
  the five steps that joined the script after the audit.

### 4. Demo Map (`/demo-map`)
One page showing all relationships, built on `missionControlCatalog` (the same
data the demo-steps dropdown reads, so it cannot drift): per mission group —
**Demo steps** (numbered, linking `/use-cases#UCxx`, ◱ to the diagram),
**Inspectors**, **Diagrams**, and a new **Learning** column (hand-mapped hub
topics per group). First entry in the Diagrams nav; registered in
`navStructureCatalog`, `navPagePaths`, `diagramsIndex`.

### 5. Orphan test pages → demo story (UC-LEARN16..19)
| UC | Opens | Pairs with |
|---|---|---|
| UC-LEARN16 | `/mfa-test` (FIDO2 passkey ceremony) | UC7, UC38 |
| UC-LEARN17 | `/oauth-debug-logs` (raw OAuth traffic) | every token-chain step |
| UC-LEARN18 | `/llm-test` (unguarded provider chat) | UC-LEARN11 (before/after) |
| UC-LEARN19 | `/intent-inspector` (PAR/RAR payloads) | UC14, UC14b |

Catalog grew 79 → 83; `use-cases:gen` regenerated `docs/use-cases` (4 new
pages + a staleness catch-up in `oauth-fail-closed.md`).

### 6. Lessons un-silenced
`multi-party-delegation` and `threat-defense` declared `run.action` values
with no observation endpoint, so their Run buttons never appeared. Both now
observe real evidence — `authorize-decision` (live policy inputs distinguish
consumer/delegate/agent) and `audit-evidence` (the token chain records which
control stopped each request).

### 7. LLM Gateway + Privilege client → back into the story
- LLM Gateway titlebar: "LLM Test (unguarded)", "Demo step"
  (`/use-cases#UC-LEARN11`), "Diagram" (`/use-case-diagrams/UC-LEARN11`).
- Privilege client titlebar: "Demo step" (`/use-cases#UC17`), "Diagram"
  (`/use-case-diagrams/UC46`).

### 8. Guardrails
New ratchet test `src/__tests__/hubDiagramOverlap.test.js`: every hub
demoStep must resolve through `getConfig` — the hub↔diagram pairing cannot
silently rot.

### 9. Cleanup
Root `learning/ciba-oob.html`, `token-chain-edu.html`,
`token-exchange-rfc-8693.html` deleted — referenced by nothing; the live
mirror copies under `public/learning-mirror/` carry the demo-links wiring.

## Verification

- `demo_api_ui`: 368+ tests across all touched surfaces (diagram configs,
  hub, gallery/diagram page, demo map, lesson execution, LLM gateway,
  privilege client, nav drift) — green.
- `demo_api_server`: use-case catalog tests green; `npm run authz:verify`
  green (96 use cases, 257 routes).

## Incidents worth knowing

1. **Commit from the shared checkout is hook-blocked by design** — the repo's
   pre-commit hook requires a worktree (concurrent sessions sharing one index
   have clobbered work twice before). Mid-session, a stash/pop race with
   concurrent sessions lost ~10 file edits from the working tree; they were
   rebuilt by pattern from this session's record and re-verified before
   commit. Lesson learned: worktree first, not last.
2. **CI caught a real gate**: the new UCs and `/demo-map` needed entries in
   `auth-requirements.json` (levels matched to the pages they open: MFA Test
   public, OAuth Debug/Intent Inspector admin, LLM Test user, demo map
   public). Second commit fixed it; `authz:verify` passes.
