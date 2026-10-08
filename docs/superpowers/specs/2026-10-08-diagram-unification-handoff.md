# Handoff: combine the two diagram systems (use-case diagrams + demo-step diagrams)

Date: 2026-10-08 · Author: session that built `feat/use-case-diagrams` (merged to main as `501c74b12`)
Owner for execution: the session holding worktree `.claude/worktrees/step-diagrams` (branch `worktree-step-diagrams`)

## Situation — two diagram systems now exist

**1. Use-case diagrams (this just landed on main — `feat/use-case-diagrams`, 12 commits).**
- **Route:** `/use-case-diagrams/:ucId` (by **UC id**: UC1, UC7, UC6) + gallery `/use-case-diagrams`.
- **Engine:** React Flow via the existing shared `StaticFlowDiagram` + `useDiagramStepper` + `DiagramStepBar`/`DiagramReel` — play/pause/resume/prev/next/stop/step-time/reel all come from the shared stepper.
- **Config:** one file per UC at `demo_api_ui/src/config/useCaseDiagrams/<UCID>.js` (pilots: UC1, UC7, UC6), shape `{ id, result, GROUPS, NODES, EDGES, walk }`. `walk[]` steps carry `title/label/lines/nodes/edges/tech[]` (wire rows: API/TOKEN/A2A/POLICY).
- **Registry:** `demo_api_ui/src/config/useCaseDiagrams/index.js` exports `CONFIGS` and `getConfig(id)`.
- **Shared data:** title/what/businessValue always imported from `config/demoStepGuides.js` (`DEMO_STEP_GUIDES[id]`); step number from `config/demoStepNumbers.js` (`demoStepNumber(id)`). Never copy these strings.
- **Palette:** `config/useCaseDiagrams/palette.js` (`PARTICIPANT_GROUPS`: user/agent/gateway/pingone/resource/external) — every node group must be a key from it.
- **Enforcement:** drift test `config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js` — every `DEMO_PRIMARY_USE_CASE_IDS` id must be authored or in the `PENDING` set; structural `validateConfig()` must pass. **The ratchet bites: adding a UC without a diagram fails CI.**
- **Standards doc:** `docs/use-case-diagram-standards.md` (layout grid, walk-beat rules, tech-row tag vocabulary, "how to add a diagram").
- **Spec:** `docs/superpowers/specs/2026-10-08-use-case-diagrams-design.md`; visual contract `mockups/use-case-launcher/showtime-ribbon.html`.
- **Live in the running stack** (dev-profile UI, bind-mounted src): `https://localhost:4000/use-case-diagrams` verified.

