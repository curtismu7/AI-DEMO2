# Theming — the one way to do dark/light

Canonical rules for light/dark in `demo_api_ui`, plus the opportunistic rollout
that gets us from "19 files know about dark" to "all of them" without a big-bang
PR. `CLAUDE.md` points here; `REGRESSION_PLAN.md` §0 still wins on hard UI rules.

**The working rule: when you touch a page, migrate that page. If it is already
migrated, skip it and move on.** Nothing else is scheduled.

---

## §1 The four rules

### 1. Dark is `:root[data-theme="dark"]`. Never `prefers-color-scheme`.

The app owns the theme; the OS does not. A `@media (prefers-color-scheme: dark)`
block fires for an OS-dark user *while the app is in light mode*, so one
component goes dark on a light page. That is the incident-#1212 class and it has
recurred at least three times.

```css
/* ❌ never */
@media (prefers-color-scheme: dark) { .panel { background: #111823; } }

/* ✅ */
:root[data-theme="dark"] .panel { background: var(--th-bg-card); }
```

### 2. Prefer converting literals to tokens over writing a dark block.

This is the rule that does the most work, and it is counter-intuitive: the best
dark-mode fix usually adds **no dark rules at all**.

A hardcoded `#ffffff` needs a matching dark override, forever, in every file. A
`var(--th-bg-card)` is already correct in both themes, because the token flips
once in `index.css`. Fewer lines, and it cannot drift.

```css
/* ❌ two places to keep in sync */
.panel { background: #ffffff; border: 1px solid #e4e5e9; }
:root[data-theme="dark"] .panel { background: #131c2e; border-color: #26304a; }

/* ✅ one place, already correct in both */
.panel { background: var(--th-bg-card); border: 1px solid var(--th-border); }
```

Write a `[data-theme="dark"]` block only for something genuinely not expressible
as a token swap — a gradient, a shadow, an image treatment.

### 3. Brand and accent colours stay literal.

Tokens are for **surfaces, lines and ink**. A brand mark, a status accent, a
deliberate highlight is not a surface and must not follow the theme. The Ping red
square (`#b3282d`) reads the same in both themes on purpose.

If a colour answers "what is this thing", it stays literal. If it answers "how
far from the page ground is this", it becomes a token.

### 4. Verify in the DOM, not in the stylesheet.

Grep tells you what a file says. `getComputedStyle` tells you what the user sees,
and in a codebase with skins and `!important` they routinely disagree.

Concretely: `AdminSideNav.css` defines a **dark** gradient for `.admin-side-nav`.
Reading the file suggested the side nav was fine. It rendered pure white, because
`adminSkinPing2026.css` overrode it and won on every page. That cost a wrong
diagnosis in PR #2602 and was only caught by asking the live page.

```js
// paste in the console, or via Playwright, with the app in dark mode
[...document.querySelectorAll('div,section,header,nav,aside')]
  .filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 24) return false;
    const m = getComputedStyle(el).backgroundColor
      .match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
    if (!m || (m[4] !== undefined && parseFloat(m[4]) < 0.5)) return false;
    return (+m[1] + +m[2] + +m[3]) / 3 > 235;   // painting light while dark
  })
  .map(el => [el.className, getComputedStyle(el).backgroundColor]);
```

An empty array means the page is done. That is the acceptance test.

---

## §2 The vocabulary

All 30 live in `index.css`, defined on `:root` and again on
`:root[data-theme="dark"]`. Use these names; do not invent siblings.

| Group | Tokens | Use for |
|---|---|---|
| Ground | `--th-bg-page` `--th-bg-band` | The page behind everything |
| Surface | `--th-bg-card` `--th-bg-inset` `--th-bg-hover` | Panels, wells, hover rows |
| Ink | `--th-text` `--th-text-body` `--th-text-muted` `--th-text-faint` `--th-text-invert` | Headings → body → captions |
| Line | `--th-border` `--th-border-strong` | Dividers, outlines |
| Code | `--th-code-bg` `--th-code-text` | `pre` / `code` |
| Status | `--th-status-{success,warning,error,info}` and each `-text` `-bg` `-border` | Semantic state only |

Light `--th-bg-card` is `#ffffff`, so swapping a literal `#ffffff` background for
it is **byte-identical in light mode** — the safest possible migration, and why
most conversions carry no visual risk at all.

Existing family aliases (`--dash-*`, `--admin-*`, `--ctl-*`, `--color-*`) already
resolve to `--th-*`. Leave them; they are the compatibility layer.

Deliberately **not** aliased: `--pp-*`, because ProtocolPlayground themes via its
own `.dark` class rather than `[data-theme]`. Do not "fix" it.

---

## §3 Where we actually are

Measured on `demo_api_ui/src`, 2026-08-29:

