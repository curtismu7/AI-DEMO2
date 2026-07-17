# Settings Consolidation (step-up threshold + ACR value) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/settings` the single live-editing surface for the global step-up threshold and ACR value, fix a real bug where adjusting the threshold never affected the browser-based `device_picker` HITL flow, and remove the two genuinely-duplicate write paths in `ThresholdControls.js` (global thresholds, feature flags) while leaving its unique per-vertical override section untouched.

**Architecture:** Backend: register a previously-unregistered `configStore` key (`confirm_stepup_threshold_usd`) so it's no longer silently dropped, then extend `routes/admin.js`'s existing `PUT /settings` dual-store-bridge pattern (already used for `maxTransactionAmount`) to also mirror `stepUpAmountThreshold` into that key plus `mfa_threshold_usd`/`SIMULATED_AUTHORIZE_STEPUP_AMOUNT`/`step_up_amount_threshold`. Frontend: consolidate 6 hardcoded `'Multi_Factor'` literals in the setup-wizard family onto one constant, and rewrite two of `ThresholdControls.js`'s three sections from editable to read-only-with-link (the third, per-vertical, is untouched).

**Tech Stack:** Node/Express (`demo_api_server`), React (`demo_api_ui`), Jest for both.

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. No other emoji in any UI text or code.
- No muted/low-contrast gray hint text in modals (REGRESSION_PLAN §0). Applies to any error/status text added to `ThresholdControls.js`.
- Minimal diff — touch only what's specified below; no drive-by cleanup of adjacent code.
- After every `demo_api_ui/` change: `cd demo_api_ui && npm run build` must exit `0` before that task is done.
- `demo_api_server/routes/admin.js`'s `PUT /settings` handler and anything reached via the `configStore` key it writes are REGRESSION_PLAN §1 protected ("Transfer HITL enforcement", "`configStore` / Config UI"). Do not change HITL enforcement *logic* (amount comparisons, `mfaMode` branch selection, 428 status handling) — this plan only makes an already-read key receive a real value.
- Do not touch `ThresholdControls.js`'s per-vertical threshold section (`selectedVertical`, `vertConfirm`, `vertMfa`, `saveVerticalThresholds`) — it stays exactly as it is today, including its existing `POST /api/config/thresholds` call.
- Do not touch `demo_api_server/routes/thresholds.js` or `demo_api_ui/src/components/DemoDataPage.js` — out of scope per the design.
- Do not add per-user-override support for `stepUpAcrValue` or make `confirm_threshold_usd` editable from `SecuritySettings.js` — out of scope per the design.

---

### Task 1: Register `confirm_stepup_threshold_usd` in `configStore`'s `FIELD_DEFS`

**Files:**
- Modify: `demo_api_server/services/configStore.js:471-474`
- Test: `demo_api_server/src/__tests__/configStore-stepUpThresholdSave.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `configStore.setConfig({ confirm_stepup_threshold_usd: '...' })` now persists (previously silently dropped); `configStore.getEffective('confirm_stepup_threshold_usd')` now reflects it. Task 2 depends on this.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/configStore-stepUpThresholdSave.test.js`:

```javascript
/**
 * @file configStore-stepUpThresholdSave.test.js
 * @description confirm_stepup_threshold_usd was never registered in FIELD_DEFS,
 * so configStore.setConfig() silently dropped it (same bug class as
 * configStore-authorizeEndpointSave.test.js's decision-endpoint keys).
 * transactionConsentChallenge.js's getStepUpThreshold() reads this key for the
 * device_picker HITL MFA gate — with the key unregistered, adjusting the
 * step-up threshold anywhere in the app never affected that gate.
 */
'use strict';

describe('configStore confirm_stepup_threshold_usd registration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('setConfig persists confirm_stepup_threshold_usd, readable via getEffective', async () => {
    const configStore = require('../../services/configStore');
    await configStore.setConfig({ confirm_stepup_threshold_usd: '750' });
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('750');
  });

  it('defaults to 500 when never set (matches scopeTopology.stepUpThresholdUsd() fallback)', async () => {
    const configStore = require('../../services/configStore');
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/configStore-stepUpThresholdSave.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — first test gets `undefined`/`''` instead of `'750'` (key silently dropped by `setConfig`); second test may also fail depending on `getEffective`'s handling of a totally unknown key.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/configStore.js`, find this block (around line 471):

```javascript
  // Step-up / HITL thresholds (USD)
  confirm_threshold_usd:           { public: true, default: '250' },
  mfa_threshold_usd:               { public: true, default: '500' },
  step_up_amount_threshold:        { public: true, default: '500' },
```

Replace with:

```javascript
  // Step-up / HITL thresholds (USD)
  confirm_threshold_usd:           { public: true, default: '250' },
  mfa_threshold_usd:               { public: true, default: '500' },
  step_up_amount_threshold:        { public: true, default: '500' },
  confirm_stepup_threshold_usd:    { public: true, default: '500' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/configStore-stepUpThresholdSave.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/configStore.js demo_api_server/src/__tests__/configStore-stepUpThresholdSave.test.js
git commit -m "fix(configStore): register confirm_stepup_threshold_usd in FIELD_DEFS

Was silently dropped by setConfig() (same bug class as the
authorize-decision-endpoint keys) -- the device_picker HITL step-up gate
in transactionConsentChallenge.js reads this key but nothing could ever
successfully write it."
```

---

### Task 2: Add the dual-store bridge to `PUT /api/admin/settings`

**Files:**
- Modify: `demo_api_server/routes/admin.js:524-552`
- Test: `demo_api_server/src/__tests__/adminSettings.stepUpThresholdBridge.test.js` (new)

