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
| `SimBanner` | children, any div props (`data-testid`) | `div.pu-banner-wrap > div.pu-banner[role=note]`. Mode banner: say what is simulated and what is real. |
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
