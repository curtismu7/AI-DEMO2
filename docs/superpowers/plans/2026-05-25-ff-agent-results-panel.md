# ff_agent_results_panel Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ff_agent_results_panel` feature flag (off by default) that controls whether the Banking Agent's floating `ResultsPanel` is rendered; when off, results appear only inline in the chat thread.

**Architecture:** Three files change. The flag is registered in `configStore.js` (so the BFF persists/reads it), defined with metadata in `featureFlags.js` (so the Feature Flags UI page shows it), and consumed in `BankingAgent.js` (so the `ResultsPanel` JSX is gated on its value). The inline chat-thread table rendering is untouched.

**Tech Stack:** Node/Express (BFF), React 18 / CRA (UI), Jest (tests)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `demo_api_server/services/configStore.js` | Modify line ~175 | Add `ff_agent_results_panel` entry to `FIELD_DEFS` |
| `demo_api_server/routes/featureFlags.js` | Modify lines ~288–290 | Add flag definition object in `UI / Dashboard` group before the closing `]` |
| `demo_api_ui/src/components/BankingAgent.js` | Modify lines ~1970, ~2754–2761, ~6502 | Add state + useEffect to fetch flag; gate `ResultsPanel` render |
| `REGRESSION_PLAN.md` | Modify §4 | Add bug-fix log entry per repo convention |

---

### Task 1: Add flag to configStore

**Files:**
- Modify: `demo_api_server/services/configStore.js:175`

- [ ] **Step 1: Open configStore.js and locate the insertion point**

  In `demo_api_server/services/configStore.js`, find line 175 which reads:
  ```js
  ff_show_banking_in_middle_agent: { public: true, default: 'false' }, // Show banking column alongside centered agent (legacy dashboard layout)
  ```
  The new entry goes immediately after this line.

- [ ] **Step 2: Add the configStore entry**

  Insert after line 175:
  ```js
  ff_agent_results_panel:          { public: true, default: 'false' }, // Show floating results panel alongside agent (off by default; results still appear inline in chat)
  ```

  The block after your edit should look like:
  ```js
  ff_show_banking_in_middle_agent: { public: true, default: 'false' }, // Show banking column alongside centered agent (legacy dashboard layout)
  ff_agent_results_panel:          { public: true, default: 'false' }, // Show floating results panel alongside agent (off by default; results still appear inline in chat)
  step_up_enabled:                 { public: true, default: 'true'  }, // Step-up MFA gate; mirrored into runtimeSettings.stepUpEnabled (runtimeKey)
  ```

- [ ] **Step 3: Verify no syntax errors**

  ```bash
  node -e "require('./demo_api_server/services/configStore')" && echo "OK"
  ```
  Expected: `OK` with no error output.

- [ ] **Step 4: Commit**

  ```bash
  git add demo_api_server/services/configStore.js
  git commit -m "feat(flags): add ff_agent_results_panel to configStore FIELD_DEFS"
  ```

---

### Task 2: Add flag definition to featureFlags route

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js:288–290`

- [ ] **Step 1: Locate the insertion point**

  In `demo_api_server/routes/featureFlags.js`, find lines 288–290:
  ```js
    type:         'boolean',
    defaultValue: false,
  },

  ];
  ```
  This is the closing of `ff_show_banking_in_middle_agent`. The new flag object goes between the `},` on line 288 and the `];` on line 290.

- [ ] **Step 2: Add the flag definition**

  Replace the `},\n\n];` closing of `ff_show_banking_in_middle_agent` so the section reads:

  ```js
    type:         'boolean',
    defaultValue: false,
  },

  // ── UI / Dashboard (continued) ──────────────────────────────────────────────
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

  ];
  ```

- [ ] **Step 3: Verify no syntax errors**

  ```bash
  node -e "require('./demo_api_server/routes/featureFlags')" && echo "OK"
  ```
  Expected: `OK` with no error output.

- [ ] **Step 4: Run the featureFlags route test**

  ```bash
  cd demo_api_server && npx jest featureFlags.route --no-coverage 2>&1 | tail -10
  ```
  Expected: all tests pass. The existing test asserts `flags.length > 0` (not a hardcoded count), so adding a flag does not break it.

- [ ] **Step 5: Spot-check the Feature Flags UI manually (optional but recommended)**

  With the server running (`./run.sh`), visit `https://api.ping.demo:4000/configure?tab=feature-flags` and confirm:
  - `Banking Agent — Floating Results Panel` appears under the `UI / Dashboard` group
  - It shows as OFF by default
  - The description and impact text render correctly

- [ ] **Step 6: Commit**

  ```bash
  git add demo_api_server/routes/featureFlags.js
  git commit -m "feat(flags): add ff_agent_results_panel flag definition to featureFlags route"
  ```

---

