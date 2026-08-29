# Theming — the one way to do dark/light

Canonical rules for light/dark in `demo_api_ui`, plus the opportunistic rollout
that gets us from "19 files know about dark" to "all of them" without a big-bang
PR. `CLAUDE.md` points here; `REGRESSION_PLAN.md` §0 still wins on hard UI rules.

**The working rule: when you touch a page, migrate that page. If it is already
migrated, skip it and move on.** Nothing else is scheduled.

---

## §1 The five rules

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

There are two things to check, and they catch different bugs.

**A — surfaces that never flipped.** Paste in the console with the app in dark
mode:

```js
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

**B — text you cannot read.** Check A passes while text is still invisible, so
run this one too, in **both** themes — see §5.

```js
// scripts/audit-contrast.js — also paste-able into the console
const parse = (c) => {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  return a < 0.5 ? null : [+m[1], +m[2], +m[3]];
};
// A gradient paints the surface while background-color stays transparent.
// Walking past it is what made the first version of this snippet useless.
const effBg = (el) => {
  for (let n = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const stops = [...cs.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)]
        .map(m => m[1].split(',').map(parseFloat).slice(0, 3))
        .filter(s => s.length === 3 && s.every(Number.isFinite));
      return stops.length ? stops : 'UNKNOWN';   // real image — cannot judge
    }
    const c = parse(cs.backgroundColor);
    if (c) return [c];
  }
  return null;
};
const lum = ([r, g, b]) => {
  const f = (v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b), [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
const bad = [];
for (const el of document.querySelectorAll('*')) {
  if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
  const fg = parse(cs.color), bgs = effBg(el);
  if (!fg || !bgs || bgs === 'UNKNOWN') continue;
  const size = parseFloat(cs.fontSize);
  const need = (size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700)) ? 3 : 4.5;
  const worst = Math.min(...bgs.map(b => ratio(fg, b)));
  if (worst < need) bad.push({ el: el.className || el.tagName, text: el.textContent.trim().slice(0, 30), ratio: +worst.toFixed(2), need });
}
bad.sort((a, b) => a.ratio - b.ratio);
```

Empty results from both mean the page is done. That is the acceptance test.

> **Validate an auditor before you trust it.** The first version of snippet B
> read only `backgroundColor` while walking ancestors. `.topnav` paints its blue
> with `background-image: linear-gradient(...)` and a *transparent*
> `background-color`, so the walk stepped straight past it to `.App`'s white and
> compared white text against white — **33 reported failures on a page with
> none.** Handling `background-image` took it to 17 real ones.
>
> This is `modalDarkSchemeContrast.test.js`'s lesson again, in its own words:
> *"a guard that cries wolf gets switched off."* Run any new auditor against a
> page you know is fine, and treat a wall of failures as a bug in the auditor
> until proven otherwise.

### 5. A rule's ink and its ground come from the same token set.

`var(--th-text)` on a literal `#ffffff`, or a literal `#30313a` on
`var(--th-bg-card)`, is correct in exactly one theme. One half flips, the other
does not, and the text disappears into its own background.

**A half-migrated rule is worse than an unmigrated one.** Unmigrated is merely
light-only. Half-migrated is unreadable — and it is a bug *the migration created*,
which is why this rule exists.

`Footer.css` is the live example. It sets a tokenized ground and border:

```css
.footer {
  background: var(--th-bg-page);        /* flips */
  border-top: 1px solid var(--th-border);/* flips */
  /* ...and never sets color, so the ink stays light-mode grey */
}
```

Result: fine in light, **1.92:1 in dark** — below the 4.5:1 floor, on the footer
of every page. Migrate a rule's surface and its ink together, or leave both alone.

That gives a two-line diagnosis whenever snippet B reports a failure:

- **Fails in one theme only** → half-migration. Find the half that didn't move.
- **Fails in both** → an ordinary contrast bug that predates theming. Fix the
  colour on its merits; it is not a theming problem.

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

Readability is measured per page, not per file. `/admin` alone, via §1.4 snippet
B: **17 contrast failures in light, 23 in dark.** The worst — `emt-rfc`, at ratio
1.00 in both themes — is text that has never been visible on any theme.

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
2. Run §1.4 snippets **A and B**. Both clean → **already migrated, skip the rest.**
3. Switch to light, run **B** again, and note which failures appear in which
   theme — that is the §1.5 diagnosis: one theme means half-migration, both means
   an ordinary contrast bug.
4. For each hit, in its stylesheet: replace surface/line/ink literals with §2
   tokens, **surface and ink together**. Leave brand and accent literals alone.
5. Delete any `@media (prefers-color-scheme)` block you find.
6. Re-run A and B in dark — clean.
7. Re-run B in light — clean, and the page looks as it did.
8. `npm run test:unit && npm run build`.

Steps 3 and 7 are the ones people skip, and they are where the damage hides.
Every conversion touches both themes: a token whose light value differs from the
literal it replaced shifts light mode too, and a ground migrated without its ink
reads fine in the theme you happen to be looking at. You have to check both.

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