**Interfaces:**
- Consumes: `configStore.setConfig` (Task 1's newly-registered key), `runtimeSettings.update` (already used in this handler, unchanged).
- Produces: `PUT /api/admin/settings` with `{ stepUpAmountThreshold: N }` in the body now also writes `configStore`'s `mfa_threshold_usd`, `confirm_stepup_threshold_usd`, `SIMULATED_AUTHORIZE_STEPUP_AMOUNT`, `step_up_amount_threshold` to `String(N)`. Task 3's test depends on this.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/adminSettings.stepUpThresholdBridge.test.js`:

```javascript
/**
 * @file adminSettings.stepUpThresholdBridge.test.js
 * @description PUT /api/admin/settings only updated runtimeSettings (in-process
 * only) for stepUpAmountThreshold -- it never mirrored into configStore, so
 * confirm_stepup_threshold_usd (read by transactionConsentChallenge.js's
 * device_picker gate) never reflected what SecuritySettings.js set. This is
 * the same dual-store-bridge pattern already applied to maxTransactionAmount
 * in this same handler.
 */
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => { req.user = { email: 'admin@test.com' }; next(); },
  requireScopes: () => (req, res, next) => next(),
}));

describe('PUT /api/admin/settings — stepUpAmountThreshold dual-store bridge', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    const router = require('../../routes/admin');
    app = express();
    app.use(express.json());
    app.use('/api/admin', router);
  });

  it('mirrors stepUpAmountThreshold into configStore.confirm_stepup_threshold_usd', async () => {
    const configStore = require('../../services/configStore');
    await request(app)
      .put('/api/admin/settings')
      .send({ stepUpAmountThreshold: 900 })
      .expect(200);
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe('900');
    expect(configStore.getEffective('mfa_threshold_usd')).toBe('900');
    expect(configStore.getEffective('step_up_amount_threshold')).toBe('900');
    expect(configStore.getEffective('SIMULATED_AUTHORIZE_STEPUP_AMOUNT')).toBe('900');
  });

  it('does not touch configStore when stepUpAmountThreshold is absent from the body', async () => {
    const configStore = require('../../services/configStore');
    const before = configStore.getEffective('confirm_stepup_threshold_usd');
    await request(app)
      .put('/api/admin/settings')
      .send({ stepUpAcrValue: 'Multi_Factor' })
      .expect(200);
    expect(configStore.getEffective('confirm_stepup_threshold_usd')).toBe(before);
  });
});
```

**Note for the implementer:** if `demo_api_server/middleware/auth.js`'s actual export names differ from `requireAdmin`/`requireScopes`, check `routes/admin.js`'s own imports at the top of the file and mock those exact names instead — the goal is only to bypass admin-auth middleware in the test, not to test auth itself.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/adminSettings.stepUpThresholdBridge.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — first test's `configStore.getEffective('confirm_stepup_threshold_usd')` stays at the default `'500'` instead of becoming `'900'`.

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/routes/admin.js`, find the `PUT /settings` handler (around line 524-552):

