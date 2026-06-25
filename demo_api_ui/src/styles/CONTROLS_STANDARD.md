# UI control standard (brand toggle system)

One brand color (`#0b69a3`), rounded geometry, fill-on-active, shared focus ring.
Seeded by the PingOne Agent Builder scope toggle.

> **Decision (2026-06-19): controls are a FIXED PingOne blue, intentionally NOT
> themed per vertical.** Do not wire `--ctl-brand` to `--theme-accent`. The
> controls keep a single consistent identity across all verticals by design.

**Tokens** live in [`controls.css`](./controls.css) `:root` (`--ctl-brand`, `--ctl-line`,
`--ctl-ring`, `--ctl-radius`, …). Never hardcode the brand blue — reference the token.

## Checkboxes
- **Any plain `<input type="checkbox">` is restyled automatically** by the global rule
  in `controls.css` (box look). No markup change needed — this is the app-wide sweep.
- For new/touched code prefer the **`<Check>`** component
  ([`components/common/Check.jsx`](../components/common/Check.jsx)):
  - `variant="box"` (default) — universal checkbox.
  - `variant="pill"` — tag / multi-select chips (e.g. scopes). Whole chip fills.
  - `variant="switch"` — on/off settings toggle.
- State is driven by an `is-on` class from the `checked` prop, **not** `:has(:checked)`
  (a React-controlled checkbox's prop-driven state does not reliably re-invalidate
  `:has()` in Chromium — server-set values render un-filled on load).

## Dropdowns
- Add `className="ctl-select"` to a native `<select>` for the standard skin
  (rounded field, brand chevron, focus ring). Native menu is kept.
- Selects with bespoke CSS convert as we touch them.

## Migration policy
- The global checkbox restyle covers most existing checkboxes now.
- As you touch a file with a checkbox/select/toggle, migrate it to `<Check>` /
  `ctl-select` so the markup (not just the paint) is on the standard.
- Opt a native checkbox OUT of the global restyle with `className="ctl-raw"`
  (used internally by `<Check>` since it draws its own mark).
