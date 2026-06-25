# Phase 266 Architecture Page — Path Filter Buttons

**Date:** 2026-05-23  
**File:** `demo_api_ui/src/components/Phase266ArchitecturePage.jsx`  
**Route:** `/architecture/phase-266`

---

## Goal

Replace the static 3-card legend row on the Phase 266 architecture page with interactive path-selector buttons. Clicking a path button dims all Mermaid diagram nodes that do not belong to that path, leaving the selected path's nodes at full opacity. "All" resets to the full unfiltered view.

---

## What changes

| Area | Change |
|---|---|
| `PATH_LEGEND` section | Replaced by `PathFilterBar` component (inline in same file) |
| `selectedPath` state | New: `null \| 'A' \| 'B' \| 'C'` |
| SVG post-processing | One-time `tagPathNodes()` call after `mermaid.render()` |
| CSS file | New `.p266-path-active` + `[data-path]` dimming rules |
| Everything else | Untouched — diagram source, specs section, notes section |

---

## Button design (PathFilterBar)

Four buttons in a horizontal row, replacing the `.p266-arch-legend-row` grid:

| Button | Color | Active state |
|---|---|---|
| All | Dark `#1f2937` | Filled dark background, white text |
| Path A | Amber `#b45309` | Filled `#fef3c7` background, amber border+text |
| Path B | Teal `#0f766e` | Filled `#ccfbf1` background, teal border+text |
| Path C | Blue `#1e40af` | Filled `#eff6ff` background, blue border+text |

Each Path A/B/C button shows a small filled color-dot (8px circle) to the left of the label. Inactive buttons are outlined with `#e5e7eb` border and muted text. "All" is active when `selectedPath === null`.

The `PathFilterBar` is a pure presentational component — it receives `selectedPath` and `onSelect` props.

---

## SVG post-processing — `tagPathNodes()`

Called once inside the `mermaid.render()` `useEffect`, after the SVG is injected into `containerRef.current`.

Walks all `<g>` elements in the SVG. For each element, checks whether its text content contains a known node identifier and stamps a `data-path` attribute:

| `data-path` | Mermaid node IDs matched |
|---|---|
| `A` | `MortgageService`, `PathInfo` |
| `B` | `Identity`, `InternalIdToken` |
| `C` | `Accounts`, `Transactions`, `BankingDb` |
| `shared` | `User`, `SPA`, `Gateway`, `PingOne`, `Session` |

Nodes with `data-path="shared"` are never dimmed. Unrecognised nodes (subgraph labels, edge labels) are left untagged and are unaffected by filtering.

Edges (`<path>` arrow elements) are intentionally left untagged — only nodes dim.

---

## CSS filtering mechanism

The diagram wrapper `<div>` receives:
- Class `p266-path-active` when `selectedPath !== null`
- Attribute `data-selected-path="A"` (or B/C) reflecting the current selection

CSS rules in `Phase266ArchitecturePage.css`:

```css
/* Dim nodes not belonging to the selected path */
.p266-path-active [data-path]:not([data-path="shared"]) {
  opacity: 0.15;
  transition: opacity 0.2s ease;
}

/* Un-dim nodes that match the selected path */
.p266-path-active[data-selected-path="A"] [data-path="A"],
.p266-path-active[data-selected-path="B"] [data-path="B"],
.p266-path-active[data-selected-path="C"] [data-path="C"] {
  opacity: 1;
}
```

When `selectedPath === null` (All), neither class nor attribute is set — all nodes render at full opacity as today.

---

## State and data flow

```
selectedPath: null | 'A' | 'B' | 'C'   (useState in Phase266ArchitecturePage)
      │
      ├─► PathFilterBar (props: selectedPath, onSelect)
      │       renders 4 buttons, active styling driven by selectedPath
      │
      └─► diagram wrapper div
              class="p266-arch-diagram-wrapper [p266-path-active]"
              data-selected-path="A|B|C|undefined"
              CSS rules handle opacity based on data-path stamps on SVG <g> elements
```

No re-render of the Mermaid diagram on path switch. The SVG is rendered once at mount; filtering is pure CSS after `tagPathNodes()` stamps attributes.

---

## Files touched

| File | Change |
|---|---|
| `demo_api_ui/src/components/Phase266ArchitecturePage.jsx` | Add `selectedPath` state, `PathFilterBar`, `tagPathNodes()`, update diagram wrapper JSX |
| `demo_api_ui/src/components/Phase266ArchitecturePage.css` | Add `PathFilterBar` button styles + path dimming rules |

No other files touched. No new files created.

---

## Out of scope

- Specs exercised and key architectural decisions sections do not filter — they always show the full content.
- No URL hash / query-param persistence of selected path.
- No animation beyond the 0.2s opacity transition.
- The Mermaid source itself is not modified.