```javascript
// PUT /api/admin/settings — update one or more settings at runtime
router.put('/settings', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const changedBy = req.user?.email || req.user?.username || 'admin';
    const result = runtimeSettings.update(req.body, changedBy);

    if (!result.updated) {
      return res.status(400).json({ error: 'No valid settings fields provided.' });
    }

    // Dual-store bridge (write side): mirror a valid maxTransactionAmount into
    // configStore, whose 'max_transaction_amount' key is what
    // routes/transactions.js enforces. Without this write-through the setting
    // is dead. FIELD_DEFS declares the key as MAX_TRANSACTION_AMOUNT and
    // setConfig validates keys case-sensitively, so use the uppercase form.
    if (req.body.maxTransactionAmount !== undefined) {
      const parsedMax = parseFloat(req.body.maxTransactionAmount);
      if (Number.isFinite(parsedMax) && parsedMax >= 0) {
        await configStore.setConfig({ MAX_TRANSACTION_AMOUNT: String(parsedMax) });
      }
    }

    console.log(`[Settings] Updated by ${changedBy}:`, req.body);
    res.json({ message: 'Settings updated successfully.', settings: result.settings });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

Replace with (adds a second dual-store-bridge block; everything else identical):

```javascript
// PUT /api/admin/settings — update one or more settings at runtime
router.put('/settings', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const changedBy = req.user?.email || req.user?.username || 'admin';
    const result = runtimeSettings.update(req.body, changedBy);

    if (!result.updated) {
      return res.status(400).json({ error: 'No valid settings fields provided.' });
    }

    // Dual-store bridge (write side): mirror a valid maxTransactionAmount into
    // configStore, whose 'max_transaction_amount' key is what
    // routes/transactions.js enforces. Without this write-through the setting
    // is dead. FIELD_DEFS declares the key as MAX_TRANSACTION_AMOUNT and
    // setConfig validates keys case-sensitively, so use the uppercase form.
    if (req.body.maxTransactionAmount !== undefined) {
      const parsedMax = parseFloat(req.body.maxTransactionAmount);
      if (Number.isFinite(parsedMax) && parsedMax >= 0) {
        await configStore.setConfig({ MAX_TRANSACTION_AMOUNT: String(parsedMax) });
      }
    }

    // Dual-store bridge (write side): mirror a valid stepUpAmountThreshold into
    // configStore. confirm_stepup_threshold_usd is what
    // transactionConsentChallenge.js's getStepUpThreshold() reads for the
    // device_picker HITL MFA gate; mfa_threshold_usd/step_up_amount_threshold/
    // SIMULATED_AUTHORIZE_STEPUP_AMOUNT are read by other paths (ThresholdControls'
    // display, the simulated authorize server). Without this write-through,
    // device_picker mode silently ignores whatever this endpoint sets.
    if (req.body.stepUpAmountThreshold !== undefined) {
      const parsedThreshold = parseFloat(req.body.stepUpAmountThreshold);
      if (Number.isFinite(parsedThreshold) && parsedThreshold > 0) {
        await configStore.setConfig({
          mfa_threshold_usd: String(parsedThreshold),
          confirm_stepup_threshold_usd: String(parsedThreshold),
          SIMULATED_AUTHORIZE_STEPUP_AMOUNT: String(parsedThreshold),
          step_up_amount_threshold: String(parsedThreshold),
        });
      }
    }

    console.log(`[Settings] Updated by ${changedBy}:`, req.body);
    res.json({ message: 'Settings updated successfully.', settings: result.settings });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/adminSettings.stepUpThresholdBridge.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS (2/2)

- [ ] **Step 5: Run the full existing admin/settings test suite to confirm no regression**

Run: `cd demo_api_server && npx jest routes/admin --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -40`

(If this glob matches nothing, search for the actual existing test file covering `routes/admin.js`'s settings routes — e.g. `grep -rl "PUT /api/admin/settings\|router.put('/settings'" demo_api_server/src/__tests__ demo_api_server/tests` — and run that instead. There must be no regressions in whatever currently covers `maxTransactionAmount`'s bridge.)
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/admin.js demo_api_server/src/__tests__/adminSettings.stepUpThresholdBridge.test.js
git commit -m "fix(admin/settings): bridge stepUpAmountThreshold into configStore

Extends the existing maxTransactionAmount dual-store-bridge pattern.
Without this, PUT /api/admin/settings only updated runtimeSettings
in-process -- confirm_stepup_threshold_usd (read by
transactionConsentChallenge.js's device_picker HITL gate) never reflected
what SecuritySettings.js set, so that flow silently ignored the configured
threshold."
```

---

### Task 3: Regression test proving the `device_picker` gate now respects the bridged value

**Files:**
- Test: `demo_api_server/src/__tests__/transactionConsentChallenge.test.js` (extend existing file)

**Interfaces:**
- Consumes: `transactionConsentChallenge.js`'s existing exported `getStepUpThreshold` behavior (internal, tested indirectly via `confirmChallenge`) and `configStore.getEffective` (real implementation this time, not mocked — to prove the end-to-end path Tasks 1-2 built).
- Produces: nothing new for later tasks — this is an end-to-end confirmation, not a new interface.

**Context:** every existing `device_picker` test in this file mocks `configStore.getEffective` directly (see `devicePickerConfig()` helper around line 315). Those tests intentionally bypass the real `configStore` to isolate `transactionConsentChallenge.js`'s branching logic — do not change them. This task adds one *new* test that uses the real `configStore` (via Task 2's route) instead of a mock, to prove Tasks 1-2 actually close the gap end-to-end.

- [ ] **Step 1: Write the failing test**

In `demo_api_server/src/__tests__/transactionConsentChallenge.test.js`, add near the other `device_picker` tests (after the `devicePickerConfig` helper function, before its first usage — check the file for the right spot, it's used starting around the test after line 322):

```javascript
  describe('device_picker mode — end-to-end with the real configStore (not mocked)', () => {
    it('respects a threshold set via PUT /api/admin/settings, not just the scopeTopology fallback', async () => {
      jest.resetModules();
      const configStore = require('../../services/configStore');
      const txConsentReal = require('../../services/transactionConsentChallenge');

      // Simulate what Task 2's route now does when an admin sets the threshold to 900.
      await configStore.setConfig({
        confirm_stepup_threshold_usd: '900',
        confirm_threshold_usd: '250',
      });
      jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
        if (key === 'hitl_consent_mfa_mode') return 'device_picker';
        return configStore.getEffective.wrappedMethod
          ? configStore.getEffective.wrappedMethod.call(configStore, key)
          : null;
      });

      // Amount 800 is below the 900 threshold now in effect -- should NOT trigger
      // the device-picker MFA path (before this fix, the hardcoded 500 fallback
      // would have incorrectly triggered it, since 800 >= 500).
      const req = makeReq({ session: { txConsentChallenges: {
        'ch-real-1': {
          userId: '5', snapshot: { type: 'withdrawal', amount: 800, fromAccountId: 'acc1', toAccountId: null, description: '' },
          status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 600_000,
        },
      }}});
      const result = await txConsentReal.confirmChallenge(req, 'ch-real-1');
      expect(result.ok).toBe(true);
      expect(result.mfaRequired).toBeUndefined();
      jest.restoreAllMocks();
    });
  });
```

**Note for the implementer:** the `getEffective.wrappedMethod` pass-through pattern above may not work depending on how `configStore` is structured (class instance vs. plain object with bound methods) — if `jest.spyOn(...).mockImplementation` fully replaces the method with no way to call through, instead write the mock explicitly for the two keys this test cares about:

```javascript
      jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
        if (key === 'hitl_consent_mfa_mode') return 'device_picker';
        if (key === 'confirm_stepup_threshold_usd') return '900';
        if (key === 'confirm_threshold_usd') return '250';
        return null;
      });
```

Either form proves the same thing: the value flows from `setConfig`/the bridge through to the gate's actual decision. Use whichever the real `configStore` module shape supports — check `configStore.getEffective`'s definition (`services/configStore.js` around line 988) if unsure.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/transactionConsentChallenge.test.js -t "respects a threshold set via PUT" --testPathIgnorePatterns="/node_modules/"`
Expected: FAILS before Task 1/2 exist (would show `mfaRequired: true` since 800 >= the old hardcoded 500 fallback). Should already PASS at this point in the plan since Tasks 1-2 are done — if it fails here, Tasks 1-2 have a bug; stop and re-check them before continuing.

