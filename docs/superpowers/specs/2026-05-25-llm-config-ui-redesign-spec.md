# LLM Config UI Redesign + Agent Header Cleanup

**Date:** 2026-05-25  
**Status:** Approved — ready for implementation  
**Scope:** `demo_api_ui/src/components/`

---

## Goal

1. Remove the "LLM only" checkbox from the banking agent header toolbar.
2. Redesign the LLM provider configuration page with polished, professional styling consistent across all three provider panels (Helix, Anthropic, LM Studio).

---

## Change 1 — Agent Header: Remove "LLM only" Checkbox

### What changes
Remove the `<label className="ba-rfc-toggle-label ba-llm-mode-label ...">` block (lines ~6599–6611 in `BankingAgent.js`) that renders the amber "LLM only" checkbox.

Remove the associated CSS from `BankingAgent.css`:
- `.ba-llm-mode-label`
- `.ba-llm-mode-label:hover`
- `.ba-llm-mode-label--active`
- `.ba-llm-mode-cb`

### What stays
- The `heuristicEnabled` / `toggleHeuristicMode` state and logic stay in place — the feature still works, it's just no longer exposed via this UI control.
- All other header controls remain: RFC info checkbox, AgentModeSelector, Compliance button, Token Chain button, Actions button.

### Visual result
The header toolbar loses one control. The remaining controls tighten up naturally with the existing `gap: 6px` spacing.

---

## Change 2 — LLM Config Page Redesign

### Shared design system (new CSS class set: `cfg-*`)

All three provider panels use a shared card shell and class system. Add a new `LlmConfig.css` (or inline in each component — CSS module preferred for isolation).

| Token | Value |
|---|---|
| Card border-radius | `14px` |
| Card border | `1px solid #e2e8f0` |
| Card shadow | `0 1px 3px rgba(0,0,0,0.05)` |
| Input border-radius | `8px` |
| Input border | `1.5px solid #d1d5db` |
| Input padding | `9px 12px` |
| Input focus ring | `border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.08)` |
| Label style | Uppercase, `0.72rem`, `font-weight: 700`, `color: #64748b`, `letter-spacing: 0.06em` |
| Hint text | `0.72rem`, `color: #94a3b8` |
| Button radius | `8px` |
| Button primary | `background: #2563eb; color: #fff` |
| Button secondary | `background: #f8fafc; color: #374151; border: 1.5px solid #e2e8f0` |
| Button danger | `background: #fff; color: #dc2626; border: 1.5px solid #fecaca; margin-left: auto` |

### Provider selector (`ProviderSelector.jsx`)

Replace the current three plain `<button>` elements with a **segmented pill control**:

- Outer wrapper: `border: 1.5px solid #cbd5e1; border-radius: 12px; background: #f1f5f9; padding: 3px; gap: 2px; display: inline-flex`
- Each segment: `padding: 9px 22px; border-radius: 9px; border: none; display: flex; flex-direction: column; align-items: center; gap: 3px`
- Active segment: `background: #fff; color: #1e40af; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,0.1)`
- Inactive segment: `background: transparent; color: #475569; font-weight: 500`
- Status sub-label: `font-size: 0.68rem; font-weight: 600` — green/red/amber per status

Add a page heading above the selector:
```
<h2>LLM Provider</h2>
<p>Select and configure the language model used by the banking agent.</p>
```

### Card shell (shared across all three panels)

Each panel renders inside:
```
┌──────────────────────────────────────────────┐
│ Card header: Title · Subtitle link    [Badge] │
├──────────────────────────────────────────────┤
│ Card body: fields + divider + action row      │
└──────────────────────────────────────────────┘
```

Status badge:
- Active → green pill `#dcfce7 / #15803d`
- Unconfigured → amber pill `#fef9c3 / #854d0e`
- Unreachable → red pill `#fee2e2 / #991b1b`

### `HelixPanel.jsx`

- Card header: "Helix Configuration" · "PingOne AI agent LLM · Open Helix Console ↗" · status badge
- 2-column field grid: Base URL, API Key, Environment ID, Agent Name
- Full-width field: Prompt Field ID
- Divider
- Actions: `Save & Activate` (primary) | `Load from Database` (secondary) | `Import JSON` (secondary file label) | `Clear` (danger, right-aligned)
- Remove inline `console.log` calls (cleanup)

### `AnthropicPanel.jsx`

- Card header: "Anthropic Configuration" · "Cloud API · console.anthropic.com ↗" · status badge
- Fields (all full-width): API Key, Model (select), Base URL Override (optional)
- Info box (two-modes explanation) — styled with `background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px`
- Divider
- Actions: `Save` (primary) | `Clear Key` (danger, right-aligned, only when key is set)

### `LmStudioPanel.jsx`

- Card header: "LM Studio Configuration" · "Local inference via Anthropic API format · lmstudio.ai ↗" · status badge
- Setup instructions box (shown when `serverStatus !== 'running'`): same `cfg-setup-box` style, ordered list
- Status row: badge + `Check Status` button
- Full-width field: LM Studio Server URL
- When server running: loaded model box (green), model select dropdown
- Download progress: purple progress bar with `background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px`
- Divider
- Actions: `Load Model` (green primary, conditional) | `Download & Load` (purple primary) | `Save Model` (secondary)
- Endpoint info box at bottom

### `LlmConfigPage.jsx`

Add page heading (`<h2>` + `<p>`) above `<ProviderSelector>`. No other structural changes.

---

## Files Changed

| File | Change |
|---|---|
| `BankingAgent.js` | Remove "LLM only" checkbox JSX block (~10 lines) |
| `BankingAgent.css` | Remove 4 `.ba-llm-mode-*` CSS rules |
| `ProviderSelector.jsx` | Rewrite to segmented pill control |
| `LlmConfigPage.jsx` | Add page heading above selector |
| `HelixPanel.jsx` | Redesign with card shell + cfg-* classes; remove console.logs |
| `AnthropicPanel.jsx` | Redesign with card shell + cfg-* classes |
| `LmStudioPanel.jsx` | Redesign with card shell + cfg-* classes |
| `LlmConfig.css` (new) | Shared `cfg-*` design system CSS |

---

## Not in scope

- No behaviour changes to any panel (save/load/clear logic unchanged)
- No changes to `heuristicEnabled` / `toggleHeuristicMode` logic in `BankingAgent.js`
- No changes to routing, API calls, or state management
- No changes to `AgentModeSelector` or other header controls

---

## Success criteria

- `LLM only` checkbox is gone from the agent header
- All three provider panels render inside the same card shell with consistent typography, spacing, and button hierarchy
- `cd demo_api_ui && npm run build` exits 0
- No regressions to save/load/clear/import functionality in any panel
- No emoji violations (only `✅`, `⚠️`, `❌` permitted per CLAUDE.md)