### Task 3: Gate ResultsPanel render in BankingAgent.js

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js` (lines ~1970, ~2754–2762, ~6502)

- [ ] **Step 1: Add the state declaration**

  In `BankingAgent.js`, find line ~1970 which reads:
  ```js
  /** Whether the heuristic fast-path is enabled (ff_heuristic_enabled). false = LLM-only mode. */
  const [heuristicEnabled, setHeuristicEnabled] = useState(true);
  ```

  Insert **after** this line (before `const [llmFlagSaving, ...]`):
  ```js
  /** Whether the floating results panel is enabled (ff_agent_results_panel). false = panel hidden; results inline only. */
  const [agentResultsPanelEnabled, setAgentResultsPanelEnabled] = useState(false);
  ```

- [ ] **Step 2: Add the useEffect to fetch the flag**

  Find the existing `useEffect` block that loads `ff_heuristic_enabled` (around line ~2754):
  ```js
  // Load ff_heuristic_enabled flag to sync the LLM-only toggle
  fetch("/api/admin/feature-flags", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const flag = data?.flags?.find((f) => f.id === "ff_heuristic_enabled");
      if (flag != null) setHeuristicEnabled(Boolean(flag.value));
    })
    .catch(() => {});
  }, [isOpen, isLoggedIn, marketingGuestChatEnabled]);
  ```

  Add a second flag read **inside the same `.then()` chain** by changing the block to:
  ```js
  // Load feature flags to sync UI-controlled toggles
  fetch("/api/admin/feature-flags", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const heuristicFlag = data?.flags?.find((f) => f.id === "ff_heuristic_enabled");
      if (heuristicFlag != null) setHeuristicEnabled(Boolean(heuristicFlag.value));
      const panelFlag = data?.flags?.find((f) => f.id === "ff_agent_results_panel");
      if (panelFlag != null) setAgentResultsPanelEnabled(Boolean(panelFlag.value));
    })
    .catch(() => {});
  }, [isOpen, isLoggedIn, marketingGuestChatEnabled]);
  ```

  This reuses the **existing single fetch** — no new network call is added.

- [ ] **Step 3: Gate the ResultsPanel render**

  Find line ~6502:
  ```jsx
  {effectiveIsOpen && resultPanel && (
    <ResultsPanel
      panel={resultPanel}
      onClose={() => setResultPanel(null)}
      style={resultsPanelStyle}
    />
  )}
  ```

  Change it to:
  ```jsx
  {effectiveIsOpen && resultPanel && agentResultsPanelEnabled && (
    <ResultsPanel
      panel={resultPanel}
      onClose={() => setResultPanel(null)}
      style={resultsPanelStyle}
    />
  )}
  ```

  Only the condition on the opening line changes. The `ResultsPanel` JSX body is untouched.

- [ ] **Step 4: Build to verify no compile errors**

  ```bash
  cd demo_api_ui && npm run build 2>&1 | tail -15
  ```
  Expected: exit code 0, `Compiled successfully.`

- [ ] **Step 5: Commit**

  ```bash
  git add demo_api_ui/src/components/BankingAgent.js
  git commit -m "feat(agent): gate floating ResultsPanel on ff_agent_results_panel flag (off by default)"
  ```

---

### Task 4: Add regression log entry

**Files:**
- Modify: `REGRESSION_PLAN.md` §4

- [ ] **Step 1: Add §4 entry**

  In `REGRESSION_PLAN.md`, find the `## §4 Bug Fix Log` section and add a new entry at the top of the list using the template format:

  ```markdown
  ### 2026-05-25 — ff_agent_results_panel: floating Results Panel now off by default

  **Symptom:** The Banking Agent's floating `ResultsPanel` (accounts, balance, transactions pop-out) always appeared after any tool call, even when users preferred results inline in the chat thread. No way to disable without code changes.

  **Root cause:** `ResultsPanel` render was unconditional — `effectiveIsOpen && resultPanel` — with no feature flag gate.

  **Fix:** Added `ff_agent_results_panel` feature flag (default: `false`) in `configStore.js` and `featureFlags.js`. Gated `ResultsPanel` render on `agentResultsPanelEnabled` state in `BankingAgent.js`. Flag readable from Feature Flags page (`UI / Dashboard` category).

  **Files changed:**
  - `demo_api_server/services/configStore.js`
  - `demo_api_server/routes/featureFlags.js`
  - `demo_api_ui/src/components/BankingAgent.js`

  **Regression guard:** Inline chat-thread table rendering (`AccountsTable`, `TransactionsTable`, `ba-msg-table`) is untouched — results always appear in chat regardless of flag state.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add REGRESSION_PLAN.md
  git commit -m "docs(regression): log ff_agent_results_panel flag addition"
  ```

---

## Verification Checklist

Run these checks after all tasks are complete:

- [ ] `node -e "require('./demo_api_server/services/configStore')"` — no error
- [ ] `node -e "require('./demo_api_server/routes/featureFlags')"` — no error
- [ ] `cd demo_api_server && npx jest featureFlags.route --no-coverage` — all pass
- [ ] `cd demo_api_ui && npm run build` — exit 0
- [ ] **Manual: Flag OFF (default)** — trigger "My Accounts" in the Banking Agent → table appears in chat thread, NO floating panel to the left
- [ ] **Manual: Flag ON** — toggle `ff_agent_results_panel` ON in Feature Flags page → trigger "My Accounts" → floating panel appears to the left of the agent as before
- [ ] **Manual: Toggle live** — toggle flag while agent is open → next tool call reflects new state (no reload needed)