- [ ] **Step 3: (No production code change — this task is test-only, confirming Tasks 1-2 work end-to-end)**

- [ ] **Step 4: Run the full file to confirm no regressions**

Run: `cd demo_api_server && npx jest src/__tests__/transactionConsentChallenge.test.js --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -20`
Expected: all PASS, including every pre-existing `device_picker`/`homegrown`/`onetime` test.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/src/__tests__/transactionConsentChallenge.test.js
git commit -m "test: prove device_picker HITL gate respects the settings-bridged threshold

End-to-end confirmation (real configStore, not mocked) that Task 1+2's
dual-store bridge actually closes the gap: adjusting the step-up threshold
via PUT /api/admin/settings now changes device_picker mode's real
enforcement decision, not just an unread config key."
```

---

### Task 4: Create the shared `DEFAULT_STEP_UP_ACR_VALUE` constant

**Files:**
- Create: `demo_api_ui/src/config/setupDefaults.js`
- Test: `demo_api_ui/src/config/__tests__/setupDefaults.test.js` (new)

**Interfaces:**
- Produces: `export const DEFAULT_STEP_UP_ACR_VALUE = 'Multi_Factor';` — consumed by Task 5's 3 files.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/config/__tests__/setupDefaults.test.js`:

```javascript
import { DEFAULT_STEP_UP_ACR_VALUE } from '../setupDefaults';

describe('setupDefaults', () => {
  it('exports the default step-up ACR value used across the setup wizard', () => {
    expect(DEFAULT_STEP_UP_ACR_VALUE).toBe('Multi_Factor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.test.js`
Expected: FAIL — cannot find module `../setupDefaults`.

- [ ] **Step 3: Write minimal implementation**

Create `demo_api_ui/src/config/setupDefaults.js`:

```javascript
// setupDefaults.js
// Single source of truth for setup-wizard form defaults that must not drift
// independently across SetupPage.js, SetupWizard.js, and SetupWizardTab.js.
// This mirrors the *initial-setup-wizard-only* default; the live runtime
// default (once a server exists) is demo_api_server/config/runtimeSettings.js's
// own STEP_UP_ACR_VALUE fallback -- the two are independent by design (see
// docs/superpowers/specs/2026-07-16-settings-consolidation-design.md).
export const DEFAULT_STEP_UP_ACR_VALUE = 'Multi_Factor';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/setupDefaults.js demo_api_ui/src/config/__tests__/setupDefaults.test.js
git commit -m "feat(config): add shared DEFAULT_STEP_UP_ACR_VALUE constant"
```

---

### Task 5: Wire the setup-wizard family onto the shared constant

**Files:**
- Modify: `demo_api_ui/src/components/SetupPage.js:45`
- Modify: `demo_api_ui/src/components/SetupWizard.js:89,118,482`
- Modify: `demo_api_ui/src/components/SetupWizardTab.js:19,393`
- Test: `demo_api_ui/src/config/__tests__/setupDefaults.usage.test.js` (new — static-source guard, see note)

**Interfaces:**
- Consumes: `DEFAULT_STEP_UP_ACR_VALUE` from Task 4's `demo_api_ui/src/config/setupDefaults.js`.
- Produces: nothing new for later tasks.

