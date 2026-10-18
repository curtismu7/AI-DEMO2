# UI consistency review — status and checklist

Started 2026-10-18. Goal: make every demo page consistent with Ping Identity standards (Montserrat, Ping palette, **no purple**), and make sure text is always readable (no dark-on-dark, no light-on-light).

- **PR:** #1515 — https://github.com/cmuir_pingcorp/AI-DEMO2/pull/1515 (open; merge by hand, the classifier blocks `gh pr merge`)
- **Branch / worktree:** `worktree-ui-ping-palette` at `.claude/worktrees/ui-ping-palette`
- **Last commit when written:** `40a3b4940`
- **To resume:** `cd .claude/worktrees/ui-ping-palette/demo_api_ui` (node_modules already installed there). Use the worktree, never the shared main checkout.

## Decisions already made (do not re-ask)

| Topic | Decision |
|---|---|
| Control colour (checkboxes, toggles, selects) | Ping Red `#d20e0f` (was PingOne blue `#0b69a3`) |
| Other blues | Core Dark `#051727` for surfaces/nav, Ping blue `#12538d` for links/info |
| Reds | Two tokens: `#d20e0f` accent/danger, `#aa0005` hover/dark |
| Purple / pink | None anywhere (avatar, gradients, code highlights all moved to the red family) |
| Page header look | Option B: Core Dark → Ping blue gradient band, white text |
| Ping-owned pages vs vertical accent | Ping pages ignore the vertical's `--theme-accent` (landing done; others open below) |
| Neutrals | Slate/Tailwind grays mapped to Ping neutrals: `#263746`, `#5c646b`, `#909ea4`, `#cdd1d4`, `#e0e2e4`, `#eff0f1`, `#f7f8f8` |
| Untouched on purpose | Vendor-mock chrome, clinical vertical, per-vertical typography tokens (`--rd2-font-*`), fake-tenant presets |

## Done

### Palette
- [x] Static survey of fonts, colours, radius, headers, buttons across `demo_api_ui/src`
- [x] Root tokens in `index.css` (Ping Red, Core Dark, Ping blue); `--color-primary/accent/danger/info` defined; `--th-bg-band` = Core Dark
- [x] Controls standard moved to Ping Red (`controls.css`, `CONTROLS_STANDARD.md`)
- [x] FunAvatar uses Ping palette only (white features)
- [x] Landing page: ignores vertical accent, red primary, one button radius, Core Dark callout
- [x] Hex sweep: off-brand reds/blues/indigo across ~175 page CSS files
- [x] Neutral sweep: slate and Tailwind grays → Ping neutrals (~1,000 values, 159 files)
- [x] Purple/pink sweep: 91 hex values (incl. the 404 page gradient)
- [x] Fixed 4 dark-theme text colours the palette sweep introduced

### Fonts
- [x] ~150 hardcoded font stacks → `var(--font-primary)`; mono aliases → `var(--font-mono)`
- [x] `--font-mono` now leads with IBM Plex Mono (already loaded)
- [x] Undefined `--v2-font-body/-display` (were rendering plain sans/Georgia) → brand font

### Shared header
- [x] `components/common/PageHeader.jsx` + `.css` and `BackLink`, with a test
- [x] Migrated 22 pages: Learning lab, Governance Timeline, MCP Scanner, Demo Summary, Page Catalog, Skills index, Privilege docs index, MCP Discovery, Cimd Privilege, Personal Agent (design + review), Diagrams Index, Agent Studio Preview (5 pages), Demo Map, Privilege First Gateway, Demo Steps Lifeline Audit, Phase 266 Architecture, Spinner Showcase, Shadow AI Detector, A2A Architecture
- [x] Found and worked around the third-party `end-user-nano.css` forcing `h1` to weight 400 (raised specificity)

### Contrast tooling
- [x] `scripts/check-contrast.mjs`: static WCAG AA check, light + dark, resolves `--th-*` tokens, understands per-theme override rules
- [x] PostToolUse hook in `.claude/settings.json` (Write|Edit on `.css` under `demo_api_ui/src`; exit 2 feeds failures back to Claude). Pipe-tested.
- [x] vitest ratchet `src/__tests__/contrastRatchet.test.js` + `scripts/contrast-baseline.json` (278 → 3)
- [x] `scripts/audit-contrast-runtime.mjs` (`npm run audit:contrast`): renders every static route as a mocked admin in both themes, checks composited colours, catches inherited-colour bugs
- [x] Burn-down: script-fixed rules + scoped overrides in `index.css`; themingRatchet pin 59 → 57
- [x] Full vitest green (7,026+), `npm run build` green, screenshots of 10 signed-in pages reviewed (light + dark): nothing unreadable seen

## Left to do

### Before / at merge
- [ ] CI green on #1515, then merge (user)
- [ ] After merge, open `/hooks` once to confirm the contrast hook loads (only pipe-tested; it cannot fire in the session that wrote it)
- [ ] Delete the untracked screenshots folder `demo_api_ui/zz-shots/` (20 PNGs) — **not committed, do not commit**
- [ ] Look at the other 14 screenshots not reviewed (Skills, Governance Timeline, Page Catalog, Personal Agent, the remaining light/dark pairs)

