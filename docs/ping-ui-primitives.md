# Ping UI primitives

Shared page layout for AI-DEMO2, re-created from the standalone Ping UI Standard
(`AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md`) on this app's tokens. First user:
`demo_api_ui/src/pages/PrivilegeSaasAccessPage.jsx`.

- Stylesheet: `demo_api_ui/src/styles/ping-ui.css`, imported once from `src/index.jsx`. Everything is
  `.pu-*`; the standalone `standalone-ui.css` is never imported (its bare `button` / `input` selectors would
  restyle the app).
- React wrappers: `import { ... } from '../components/pingUi'`. Use them where they save markup; the classes
  work on plain elements too.
- Surfaces, lines and ink are `--th-*`, so there is no dark block. Type is the `--font-size-*` scale.
- Shell bar (P1) is not added: the app has its own.

## Colour ownership

| Part | Colour |
| --- | --- |
| Card top edge (default) | the vertical (`--pu-accent` from `--app-primary-red`) |
| Banner left edge, every button | fixed Ping Red (`--btn-accent*`), never the vertical |
| Card variants, chips | `--th-status-*` |

## Page skeleton

```jsx
<PingPage className="my-page">            // .pu-page: ground, ink, --pu-accent. Keep your own class for page CSS.
  <SimBanner data-testid="x-banner">...</SimBanner>   // P2, FIRST child
  <PageHeader ... />                       // existing title band
  <PageFrame>                              // P3, max 1100px
    <Section id="a" kicker="1 · Label" title="Heading" lede="optional">
      <CardGrid>
        <Card title="Request"> ... </Card>
        <Card title="Receipt" tone="ok"> ... </Card>
      </CardGrid>
    </Section>
  </PageFrame>
</PingPage>
```

## Components

| Component | Props | Renders |
| --- | --- | --- |
| `PingPage` | `className`, any div props | `div.pu-page` |
| `SimBanner` | children, any div props (`data-testid`) | `div.pu-banner-wrap > div.pu-banner[role=note]`. Mode banner: say what is simulated and what is real. At <= 600px the banner is held to three lines and a `More` / `Less` button (`aria-expanded`) opens the rest; the full text stays in the DOM, and focusing a link inside opens it. The button appears only while text is clipped. |
| `PageFrame` | children | `div.pu-frame` |
| `Section` | `id` (required, names the landmark), `kicker`, `title`, `lede?` | `section > p.pu-kicker + h2.pu-h2 (+ p.pu-lede)` |
| `CardGrid` | children | `div.pu-card-grid` (auto-fit, min 340px, wraps at phone width) |
| `Card` | `tone?`, `title?` (renders `h3.pu-h3`), `className`, div props | `div.pu-card` |
| `StatusChip` | `tone` (default `neutral`), children = the word (required) | `span.pu-chip.pu-chip--tone` with a dot |
| `KvList` | `items: [{ label, value, mono? }]` | `dl.pu-kv` (one column under 600px) |

## Variants

- `Card tone`: omit for the vertical accent (a plain summary card); `neutral` (grey edge: tables, notes);
  `ok` (green: a completed / issued thing); `live` (blue: a real, non-simulated call); `warn`; `danger`.
  A toned card should also carry a `StatusChip`: never colour alone.
- `StatusChip tone`: `ok`, `info`, `warn`, `danger`, `neutral`. The text is the status ("Done", "Denied").

## Plain-class pieces (no wrapper)

`.pu-h3`, `.pu-lede`, `.pu-label` + `.pu-select` (form row), `.pu-note` (small body text), `.pu-empty` (dashed
empty state, combine with `.pu-note`), `.pu-status-line` (chip + sentence row), `.pu-mono` (ids, timestamps),
`.pu-actions` (button row).

## Buttons (P9)