| | Files |
|---|---|
| Stylesheets total | 274 |
| Reference `--th-*` | 81 |
| Have `[data-theme="dark"]` blocks | 19 |
| **Neither — untouched by theming** | **190** |
| Carry a real `@media (prefers-color-scheme)` block | 17 |

Reproduce any row:

```bash
cd demo_api_ui/src
find . -name '*.css' | wc -l
grep -rl 'var(--th-' --include='*.css' . | wc -l
grep -rl 'data-theme="dark"' --include='*.css' . | wc -l
grep -rlE '@media.*prefers-color-scheme' --include='*.css' . | wc -l
```

190 unmigrated files is why this is opportunistic and not a project. At the pace
of normal feature work it closes over months, and no single PR is ever large
enough to be risky.

---

## §4 The rollout

### Priority 0 — delete the `prefers-color-scheme` blocks (15 files)

These are not "not yet migrated", they are **actively wrong**: they fire against
the app's own theme. Do these on sight, regardless of what else you are touching.

`ArchitectureTabsPanel` · `ChainViewMenu` · `DemoTrackBand` · `GroupMembershipToggle`
· `JSONViewer` · `LoadingOverlay` (×2) · `MissingCredentialsModal` ·
`PolicyConformancePanel` · `StepDetailPanel` · `TokenCardGrid` ·
`TokenChainFilmstrip` · `TokenChainNodeRail` · `TransactionTracePage` ·
`UnifiedTokenFlowInspector` · `agentStudioPreview` (×2)

Two are exempt and say so in their own comments — `AgentGuardrailsDiagram` and
`AgentOnboardingFlowDiagram` intend to follow the OS. Leave them.

### Priority 1 — the page you are already editing

The standing rule. Adding a feature to a page? Migrate its stylesheet in the same
PR. Already migrated? Skip, say so in the PR body, move on.

### Priority 2 — shared shells, when convenient

Highest blast radius per line: `styles/appShellPages.css`, `TopNav.css`,
`AdminSideNav.css` + `adminSkinPing2026.css`, `DraggableModal.css`. Two of these
landed in #2602; the rest pay off across many pages at once.

### Never — a "migrate everything" PR

274 files in one diff is unreviewable, unbisectable, and guarantees a visual
regression nobody can attribute. The whole point of the opportunistic rule is
that each change arrives attached to a human who is already looking at that page.

---

## §5 The per-page checklist

1. Open the page and switch to dark.
2. Run the §1.4 snippet. Empty array → **already migrated, skip the rest.**
3. For each hit, in its stylesheet: replace surface/line/ink literals with §2
   tokens. Leave brand and accent literals alone.
4. Delete any `@media (prefers-color-scheme)` block you find.
5. Re-run the snippet in dark — empty.
6. Switch to light and re-run — empty, and the page looks as it did.
7. `npm run test:unit && npm run build`.

Step 6 is the one people skip. Every conversion touches both themes, and a token
whose light value differs from the literal it replaced will shift light mode too.
That is usually fine and sometimes not — you have to look.

---

## §6 Keeping it from sliding backwards

We have narrow guards already: `modalDarkSchemeContrast.test.js`,
`signinAccentTokens.test.js`, `adminDashboardParity.test.js`.

The gap: nothing stops a *new* stylesheet from being born with hardcoded light
colours, so 190 can become 191 while everyone believes the number only falls.

Proposed, not yet built — **a ratchet**: pin the current count of stylesheets with
neither `--th-*` nor a dark block, fail if it rises, and require the pinned number
be lowered whenever it falls. New files must be born correct; old ones only
improve.

Deliberately a counting ratchet and not a linter. `modalDarkSchemeContrast.test.js`
says why in its own header: a broad "no light colour in CSS" rule produced five
false positives, "and a guard that cries wolf gets switched off." A count cannot
be wrong about an individual line.

---

## §7 Worked example

PR #2602 is the reference conversion — two files, both themes, no dark blocks
added.

```css
/* adminSkinPing2026.css — before */
body.admin-skin-p1 .admin-side-nav {
  background: #ffffff;
  border-right: 1px solid #e4e5e9;
}

/* after */
body.admin-skin-p1 .admin-side-nav {
  background: var(--th-bg-card);
  border-right: 1px solid var(--th-border);
}
```

Result, from `getComputedStyle` on the live page: `.admin-side-nav` went
`rgb(255,255,255)` → `rgb(19,28,46)` in dark, and stayed `rgb(255,255,255)` in
light. One line each, both themes, nothing to keep in sync.

Prior art worth reading before a large conversion: #2583 (phase 1, dead
stylesheets and the first three `prefers-color-scheme` removals), #2585 (phase 2,
the `--th-status-*` / font / z-index token layer and the `--dash-*` / `--admin-*`
aliases), #2602 (phase 3, the shells above).
