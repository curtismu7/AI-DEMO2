# The UI standard — theming, type, and the rest of the system

Canonical rules for `demo_api_ui`: light/dark (§1–§7), typography and the token
families that make 274 stylesheets look like one person wrote them (§8–§9).

`CLAUDE.md` points here. **`REGRESSION_PLAN.md` §0 carries the three hard rules
H1–H3 and wins over anything below** — §0 is what `regression-guard` makes you
read before touching UI; this file is the reasoning behind it.

**The working rule: when you touch a page, bring that page up to this standard.
If it already meets it, skip it and move on.** Nothing else is scheduled — a
274-file sweep is explicitly not the plan (§4).

---

## §1 The five theming rules

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
| Reference `--th-*` | 82 |
| Have `[data-theme="dark"]` blocks | 19 |
| **Neither — untouched by theming** | **189** (ratchet-pinned, §6) |
| Carry a real `@media (prefers-color-scheme)` block | 17 |

Readability is measured per page, not per file. `/admin` via §1.4 snippet B was
**17 failures in light and 23 in dark** before #2605; it is **5 in dark** after.
The worst — `emt-rfc` at ratio 1.00 in *both* themes — was text that had never
been visible on any theme.

Reproduce any row:

```bash
cd demo_api_ui/src
find . -name '*.css' | wc -l
grep -rl 'var(--th-' --include='*.css' . | wc -l
grep -rl 'data-theme="dark"' --include='*.css' . | wc -l
grep -rlE '@media.*prefers-color-scheme' --include='*.css' . | wc -l
```

189 unmigrated files is why this is opportunistic and not a project. At the pace
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

---

## §8 Type

### 8.1 Font size comes from the scale, and the scale's floor is 10px

`index.css` already defines the whole scale — 15 sizes, 4 weights. Use
`var(--font-size-*)`, never a literal.

```text
--font-size-3xs  10px   ← the floor. Nothing smaller. Ever.
--font-size-xs   11px      --font-size-base 15px      --font-size-2xl 24px
--font-size-2xs  12px      --font-size-md   16px      --font-size-3xl 30px
--font-size-sm   13px      --font-size-lg   17px      --font-size-4xl 36px
--font-size-body 14px      --font-size-xl   20px
                           --font-size-h1/h2/h3  28 / 22 / 18px
```

"Never below 10px" is not a separate rule to remember — it is a *consequence* of
using the scale, because `--font-size-3xs` is its bottom. Every sub-10px value in
the codebase is an off-scale literal.

Adoption is 44% (1963 tokenised against 2495 literals). The cost of the other
56% is measurable: **one page renders 25 distinct font sizes, 15 of them
off-scale** — 10.4, 10.8896, 11.48, 12.25, 13.125, 13.28, 14.08, 14.72, 23, 25.
The non-integers come from `rem`/`em` compounding against an inherited size,
which is exactly why relative units are a trap here. A page built to one scale
uses six to eight sizes. **That number is the "looks like different developers"
feeling, quantified.**

### 8.2 One family set

`var(--font-primary)` for text, `var(--font-mono)` for code, tokens and figures.

A display face is a **documented, tokenised exception** — never a per-page
choice. `--rd2-font-display` ("Fraunces", Georgia, serif) is the one we have; it
is deliberate, it is consumed through the token, and it should be left alone.
A raw `font-family: 'Crimson Pro', ...` repeated in a component file is not an
exception, it is a second design language nobody agreed to.

### 8.3 No inline `style={{ }}` for anything themeable

Colour, background, font-size. Inline styles beat **every** rule in every
stylesheet, including `[data-theme="dark"]` overrides — so a themed component
with an inline colour is unfixable without touching the JSX.

This is not theoretical: `TokenChainTraceRail.jsx` set three actor colours
inline, which silently defeated the dark overrides sitting in its own stylesheet
and left "Agent" at 2.44:1. There are **366** inline `fontSize` declarations
still in the tree.

Layout properties inline (`gridTemplateColumns`, `width`) are fine — they are not
themeable.

---

## §9 The rest of the system

### 9.1 A token tuned as ink is not automatically usable as a ground

`--dash-accent` is `#7aa2f7` in dark — a light blue chosen to be *read* against a
dark surface. `dashboard.css:56` uses it as a **background** under white text and
lands at **2.52:1**.

Check the *pairing*, not the token. A colour is legible as ink, or as a ground,
and often not both.

### 9.2 `components/dashboard/` is the reference — for architecture, not literals

When nothing else decides a visual question, follow `dashboard/`. What to copy:

- a **local token layer** (`--dash-*`) declared once on the root element and
  aliased onto `--th-*`, with every rule below consuming the local names
- a **minimal dark block** — only the props that are not aliased
- a **semantic tone set** (`--dash-ok/warn/bad` with `.tone-*` modifiers)
- `:focus-visible` on every interactive element, `prefers-reduced-motion` on
  transitions, `tabular-nums` on figures, `overflow-x: auto` on anything wide
- a header comment saying *why*, not what

What **not** to copy: its literals. It is 33% tokenised on type and its sizes are
half-pixel and off-scale (12.5, 11.5, 10.5, 13.5, 21, 25). Round onto the scale
instead. The reference defines the visual language; §8.1 defines the values.

### 9.3 Measured backlog

Nothing below is scheduled. It is recorded so the next person does not re-measure
it, and so a new file is not written in the old style.

| Axis | State | Token family |
| --- | --- | --- |
| `border-radius` | ~2150 declarations, 12+ values (6px×525, 8px×443, 4px×405, …) | none — wants 4 |
| `box-shadow` | 365 distinct values | none — wants 3–4 elevations |
| `z-index` | 179 literals vs 6 tokenised | `--z-*` exists, 3% adopted |
| spacing | untokenised | none |
| `!important` | 571 across 37 files | — |
| `:focus-visible` | 99 rules in 40 of 274 files | — |
| `outline: none` / `0` | 88 — each a keyboard trap without a replacement | — |
| `prefers-reduced-motion` | 154 of 169 animating files unguarded | — |

**Shadow is the biggest single contributor to visual incoherence** — 365 bespoke
elevations means no two surfaces sit at the same height. Radius is the most
*visible* and the easiest to fix.

**The lesson from `--z-*`:** #2585 created the family and adoption stalled at 3%,
because creating a token family is the easy half. Any new family must ship with
its ratchet (§6) in the same PR, or it becomes another six-token layer nobody
uses.