Plain `<button>` elements. `className="pu-btn"` is the bordered secondary; `className="pu-btn pu-btn--primary"` is
the Ping Red gradient, **exactly one per view**. Never a vertical colour, never purple or indigo. The rules sit
under `.pu-page`, so buttons must be inside `PingPage`. `PrivilegeLiveCheck` takes `buttonClassName="pu-btn"` (a
secondary) and `statusChip` for the word-bearing result chip; without `buttonClassName` it renders a primary.

**Shared diagram controls.** The step buttons of the shared diagram (`DiagramStepBar` / `DiagramControls`) are
bordered secondaries inside `.pu-page` (Simulate, Prev, Pause, Resume, Next and Stop alike), so a page's own primary
stays the only one. A page that wants its diagram's Simulate to be the view's one primary restyles that one button in
its own sheet (`PrivilegeMapPage.css` does, where the diagram view has no other action). Outside `.pu-page` the
diagram keeps its original look. Pressing Simulate, Pause, Resume or Stop moves keyboard focus to the control that
replaces it, so Tab continues from the toolbar. The lesson sidebar (`.lesson-nav-item`) focus ring uses
`--th-status-info-text`, 3:1 or better on every surface in both themes (`pingUiSharedA11y.test.js` measures it).

## Not in the primitives (keep page-local)

Stage lists, matrix / drift tables (the `.psa-table` stack-at-phone pattern is a candidate to promote when a second
page needs it), inspector layout (P6) and diagram boxes (P8).

## Converting a page

1. Wrap in `PingPage`, banner first, `PageFrame`, `Section`s; swap local markup for the wrappers.
2. Delete the page CSS that the primitives now cover; keep only what is specific.
3. Keep every `data-testid`. Tokens only, no inline colour, no font below 10px.
4. Add the route to `demo_api_ui/scripts/ui-pattern-converted.txt` so `check-ui-patterns.mjs` enforces it.
5. Check light, dark and 375px in the browser; run `contrastRatchet`, `designTokenRatchet`, `buttonFixedAccent`.

`node demo_api_ui/scripts/check-ui-patterns.mjs --route /your-route` prints each rule for one page.

## What the pattern check scans

Two rule sets, both in `demo_api_ui/scripts/check-ui-patterns.mjs`:

- **Shared set, always enforced** (fails CI whatever the allowlist says): `src/styles/ping-ui.css`, **every file under
  `src/components/pingUi/`, recursively**, and the shared children that converted pages mount
  (`components/privilege/PrivilegeLiveCheck.jsx/.css`). The list is `SHARED_FILES` / `SHARED_DIRS` in the script;
  add a shared component there when a converted page starts depending on it. `.js .jsx .ts .tsx .mjs .cjs .mts .cts`
  and `.css` are scanned; `.md` and `.txt` are inert; **any other file type, or a symlink, fails the run** (the
  scanner cannot read it, so it must not pass unseen). It also fails when a listed shared file goes missing.
- **Per page**, for the routes in `ui-pattern-converted.txt` (others are advisory): the page JSX plus the
  stylesheets it imports (`@import`, CSS-modules `composes ... from`, `import()`/`require()`), plus any `<style>`
  element and any `styled.x` / `css` / `createGlobalStyle` / `keyframes` template in it. An import of `.scss`/`.less`
  fails the page.

How it decides:

- A *button rule* is any selector that names a `<button>`, `[type=submit]`, anything with `button`/`btn`, or a class
  the scanned JSX puts on a button. That class is resolved through `className={variable}`, ternaries, template
  literals (a partly known name such as `` `psa-${x}` `` becomes a prefix pattern), `clsx`/`cn`/`classNames` calls,
  object maps, functions that return a class, CSS-modules members (`styles.go`), `btnClass=`/`buttonClassName=`
  attributes, `React.createElement('button', ...)`, `as="button"`, and components defined in the same file that render a
  `<button>`. When the page contains a button at all, a selector whose subject has no class to rule it out (`#id`, `[attr]`,
  a bare pseudo-class, `*`, `:is()` alternatives, structural selectors, `button`, `summary`) is a button rule too,
  and so is a `@keyframes` that a button rule animates.