### Contrast — remaining findings
Last runtime audit (slightly stale): ~38 unique violations on 164 rendered routes.
- [ ] Re-run `npm run build`, serve with `npx vite preview --port 4173`, then `npm run audit:contrast -- --out report.json`
- [ ] `/request-access`: white text on a light gradient island in dark theme (`.efd` is themed; the host page's hardcoded gradient is the cause)
- [ ] `/personal-agent*`: blue buttons (`rgb(0,115,230)`) on dark card, 3.9:1
- [ ] "🌙 Dark" toggle buttons on `/authz-test`, `/pingone-authorize` (light grey on white)
- [ ] `/delegation` step labels, `vops__icon` badges (white on mid-tone fills, ~3.7–4.0:1)
- [ ] `a2t-node__icon` colours on dark (A2A protocol page), `lps-expect`/`mds-expect` labels, `tst-topbar-badge`
- [ ] `/dev-tools` hint text at 50% white
- [ ] 74 routes did not render without a backend: re-run the audit against the real local stack (needs sign-in) to cover them
- [ ] 3 static baseline entries (`.dash`, `.tcd-root`, `.ba-input`) are checker false positives on local token layers; either teach the checker or leave
- [ ] Move the generated blocks at the end of `index.css` ("Contrast overrides" / "Contrast fixes") into their component stylesheets as each is touched
- [ ] Decide whether the `FootprintMockGallery` page chrome (currently in the skip list) should be checked too

### PageHeader rollout (~100 pages still bespoke)
- [ ] Batch: pages with `<header>` + eyebrow + h1 + summary (`DavinciLoginGuide`, `GuidedJourney`, `ObservabilityDiagram`, `PingFederateDavinciKit`, `PingFederateIdJagExplainer`, `PingFederateIdJag`, `WorkloadAgents`, `SpiffePingoneBridge`, `StandaloneDemoLauncher`)
- [ ] Batch: pages with a plain eyebrow + h1 inside a `div` hero (`pmd-hero` family: 4 pages, `asp-hero` done)
- [ ] Batch: pages with toolbar-style headers (`LlmGateway`, `LlmTest`, `Tracing`, `TransactionTrace`, `Telemetry`) — need a design decision (actions slot)
- [ ] Batch: lesson/learning pages with back links (`ExternalAgentLesson`, `IntentBindingLearning`, `MortgagePath`, `PrivilegeMcpLearning`, `VerticalFeature`, `LangChain`, `PingOneSetupGuide`)
- [ ] Replace the 6 bespoke back-link implementations with `BackLink`
- [ ] Re-count pages still using their own header at the end (121 page files had an `<h1>` at the start; grep for `<h1` in `pages/` and `components/*Page*`, minus those now using `<PageHeader`)

### Consistency not started
- [ ] Buttons: collapse per-page families (`cur-btn`, `ijp-btn`, `dc-btn`, `uc-run-btn`, `tracing-btn` …) onto `btn` / `btn-primary` / `btn-secondary` / `btn-ghost`
- [ ] Radius and font-size: literal values (6px, 8px, 10px, 3px, 5px; 631 literal `px` font sizes) → `--radius-*` / `--font-size-*`; add a stylelint rule banning new literals
- [ ] Mid blue tints still present (`#93c5fd`, `#60a5fa`, `#7dd3fc`, `#9ec1ff`, `#90a0c2`, GitHub blues in code/diff views) — pick replacements
- [ ] Other Ping-owned pages that should ignore the vertical accent (welcome, Learning Hub, similar)
- [ ] Status colours: success greens, warning ambers and `#a33020` negative red were left as-is
- [ ] Secondary buttons are now all Ping Red (e.g. the Admin toolbar). Decide whether to make secondary/utility buttons quieter (outline or Core Dark)
- [ ] Pre-existing glitch: `/authz-test` engine radio cards run title and description together

### Needs confirmation from the brand hub (SSO-gated)
- [ ] Gray 300, 500, 600 hex values; `#263746`, `#909ea4`, `#cdd1d4`, `#eff0f1` were taken from pingidentity.com's own CSS, not the hub
- [ ] Official dark-theme tints of Ping Red and Ping blue (none exist in the palette, so dark theme uses Tailwind tints `#fca5a5` / `#93c5fd` for text)

### Housekeeping
- [ ] Update the `brand-compliance` skill and `AI-DEMO2/CLAUDE.md` with: mono = IBM Plex Mono via `--font-mono`, the two-red rule, no purple, the contrast hook and `npm run check:contrast` / `audit:contrast`
- [ ] Update `THEMING.md` if it lists the old `--th-bg-band`

## Commands

```bash
cd .claude/worktrees/ui-ping-palette/demo_api_ui
npm run check:contrast                 # static, fails on NEW violations (baseline: scripts/contrast-baseline.json)
node scripts/check-contrast.mjs --all  # list every violation, baseline or not
node scripts/check-contrast.mjs --update-baseline   # after fixing some
npm run build && npx vite preview --port 4173 &
npm run audit:contrast -- --out /tmp/report.json    # runtime audit, ~4 minutes, needs the preview running
npx vitest run src/__tests__/contrastRatchet.test.js src/components/__tests__/themingRatchet.test.js
```

## Traps learned (save yourself the time)
- Never run a script's generated CSS overrides without scoping each rule under an owning class. A bare-tag override (`li`, `span`) once turned all light-theme text white (1,399 violations) before it was reverted.
- A rule can look broken in one stylesheet while another sets the real background with `!important` (`.banking-agent-fab`). Trust the runtime audit over the static check for those.
- The preview has no backend: signed-in pages need the mocked admin session in `audit-contrast-runtime.mjs`.
- Do not use shell heredocs or computed paths in Bash in this worktree session; write helper scripts to files first.
