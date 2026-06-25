# Compliance Panel Modal — Test Instructions

## Overview
The compliance panel now displays a **floating modal** that is **draggable**, **resizable**, and can **pop-out to a new window**. It also explains why certain steps are "pending" by showing a skip-step footer.

---

## Test Scenario 1: Simple Action (Shows Skip-Step Footer)

**Action:** Withdraw $100
- ✅ Click "💰 Withdraw" chip
- ✅ Agent processes request
- ✅ Compliance steps populate
- ✅ **Skip-step footer appears** at bottom:
  > "7 steps not triggered — gateway denial and HITL steps only fire on scope-upgrade or permission-required operations (e.g. Sensitive Account Details)."
- ✅ Check "Side panel" checkbox → Modal opens on left
- ✅ Drag the modal title bar → moves around screen
- ✅ Resize using corner handles → adjusts dimensions
- ✅ Click ↗ button → opens in new browser window
- ✅ Uncheck "Side panel" → back to inline view

**Why skip-step footer shows:**
- Simple withdraw doesn't require gateway denial checks
- No HITL (Human-In-The-Loop) consent needed
- Steps 4b-12a (gateway/HITL steps) remain pending

---

## Test Scenario 2: Sensitive Account Details (No Skip-Step Footer)

**Action:** View Sensitive Account Details
- ✅ Click "🔒 Sensitive Account Details" chip
- ✅ Agent processes request (triggers consent dialog)
- ✅ Compliance steps populate
- ✅ **Skip-step footer DOES NOT appear** (all steps applicable)
- ✅ Steps show:
  - Gateway scope mapping (gw-scope-map)
  - HITL challenge type (gw-hitl-challenge-type)
  - Agent error propagation
  - UI gateway consent
  - Claim diagnostics
- ✅ Modal still draggable and resizable
- ✅ Verify white background on all steps

**Why skip-step footer does NOT show:**
- Sensitive operations require ALL 10+ steps
- Gateway denial steps are fully applicable
- HITL consent steps are fully applicable
- No "pending" steps are skipped for this action

---

## Test Scenario 3: Test HITL Transfer (Shows Skip-Step Footer)

**Action:** Test HITL Transfer
- ✅ Scroll down in actions to find "Test HITL Transfer"
- ✅ Click the chip
- ✅ Compliance steps populate with mix of applicable/pending
- ✅ **Skip-step footer shows**
- ✅ Compare to Scenario 1 vs Scenario 2

---

## Test Checklist

### Compliance Panel Display
- ☑️ White background (not light blue)
- ☑️ Shows 12 steps in list
- ☑️ Icons: ✅ (done), ❌ (error), ⚙ (active), ○ (pending)
- ☑️ "Intent-Bound Delegation" section header appears before "olb-resource-token" step

### Skip-Step Footer
- ☑️ Shows only when non-applicable steps exist
- ☑️ Displays count: "N steps not triggered"
- ☑️ Explains: "gateway denial and HITL steps only fire on..."
- ☑️ Disappears when checking "Sensitive Account Details" action

### FloatingPanel Modal Features
- ☑️ Opens when "Side panel" checkbox is checked
- ☑️ "Last Response" section shows above checklist
- ☑️ Clear button resets steps
- ☑️ **Dragging**: Click title bar, drag across screen
- ☑️ **Resizing**: Grab corner/edge handles, drag to resize
- ☑️ **Min/Max sizes**: Can't shrink below 260×300px
- ☑️ **Pop-out**: ↗ button opens new window
- ☑️ **Collapse**: ▲ button collapses/expands panel
- ☑️ Modal positioned left (252px) to avoid side nav

### All Agent Modes
- ☑️ Floating mode: Draggable panel appears on right
- ☑️ Embedded/middle mode: Modal appears in content area
- ☑️ Bottom dock mode: Modal works when docked at bottom

### Error Scenarios
- ☑️ No JavaScript errors in console
- ☑️ Modal persists during message flow
- ☑️ Dragging works smoothly (no lag)
- ☑️ Resizing is fluid

---

## Expected Differences Between Actions

### "Withdraw $100" (simple)
- Applicable steps: 6 (accounts, transactions, balance, deposit, withdraw, transfer)
- Skipped: 6 (gateway denial, HITL consent, etc.)
- Skip-step footer: **SHOWN**

### "View Sensitive Account Details"
- Applicable steps: 10
- Skipped: 2
- Skip-step footer: **NOT SHOWN** (no pending non-applicable steps)

### "Test HITL Transfer"
- Applicable steps: 7-9
- Skipped: 3-5
- Skip-step footer: **SHOWN**

---

## Visual Inspection

1. Open DevTools (F12)
2. Check Styles tab for:
   - `.ba-compliance-panel--modal { height: 100%; background: #fff; }`
   - `.ba-compliance-panel__skip-note { font-size: 0.78rem; border-top: 1px solid #e5e7eb; }`
3. Check Network tab for no errors
4. Check Console for no errors/warnings (except deprecation warnings)

---

## Success Criteria

✅ All test scenarios pass
✅ Skip-step footer appears/disappears correctly based on action
✅ FloatingPanel is draggable and resizable
✅ White background throughout
✅ No console errors
✅ Modal responsive in all three agent modes