**2. Demo-step diagrams (the other session's branch — merged in stages as #1039 and #1041, then superseded by this unification).**
- **Route:** `/step-diagrams/:step` (by **presenter step number**, 1–26 — full primary-sequence coverage; removed by this unification).
- **Engine:** hand-drawn SVG scenes (`StepDiagramScenes.jsx`) using the Demo arch slide primitives (`demoArchPrimitives`) with the slide player's walkthrough state.
- **Config:** `demo_api_ui/src/config/stepDiagrams.js` — `STEP_DIAGRAMS` array of `{ step, id (UC id), title, path, meta, render }`, plus `stepDiagramFor(step)` / `stepDiagramPath(step)`.
- **Entry points already wired:** `DemoStepsDropdown.jsx` (diagram link per step row) and `UseCaseExplainModal.jsx` (diagram link per use case).

## The job

Make ONE system for the SE: the demo script (step numbers) is the index; UC diagrams are the content. Concretely:

1. **Rebase first:** `worktree-step-diagrams` forked before the use-case-diagrams merge. Rebase onto `origin/main` (which now holds `501c74b12`) and resolve conflicts before any feature work. Expect a small one: both sides touched `App.js` routes and `config/diagramsIndex.js` area — keep both.
2. **Unify the entry points (both directions):**
   - On `/use-case-diagrams/:ucId`, add a "Step N in the demo script" cue/link that deep-links to the demo step (reuse `demoStepNumber(id)`; link target is the existing `/use-cases` demo grid or the dropdown anchor — match how `DemoStepsDropdown` links, don't invent a new route).
   - In `DemoStepsDropdown` and `UseCaseExplainModal`, prefer the use-case diagram when one exists: `getConfig(DEMO_STEP's UC id)` — link to `/use-case-diagrams/<UCID>`; keep the `/step-diagrams/:n` link for the four steps that have a hand-drawn scene but no UC config (UC8, UC14b today).
   - Rule: **UC-config diagram wins when it exists; step scene is the fallback.** One link per step, not two.
3. **Map step number ↔ UC id in ONE place:** the UC configs already carry `id`, and `demoStepNumber(id)` gives the number. Do NOT add a third mapping table — if `stepDiagrams.js` needs the UC id for a step, derive it (`stepDiagramFor` stays by-number, but the dropdown resolves UC→number via `demoStepNumber`).
4. **Convert the four step scenes into UC configs where they overlap (UC1, UC7), and add configs for UC8 and UC14b** so every covered step has a UC diagram:
   - Port each scene's hops into `NODES/EDGES/walk` (layout grid: x = 40/340/640/940/1240, y = 150; walk step per edge; `tech[]` rows per the standards doc's tag vocabulary).
   - Remove the converted entries from `STEP_DIAGRAMS` when done. If `STEP_DIAGRAMS` ends up empty, delete the file, the `/step-diagrams/:step` route, `StepDiagramPage*`, and the two entry-point imports — leaving two routers for the same content is the drift this job exists to kill. Keep the branch minimal either way.
   - UC14b is `DEMO_SUB_STEP_IDS`' child (reads "25A") — `demoStepNumber('UC14b')` still resolves; check what the dropdown shows and match it.
5. **Keep the ratchet honest:** after conversion, UC1/UC7/UC6/UC8/UC14b are authored; everything else stays PENDING. Never widen PENDING to silence a failure — that's the one rule with no exceptions.
6. **Tests:** port any step-diagram page tests to the unified routes; the drift test + per-config tests must stay green; `npm test` full suite green; run `npx vitest run src/components/__tests__/themingRatchet.test.js` — the 10px font floor and token rules apply to any new CSS.

## Guardrails (from the merged branch's hard-won bits — don't regress)

- **Colors:** only `--th-*` tokens; the palette test + theming ratchet fail on literals. Dark text-on-band was a real bug once: never paint `--th-bg-band`/`--th-bg-emphasis` as *text* color; pair bg tokens with their `-text`/`-on-emphasis` partners.
- **Font floor:** nothing below 10px (`var(--font-size-3xs)` is the minimum).
- **Styled links:** the app has a global anchor underline; beat it with `.ucd-page a.<class>` specificity (see `UseCaseDiagramPage.css`) and give cards `:focus-visible`.
- **Controls:** do not build a second walkthrough control bar — `StaticFlowDiagram` + `useDiagramStepper` + `DiagramStepBar` own that. If the SVG scenes' player is nicer somewhere, port the *content* to a UC config, not the *player*.
- **Node details:** nodes carry `detail`; the details panel + wire rows render from `walk[].tech`. Keep `validateConfig` strict (it now requires `nodes`, `tech`, `result` — it caught real crash paths).
- **Deep links:** `/use-case-diagrams/<UCID>` is the canonical share URL. Step-number URLs are either dropped (option A above) or redirects (option B) — never a third canonical form.

## Definition of done

- One link from every demo-step row and explain-modal to the right diagram (UC config preferred).
- `STEP_DIAGRAMS` empty (or reduced to genuinely-unconvertible scenes) and its route/tests removed or justified.
- All 5 overlapping UCs have configs; drift test green with PENDING = the remaining 21.
- Full `npm test` green from `demo_api_ui/`; build passes.
- Verified live (dev profile serves main's src): dropdown → diagram → walkthrough → back.
- Branch pushed; PR or merge per the other session's normal flow.

## Where things live (quick index)

| Thing | Path |
|---|---|
| UC configs + registry + validator | `demo_api_ui/src/config/useCaseDiagrams/` |
| Shared page / gallery | `demo_api_ui/src/components/UseCaseDiagramPage.jsx`, `UseCaseDiagramsGalleryPage.jsx` |
| Drift ratchet | `demo_api_ui/src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js` |
| Step scenes to convert | `demo_api_ui/src/components/StepDiagramScenes.jsx`, `config/stepDiagrams.js` (on `worktree-step-diagrams`) |
| Entry points to unify | `demo_api_ui/src/components/DemoStepsDropdown.jsx`, `UseCaseExplainModal.jsx` |
| Standards | `docs/use-case-diagram-standards.md` |
| Spec / plan / mock | `docs/superpowers/specs/2026-10-08-use-case-diagrams-design.md`, `docs/superpowers/plans/2026-10-08-use-case-diagrams.md`, `mockups/use-case-launcher/showtime-ribbon.html` |
