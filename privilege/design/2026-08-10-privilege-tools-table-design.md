# Privilege MCP Client — Tools table + Present mode

Date: 2026-08-10
Page: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`

## Problem

The MCP tool catalog is the whole point of this page, but it only shows as a
cramped list in the narrow left sidebar. There is no wide, scannable,
all-tools-at-once view, and no way to present it.

## Design

Three tool surfaces, each with one job:

1. **Sidebar "MCP TOOLS"** — a compact filterable **index**. One-line rows
   (`fn name · N params`), not the current oversized cards. Keeps the filter box
   and count. Clicking a row selects the tool and switches the main area to the
   Tools tab with that row expanded.

2. **New main-area "Tools" tab** — the centerpiece **table**, default active tab
   once tools load. Columns: **Tool** (mono/teal/bold) · **Description** (full,
   wraps) · **Resources** (param chips from `inputSchema.properties`, required =
   `*` amber, `(none)` when no params) · **Run**. Header: count · filter box ·
   **Present** button.
   - Row click expands an inline detail row: full description, resources detail
     (name · type · required), an **Args (JSON)** box prefilled from the schema,
     an **Execute** button, and the **Result** pane. No-arg tools run in one
     click. This is the full loop: see → run → result.

3. **Present mode** — a **Present** button opens a full-page overlay of the same
   table, **display-only** (Tool/Description/Resources, no Run/expand), large
   type, dismissible with `✕` / `Esc`. For projecting during a demo. Matches the
   page's existing overlay pattern (`cur-modal-overlay`, like the Flow/Blocked
   modals) — not the app DraggableModal, because this is a self-contained themed
   page and a projection surface, not a dialog.

## Components

- New `ToolsTable` component (`components/privilege/ToolsTable.jsx` + `.css`) —
  the page file is already large; a focused unit is cleaner. Props: `tools`,
  `filter`, `presentMode`, `selectedTool`, `onSelect`, and the execute wiring
  (`toolArgs`, `setToolArgs`, `toolResult`, `onExecute`).
- **Resources** derive from `tool.inputSchema.properties` (name, `type`,
  `required[]`). Reuses the `cur-tool-param` chip styling already on the page.
- **Execute** reuses the page's existing `callTool` / `toolArgs` / `toolResult`
  logic — no backend change, no scope change.
- Light/dark aware via the existing `data-cur-theme` scheme.

## Out of scope

- The "Insufficient scope" backend behavior (tracked separately; needs a live
  token to diagnose the gateway's forwarded credential).
- No server changes.

## Verify

- `vite build` exits 0.
- `PrivilegeMcpClientPage.skinPicker` vitest still passes.
- Manual: table renders, row expand + execute works, Present opens/closes (Esc),
  sidebar resize still works, both themes readable, sidebar rows compact.
