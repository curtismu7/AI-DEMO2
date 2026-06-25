# Design: ff_agent_results_panel — Banking Agent Floating Results Panel Flag

**Date:** 2026-05-25  
**Branch:** feat/token-card-service  
**Status:** Approved

---

## Problem

The Banking Agent's `ResultsPanel` (accounts, balance, transactions tables) always renders as a `position: fixed` floating panel to the left of the agent whenever a tool call returns structured data. This panel is always on — there is no way to disable it without code changes. Users who prefer results inline in the chat thread (which already works independently) have no option to turn it off.

---

## Goal

Add a feature flag `ff_agent_results_panel` to the Feature Flags page (`UI / Dashboard` category) that controls whether the floating `ResultsPanel` is rendered at all. **Off by default.** When off, results continue to appear inline in the chat thread as they do today.

---

## Architecture

Three files change. Nothing else.

| File | Change |
|------|--------|
| `demo_api_server/routes/featureFlags.js` | Add flag definition in the `UI / Dashboard` group |
| `demo_api_server/services/configStore.js` | Add `ff_agent_results_panel` to `FIELD_DEFS` |
| `demo_api_ui/src/components/BankingAgent.js` | Gate `ResultsPanel` render on the flag value |

---

## Flag Definition

**Location:** `demo_api_server/routes/featureFlags.js`, appended to the `UI / Dashboard` group (after `ff_show_banking_in_middle_agent`).

```js
{
  id:           'ff_agent_results_panel',
  name:         'Banking Agent — Floating Results Panel',
  category:     'UI / Dashboard',
  description:
    'When **ON**, tool results (accounts, balance, transactions) open in a floating panel ' +
    'positioned to the left of the agent. When **OFF** (default), results appear inline ' +
    'in the chat thread only — no floating panel.',
  impact:
    'OFF (default) = results shown inline in chat; floating panel never rendered. ' +
    'ON = floating panel appears alongside the agent, resizable and positioned dynamically.',
  type:         'boolean',
  defaultValue: false,
},
```

---

## configStore Entry

**Location:** `demo_api_server/services/configStore.js`, `FIELD_DEFS` object, alongside the other `ff_*` UI flags.

```js
ff_agent_results_panel: { public: true, default: 'false' },
```

`public: true` means the BFF exposes it via `/api/config` to the React SPA — the same channel used by `ff_show_banking_in_middle_agent` and `ff_heuristic_enabled`.

---

## BankingAgent.js Gate

The component reads feature flags via `fetch("/api/admin/feature-flags")` — the same pattern used in `UserDashboard.js` for `ff_show_banking_in_middle_agent`. Add a `useState` + `useEffect` pair in `BankingAgent.js` that mirrors that pattern exactly:

```js
const [agentResultsPanelEnabled, setAgentResultsPanelEnabled] = useState(false);

useEffect(() => {
  let cancelled = false;
  fetch('/api/admin/feature-flags', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (cancelled) return;
      const flag = data?.flags?.find(f => f.id === 'ff_agent_results_panel');
      if (flag != null) setAgentResultsPanelEnabled(Boolean(flag.value));
    })
    .catch(() => { /* default stays false — panel hidden */ });
  return () => { cancelled = true; };
}, []);
```

### Conditional render

```jsx
// Before (line ~6502):
{effectiveIsOpen && resultPanel && (
  <ResultsPanel
    panel={resultPanel}
    onClose={...}
    style={resultsPanelStyle}
  />
)}

// After:
{effectiveIsOpen && resultPanel && agentResultsPanelEnabled && (
  <ResultsPanel
    panel={resultPanel}
    onClose={...}
    style={resultsPanelStyle}
  />
)}
```

No other changes to `ResultsPanel`, its positioning logic, resize state, or `resultsPanelStyle` computation.

---

## What Is Not Changed

- **Inline table rendering** — `AccountsTable`, `TransactionsTable`, and the `ba-msg-table` markdown path all remain untouched. Results always appear in the chat thread regardless of flag state.
- **`ResultsPanel` component** — when the flag is on it works exactly as today (fixed positioning, resizable, drag-anchored).
- **`setResultPanel` call sites** — state is still set on every tool result; the flag only controls whether the panel *renders*, not whether state is tracked.
- No new API calls, no new context providers, no new CSS.

---

## Success Criteria

1. `ff_agent_results_panel` appears in the Feature Flags page under `UI / Dashboard`, with toggle and description rendered correctly.
2. **Flag OFF (default):** "My Accounts" chip or chat query returns results inline in the chat thread; no floating panel appears at any viewport size.
3. **Flag ON:** floating `ResultsPanel` appears left of the agent as today; all existing resize/drag/anchor behaviour unchanged.
4. Toggling the flag (via Feature Flags page) takes effect on the next tool call without a page reload (flag is re-read from the public config response on each render cycle).

---

## Regression Notes

- This change does not touch any OAuth, session, token exchange, or HITL paths.
- No `REGRESSION_PLAN.md` §1 files are modified.
- Add a §4 Bug Fix Log entry upon shipping (per repo convention for flag additions that affect agent behaviour).