- *Violet/indigo* is any colour whose hue is 235-300 deg with saturation above 20%: hex, `rgb`, `hsl`, `hwb`, `lab`,
  `lch`, `oklab`, `oklch`, `color()` in `srgb`, `srgb-linear`, `display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`,
  `xyz`, `xyz-d50`, `xyz-d65`, named and system colours, `calc()` inside any of them, relative colour syntax
  (`oklch(from var(--x) l c calc(h + 90))`), both branches of `light-dark()`, and both inputs plus the mixed result of
  `color-mix()` (judged in sRGB and Oklab), reached through `var()` chains.
- **Unknown is drift.** A button colour that cannot be resolved (an undefined or cyclic `var()`, `attr()`, `env()`, an
  OS-tinted system colour such as `AccentColor`, an unsupported colour space, a `calc()` that does not reduce) fails
  as "P9 button colours resolvable". Only `transparent`, `currentColor`, `inherit`, `initial`, `unset`, `revert`, `none`
  and tokens that resolve to a non-violet colour pass. Same for font sizes ("H2 font sizes resolvable").
- The font floor reads `font-size` and the `font` shorthand in every absolute and relative unit, viewport units
  (judged at 375, 768, 1280 and 1920 px wide), keywords and unitless `0`, with `clamp`/`min`/`max`/`calc` evaluated by
  interval arithmetic (so `max(var(--x), 12px)` is proven safe and `max(var(--x), 4px)` is unknown). `rem` is 16px
  unless a scanned stylesheet sets `html`/`:root` font size (the 62.5% trick is followed).
- `--btn-accent*` and `--font-size-*` are checked wherever they are defined: page CSS, imported CSS, shared CSS,
  `@property` initial values and inline `style`, under any selector.
- Inline style: camelCase, kebab-case and quoted keys, `style={identifier}` resolved in the file, `style="..."`, computed
  keys, and `el.style.x =` / `setProperty` assignments. A chip whose only child is `{""}`, `{" "}`, `{null}` or `&nbsp;`
  has no text.
- **Escape hatch** (CSS only, unknown values only): `/* ui-pattern: allow <reason of 8+ characters> */` on the
  declaration's line or the line above. It never excuses violet, a vertical token or a size that resolves under 10px, a
  comment without a reason is itself drift, and every escape is printed in the report.

What it still cannot see (a clean run is not "the page is right"; check light, dark and 375px in the browser):

- a banner or button rendered by a child component outside the shared set, and that child's own stylesheet
  (`--route` lists the unscanned children as INFO); a button whose class is only reachable through an imported
  component, a prop (`className={props.x}`) or a spread (`{...rest}`);
- anything set at runtime: the vertical's inline `--app-primary-red`, a skin, the CDN theme, `el.style` from a helper,
  a `<style>` element or stylesheet built or loaded from JS, `<link>` stylesheets, `setProperty` on a variable;
- `inherit` and `currentColor` take the parent's value, which is unknown (they are accepted as safe keywords);
- colours inside `url()`/data URIs and strings, and images; transforms, zoom and filters that shrink or recolour text;
- `em` and `%` sizes are taken against a 16px parent; container-query units (`cq*`) and `lh`/`cap`/`ic` units are
  reported as unknown rather than resolved; trigonometric `calc()` functions are unknown;
- global rules in `src/index.css` and other `src/styles/*.css` files other than their custom properties (only
  `ping-ui.css` is scanned as a rule set).

Mutation tests for every rule are in `src/__tests__/uiPatternsMutation.test.js` (run against another version of the
script with `UI_PATTERN_SCRIPT=/path/to/script.mjs`); evaluator unit tests are in `src/__tests__/uiPatterns.test.js`.