**Note on the test approach:** these three files are large form components with heavy `fetch`/SSE dependencies and no existing test harness (confirmed: zero existing test files for any of them). Rendering them in a test is out of proportion for a copy-consolidation change. Instead, write a static-source guard test (same pattern this codebase already uses for `config/agentModes.js`'s SSOT, per `config/__tests__/agentModes.test.js`) that reads each file's source and asserts the literal `'Multi_Factor'` no longer appears as a code default (only as prose is allowed).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/config/__tests__/setupDefaults.usage.test.js`:

```javascript
import fs from 'fs';
import path from 'path';

const FILES_MUST_NOT_HARDCODE = [
  '../../components/SetupPage.js',
  '../../components/SetupWizard.js',
  '../../components/SetupWizardTab.js',
];

// SetupWizardTab.js:398 has one legitimate prose mention ("e.g., Multi_Factor")
// inside a help-text sentence -- not a code default. Everything else must import
// the shared constant instead of hardcoding the literal.
const ALLOWED_PROSE_LINE_SUBSTRING = 'Find your policies in PingOne Admin Console';

describe('setup-wizard family uses the shared DEFAULT_STEP_UP_ACR_VALUE constant', () => {
  it.each(FILES_MUST_NOT_HARDCODE)('%s imports DEFAULT_STEP_UP_ACR_VALUE', (relPath) => {
    const filePath = path.join(__dirname, relPath);
    const source = fs.readFileSync(filePath, 'utf8');
    expect(source).toMatch(/DEFAULT_STEP_UP_ACR_VALUE/);
  });

  it.each(FILES_MUST_NOT_HARDCODE)('%s has no hardcoded Multi_Factor code default', (relPath) => {
    const filePath = path.join(__dirname, relPath);
    const source = fs.readFileSync(filePath, 'utf8');
    const offendingLines = source
      .split('\n')
      .filter((line) => line.includes("'Multi_Factor'") || line.includes('"Multi_Factor"'))
      .filter((line) => !line.includes(ALLOWED_PROSE_LINE_SUBSTRING));
    expect(offendingLines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.usage.test.js`
Expected: FAIL — all 3 files currently hardcode the literal and don't import the constant.

- [ ] **Step 3: Write minimal implementation**

**`demo_api_ui/src/components/SetupPage.js`** — add the import (near the top, alongside existing imports):

```javascript
import SetupWizard from './SetupWizard';
import SetupStepHelix from './SetupStepHelix';
import SetupStepVerify from './SetupStepVerify';
import apiClient from '../services/apiClient';
import { DEFAULT_STEP_UP_ACR_VALUE } from '../config/setupDefaults';
import './SetupPage.css';
```

Then change line 45 from:

```javascript
    stepUpAcrValue: 'Multi_Factor',
```

to:

```javascript
    stepUpAcrValue: DEFAULT_STEP_UP_ACR_VALUE,
```

**`demo_api_ui/src/components/SetupWizard.js`** — add the import:

```javascript
import React, { useState, useEffect } from 'react';
import { DEFAULT_STEP_UP_ACR_VALUE } from '../config/setupDefaults';
import './SetupWizard.css';
```

Change line 89 from:

```javascript
  `STEP_UP_ACR_VALUE=${creds.stepUpAcrValue || 'Multi_Factor'}`,
```

to:

```javascript
  `STEP_UP_ACR_VALUE=${creds.stepUpAcrValue || DEFAULT_STEP_UP_ACR_VALUE}`,
```

Change line 118 from:

```javascript
    stepUpAcrValue: 'Multi_Factor'
```

to:

```javascript
    stepUpAcrValue: DEFAULT_STEP_UP_ACR_VALUE
```

Change line 482 from:

```javascript
          placeholder="Multi_Factor"
```

to:

```javascript
          placeholder={DEFAULT_STEP_UP_ACR_VALUE}
```

**`demo_api_ui/src/components/SetupWizardTab.js`** — add the import:

```javascript
import React, { useState, useRef, useEffect } from 'react';
import { DEFAULT_STEP_UP_ACR_VALUE } from '../config/setupDefaults';
import './SetupWizardTab.css';
```

Change line 19 from:

```javascript
    stepUpAcrValue: 'Multi_Factor'
```

to:

```javascript
    stepUpAcrValue: DEFAULT_STEP_UP_ACR_VALUE
```

Change line 393 from:

```javascript
              placeholder="Multi_Factor"
```

to:

```javascript
              placeholder={DEFAULT_STEP_UP_ACR_VALUE}
```

Leave line 398 (the help-text prose "e.g., Multi_Factor") untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.usage.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/SetupPage.js demo_api_ui/src/components/SetupWizard.js demo_api_ui/src/components/SetupWizardTab.js demo_api_ui/src/config/__tests__/setupDefaults.usage.test.js
git commit -m "refactor: consolidate setup-wizard ACR-value defaults onto one constant

6 occurrences across SetupPage.js/SetupWizard.js/SetupWizardTab.js hardcoded
'Multi_Factor' independently -- now all import DEFAULT_STEP_UP_ACR_VALUE
from config/setupDefaults.js, so there's exactly one place to change it."
```

---

### Task 6: `ThresholdControls.js` — global thresholds + feature flags become read-only

**Files:**
- Modify: `demo_api_ui/src/components/ThresholdControls.js`
- Modify: `demo_api_ui/src/components/ThresholdControls.css`

**Interfaces:**
- Consumes: existing `GET /api/config/thresholds` and `GET /api/admin/feature-flags` responses (both already fetched in `loadAll()` — unchanged).
- Produces: no new exports. `FeatureFlagsPage.js`/`SecuritySettings.js` are unaffected (this task doesn't touch them).

**What stays exactly as-is (do not touch):** `selectedVertical`, `vertConfirm`, `vertMfa`, `vertSaving`, `vertStatus`, `saveVerticalThresholds()`, the entire "Per-Vertical Thresholds" JSX block (lines ~272-344 today), `toggleSection()`, `openSections` state, `loadAll()`'s fetch calls themselves, the vertical-select `useEffect`, the click-outside-close `useEffect`, `handleToggle()`.

- [ ] **Step 1: Read the current file once more immediately before editing**

Run: `cat demo_api_ui/src/components/ThresholdControls.js` (or use your editor's read tool) — confirm line numbers below still match; if the file has drifted from what's quoted here, adjust line-based edits to match the actual current content while preserving the same intent.

- [ ] **Step 2: Remove `saveThresholds` and `toggleFlag`'s write behavior; keep read state**

Find this block (current lines ~155-182):

```javascript
  const saveThresholds = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body = {};
      if (confirm) body.confirm_threshold_usd = Number(confirm);
      if (mfa) body.mfa_threshold_usd = Number(mfa);
      const res = await fetch('/api/config/thresholds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setConfirm(String(data.confirm_threshold_usd));
        setMfa(String(data.mfa_threshold_usd));
        setStatus('saved');
        setTimeout(() => setStatus(null), 2000);
      } else {
        setStatus('error');
      }
    } catch (_) {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };
```

Delete this function entirely (global thresholds no longer save from this component — `confirm`/`mfa` state stays, populated read-only by `loadAll()`).

Find `toggleFlag` (current lines ~184-210):

```javascript
  const toggleFlag = async (flagId, nextValue) => {
    setFlagSaving(flagId);
    setFlagError(null);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates: { [flagId]: nextValue, ...(FLAG_PAIRS[flagId] ? { [FLAG_PAIRS[flagId]]: nextValue } : {}) } }),
      });
      if (res.ok) {
        const data = await res.json();
        const flagMap = new Map((data.flags || []).map((f) => [f.id, f]));
        setFlags((prev) => prev.map((f) => flagMap.get(f.id) || f));
      } else if (res.status === 403) {
        setFlagError('Admin session required to modify flags');
        setIsAdmin(false);
      } else {
        const errData = await res.json();
        setFlagError(errData?.message || 'Failed to update flag');
      }
    } catch (err) {
      setFlagError('Network error: ' + (err?.message || 'Unknown error'));
    } finally {
      setFlagSaving(null);
    }
  };
```

Delete this function entirely.

Also remove now-unused state that only `saveThresholds`/`toggleFlag` used: `saving`, `setSaving`, `status`, `setStatus`, `flagSaving`, `setFlagSaving`, `[, setFlagError]`, `[, setIsAdmin]`. Find:

```javascript
  const [flagSaving, setFlagSaving] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [, setFlagError] = useState(null);
  const [, setIsAdmin] = useState(false);
```

Delete these 5 lines (their setters are no longer called anywhere once `saveThresholds`/`toggleFlag` are removed).

`toggleFlag` was `FLAG_PAIRS`' only consumer — deleting `toggleFlag` orphans it. Find (near the top of the file, alongside `FLAG_LABELS`/`FLAG_DESCRIPTIONS`):

```javascript
// Flags that must be toggled together to keep the demo working
const FLAG_PAIRS = {
  ff_skip_token_exchange: 'ff_inject_scopes',
  ff_inject_scopes: 'ff_skip_token_exchange',
};
```

Delete this block entirely. Leave `FLAG_LABELS`, `FLAG_DESCRIPTIONS`, and `IMPORTANT_FLAG_IDS` untouched — all three are still used by the new read-only flags JSX in Step 5.

- [ ] **Step 3: Import `Link` for navigation to `/settings` and `/feature-flags`**

Find the top imports:

```javascript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ThresholdControls.css';
```

Replace with:

```javascript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import './ThresholdControls.css';
```

- [ ] **Step 4: Replace the "Step-up Thresholds" section JSX with a read-only display**

Find (current lines ~228-269):

```javascript
        {openSections.thresholds && (
          <>
            <div className="thresh-ctrl__field">
              <label className="thresh-ctrl__label">
                Confirm (consent) $
                <input
                  className="thresh-ctrl__input"
                  type="number"
                  min="1"
                  step="50"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <span className="thresh-ctrl__help">Amount that triggers consent challenge</span>
            </div>
            <div className="thresh-ctrl__field">
              <label className="thresh-ctrl__label">
                MFA step-up $
                <input
                  className="thresh-ctrl__input"
                  type="number"
                  min="1"
                  step="50"
                  value={mfa}
                  onChange={(e) => setMfa(e.target.value)}
                />
              </label>
              <span className="thresh-ctrl__help">Amount that triggers MFA step-up challenge</span>
            </div>
            <button
              type="button"
              className="thresh-ctrl__save"
              onClick={saveThresholds}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Thresholds'}
            </button>
            {status === 'saved' && <span className="thresh-ctrl__ok">✓ Saved</span>}
            {status === 'error' && <span className="thresh-ctrl__err">Error</span>}
          </>
        )}
```

Replace with:

```javascript
        {openSections.thresholds && (
          <>
            <div className="thresh-ctrl__field">
              <span className="thresh-ctrl__label">Confirm (consent) $</span>
              <span className="thresh-ctrl__value">{confirm || '—'}</span>
              <span className="thresh-ctrl__help">Amount that triggers consent challenge</span>
            </div>
            <div className="thresh-ctrl__field">
              <span className="thresh-ctrl__label">MFA step-up $</span>
              <span className="thresh-ctrl__value">{mfa || '—'}</span>
              <span className="thresh-ctrl__help">Amount that triggers MFA step-up challenge</span>
            </div>
            <Link to="/settings" className="thresh-ctrl__editlink">
              Edit in Settings →
            </Link>
          </>
        )}
```

- [ ] **Step 5: Replace the Feature Flags section JSX with a read-only display**

Find (current lines ~346-370):

```javascript
      {/* Feature Flags — important flags only */}
      {flags.filter((f) => IMPORTANT_FLAG_IDS.includes(f.id)).length > 0 && (
        <div className="thresh-ctrl__section">
          <button type="button" className="thresh-ctrl__section-toggle" onClick={() => toggleSection('flags')}>
            <span className="thresh-ctrl__section-title">Feature Flags</span>
            <span className="thresh-ctrl__chevron">{openSections.flags ? '▲' : '▼'}</span>
          </button>
          {openSections.flags && flags
            .filter((f) => IMPORTANT_FLAG_IDS.includes(f.id))
            .map((flag) => (
              <div key={flag.id} className="thresh-ctrl__flag-item">
                <label className="thresh-ctrl__checkbox">
                  <input
                    type="checkbox"
                    checked={flag.value === true}
                    onChange={(e) => toggleFlag(flag.id, e.target.checked)}
                    disabled={flagSaving === flag.id}
                  />
                  <span>{FLAG_LABELS[flag.id]}</span>
                </label>
                <span className="thresh-ctrl__help">{FLAG_DESCRIPTIONS[flag.id]}</span>
              </div>
            ))}
        </div>
      )}
```

Replace with:

```javascript
      {/* Feature Flags — important flags only, read-only (edit at /feature-flags) */}
      {flags.filter((f) => IMPORTANT_FLAG_IDS.includes(f.id)).length > 0 && (
        <div className="thresh-ctrl__section">
          <button type="button" className="thresh-ctrl__section-toggle" onClick={() => toggleSection('flags')}>
            <span className="thresh-ctrl__section-title">Feature Flags</span>
            <span className="thresh-ctrl__chevron">{openSections.flags ? '▲' : '▼'}</span>
          </button>
          {openSections.flags && (
            <>
              {flags
                .filter((f) => IMPORTANT_FLAG_IDS.includes(f.id))
                .map((flag) => (
                  <div key={flag.id} className="thresh-ctrl__flag-item">
                    <div className="thresh-ctrl__flag-row">
                      <span>{FLAG_LABELS[flag.id]}</span>
                      <span className={flag.value === true ? 'thresh-ctrl__ok' : 'thresh-ctrl__flag-off'}>
                        {flag.value === true ? 'On' : 'Off'}
                      </span>
                    </div>
                    <span className="thresh-ctrl__help">{FLAG_DESCRIPTIONS[flag.id]}</span>
                  </div>
                ))}
              <Link to="/feature-flags" className="thresh-ctrl__editlink">
                Edit in Feature Flags →
              </Link>
            </>
          )}
        </div>
      )}
```

- [ ] **Step 6: Add the two new CSS classes**

In `demo_api_ui/src/components/ThresholdControls.css`, find:

```css
.thresh-ctrl__flag-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
```

Add after it:

```css
.thresh-ctrl__value {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
  font-variant-numeric: tabular-nums;
}

.thresh-ctrl__editlink {
  display: inline-block;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #6c8ef7);
  text-decoration: none;
}

.thresh-ctrl__editlink:hover {
  text-decoration: underline;
}

.thresh-ctrl__flag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #1e293b;
}

.thresh-ctrl__flag-off {
  color: #94a3b8;
  font-weight: 600;
}
```

- [ ] **Step 7: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0. Fix any errors (likely candidates: leftover references to deleted state/functions/constants — search the file for `saving`, `setSaving`, `status`, `setStatus`, `flagSaving`, `setFlagSaving`, `setFlagError`, `setIsAdmin`, `saveThresholds`, `toggleFlag`, `FLAG_PAIRS` and confirm none remain — all should be fully removed after this task).

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/ThresholdControls.js demo_api_ui/src/components/ThresholdControls.css
git commit -m "refactor(ThresholdControls): global thresholds + feature flags become read-only

Both sections duplicated a write path that already exists elsewhere
(SecuritySettings.js at /settings, FeatureFlagsPage.js at /feature-flags).
Now display-only with a link to the real editor. Per-vertical thresholds
section is untouched -- it has no duplicate anywhere else in the app."
```

---

### Task 7: New tests for `ThresholdControls.js`

**Files:**
- Test: `demo_api_ui/src/components/__tests__/ThresholdControls.test.js` (new — none existed before this plan)

**Interfaces:**
- Consumes: `ThresholdControls` default export from Task 6's modified component.

- [ ] **Step 1: Check what test tooling this codebase uses for React components**

Run: `grep -l "@testing-library/react" demo_api_ui/src/components/__tests__/*.test.js* | head -3` and open one to confirm the exact render/query helpers and router-wrapping pattern used (this component uses `<Link>`, so it needs a Router wrapper in tests — check how an existing test that also uses `react-router-dom` components handles this, e.g. `MemoryRouter`).

- [ ] **Step 2: Write the tests**

Create `demo_api_ui/src/components/__tests__/ThresholdControls.test.js` (adjust the router-wrapping import/pattern to match what Step 1 found if it differs from the sketch below):

```javascript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ThresholdControls from '../ThresholdControls';

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (url === '/api/config/thresholds') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ confirm_threshold_usd: '250', mfa_threshold_usd: '500' }),
      });
    }
    if (url === '/api/verticals/list') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url === '/api/admin/feature-flags') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          flags: [
            { id: 'ff_hitl_enabled', value: true },
            { id: 'ff_authorize_simulated', value: false },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: false });
  });
});

afterEach(() => {
  jest.resetAllMocks();
});

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Controls' }));
  await waitFor(() => screen.getByRole('dialog', { name: 'Demo controls' }));
}

describe('ThresholdControls', () => {
  it('shows global thresholds as read-only text with a link to /settings, no Save button', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(await screen.findByText('500')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save thresholds/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm \(consent\)/i)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /edit in settings/i });
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('never POSTs to /api/config/thresholds from the global-thresholds section', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    await screen.findByText('250');
    const postCalls = global.fetch.mock.calls.filter(
      ([, opts]) => opts && opts.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);
  });

  it('shows feature flags as read-only on/off text with a link to /feature-flags, no checkboxes', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    await waitFor(() => screen.getByText('Human-in-the-Loop Consent'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /edit in feature flags/i });
    expect(link).toHaveAttribute('href', '/feature-flags');
  });

  it('per-vertical thresholds section is untouched: selecting a vertical still shows editable inputs', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/config/thresholds') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ confirm_threshold_usd: '250', mfa_threshold_usd: '500' }),
        });
      }
      if (url === '/api/verticals/list') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'banking', displayName: 'Banking' }]),
        });
      }
      if (url.startsWith('/api/config/thresholds?vertical=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ flags: [] }) });
      }
      return Promise.resolve({ ok: false });
    });
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    fireEvent.click(await screen.findByText('Per-Vertical Thresholds'));
    const select = await screen.findByLabelText('Vertical');
    fireEvent.change(select, { target: { value: 'banking' } });
    expect(await screen.findByText(`Save for banking`)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd demo_api_ui && npx jest src/components/__tests__/ThresholdControls.test.js`
Expected: PASS (4/4). If the router-wrap or `dialog`/`role` queries don't match Task 6's actual rendered output (e.g. `role="dialog"` `aria-label="Demo controls"` is already in the code at `<div ... role="dialog" aria-label="Demo controls" ...>` — confirm this exact string didn't change), adjust selectors to match reality rather than changing the component to match the test.

- [ ] **Step 4: Run the UI build gate once more**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/__tests__/ThresholdControls.test.js
git commit -m "test(ThresholdControls): cover read-only global/flags sections + untouched per-vertical section

No tests existed for this component before. Covers: global thresholds
render read-only with a /settings link and never POST; feature flags
render read-only with a /feature-flags link and no checkboxes;
per-vertical thresholds remain fully editable, unaffected by this change."
```

---

### Task 8: Remove the stale REGRESSION_PLAN §1 row, final full verification

**Files:**
- Modify: `REGRESSION_PLAN.md` (remove one stale row from §1's table; add a §4 bug-fix-log entry)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Confirm the row is actually stale**

Run: `grep -n "userAttribute" demo_api_ui/src/components/ThresholdControls.js REGRESSION_PLAN.md`
Expected: a hit only in `REGRESSION_PLAN.md` (the table row), none in the component file. If a hit now appears in `ThresholdControls.js` (e.g. Task 6 somehow reintroduced something matching), STOP — do not delete the row; the invariant may be real and this plan's earlier research was wrong. Re-investigate before proceeding.

- [ ] **Step 2: Remove the stale row**

In `REGRESSION_PLAN.md`, find this line in the §1 table:

```
| Demo Controls diagnose | `ThresholdControls.js` — `data.checks?.userAttribute?.pass` shape |
```

Delete it (delete the whole line, including its leading/trailing `|`).

- [ ] **Step 3: Add a §4 bug-fix-log entry**

Find the top of `REGRESSION_PLAN.md`'s `## §4 — Bug Fix Log` section (the most recent entry is currently the "7/16 punch-list batch 2" one). Add a new entry directly above it:

```markdown
### 2026-07-16 — Settings consolidation: step-up threshold dual-store gap + ThresholdControls duplicate writers

**Files changed:** `demo_api_server/services/configStore.js`, `demo_api_server/routes/admin.js`,
`demo_api_server/src/__tests__/configStore-stepUpThresholdSave.test.js`,
`demo_api_server/src/__tests__/adminSettings.stepUpThresholdBridge.test.js`,
`demo_api_server/src/__tests__/transactionConsentChallenge.test.js`,
`demo_api_ui/src/config/setupDefaults.js`,
`demo_api_ui/src/components/SetupPage.js`, `SetupWizard.js`, `SetupWizardTab.js`,
`demo_api_ui/src/components/ThresholdControls.js`, `ThresholdControls.css`,
`demo_api_ui/src/components/__tests__/ThresholdControls.test.js`.

**What was broken:** (1) `confirm_stepup_threshold_usd` — read by
`transactionConsentChallenge.js`'s `device_picker` HITL MFA gate — was never
registered in `configStore`'s `FIELD_DEFS`, so `setConfig()` silently dropped
it; no UI could ever actually change that gate's real threshold, which always
fell back to a hardcoded `500`. (2) `ThresholdControls.js`'s global-threshold
and feature-flag sections duplicated write paths that already exist at
`/settings` and `/feature-flags` respectively, with no indication which was
authoritative. (3) `stepUpAcrValue`'s setup-wizard default was hardcoded
independently in 6 places across 3 files.

**What was fixed:** registered the missing `FIELD_DEFS` key; extended
`routes/admin.js`'s existing `maxTransactionAmount` dual-store-bridge pattern
to also mirror `stepUpAmountThreshold` into `configStore` (closing the
`device_picker` gap); `ThresholdControls.js`'s global-thresholds and
feature-flags sections are now read-only with links to their real editors;
its per-vertical thresholds section (which has no duplicate anywhere else)
is untouched; consolidated the 6 hardcoded ACR-value literals onto one
`demo_api_ui/src/config/setupDefaults.js` constant. Also removed a stale §1
row ("Demo Controls diagnose") that referenced code no longer present in
`ThresholdControls.js`.

**Do not break:** the per-vertical threshold section in `ThresholdControls.js`
must stay fully editable — it's not a duplicate of anything. HITL enforcement
*logic* (amount comparisons, `mfaMode` branch selection, 428 handling) was
not touched, only a previously-dead config key's write path.

**Verify:** `cd demo_api_server && npx jest src/__tests__/configStore-stepUpThresholdSave.test.js src/__tests__/adminSettings.stepUpThresholdBridge.test.js src/__tests__/transactionConsentChallenge.test.js --testPathIgnorePatterns="/node_modules/"`;
`cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.test.js src/config/__tests__/setupDefaults.usage.test.js src/components/__tests__/ThresholdControls.test.js && npm run build`.
```

- [ ] **Step 4: Run the complete verification suite for this whole plan**

Run:
```bash
cd demo_api_server && npx jest src/__tests__/configStore-stepUpThresholdSave.test.js src/__tests__/adminSettings.stepUpThresholdBridge.test.js src/__tests__/transactionConsentChallenge.test.js --testPathIgnorePatterns="/node_modules/"
```
Expected: all PASS.

```bash
cd demo_api_ui && npx jest src/config/__tests__/setupDefaults.test.js src/config/__tests__/setupDefaults.usage.test.js src/components/__tests__/ThresholdControls.test.js
```
Expected: all PASS.

```bash
cd demo_api_ui && npm run build
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs: log settings-consolidation fix in REGRESSION_PLAN §4, remove stale §1 row"
```

---

## Self-Review Notes (for whoever executes this plan)

- Task 2's auth-middleware mock names (`requireAdmin`, `requireScopes`) are a best guess from reading `routes/admin.js`'s usage — verify against the file's actual top-of-file `require()` before writing the test, per that task's inline note.
- Task 3's `getEffective` spy pass-through pattern has a documented fallback if the primary approach doesn't work with this codebase's `configStore` module shape — try the explicit-mock fallback if the first one errors.
- Task 7's exact `@testing-library/react` query patterns should be cross-checked against one real existing test in this codebase (Step 1 of that task) before finalizing, since this is the first test file for this component and there's no prior art to copy within the file itself.
- Every task's file paths and line numbers were read directly from the repository on 2026-07-16 immediately before writing this plan — if significant time has passed before execution, re-read each file before applying line-based edits.
