# Test Chips Guide — Compliance Panel Demonstration

## Where to Find Test Chips

### In the Banking Agent UI:

The test chips are located in the **Actions** section of the Banking Agent. Here's how to access them:

1. **Open the agent** — Click the AI Agent FAB (floating button) in the bottom right
2. **Enable "Actions"** — Click the action popout to see all available chips
3. **Scroll to "Testing"** section — You'll see the test chips grouped at the bottom

---

## Test Chips for Compliance Panel Demo

### 🧪 Testing Section

| Chip | Purpose | Compliance Impact |
|------|---------|------------------|
| **Test Wrong Scope** | Send request with unauthorized scope | Shows auth rejection; minimal steps |
| **Test Wrong Audience** | Send request with wrong audience | Shows auth rejection; minimal steps |
| **Test HITL Transfer** | Attempt high-value transfer | **Triggers HITL consent** — shows full compliance flow |
| **Test OTP Challenge** | Trigger OTP/MFA step-up | Shows MFA steps in compliance checklist |

### 🔒 Sensitive Operations (Regular Actions)

| Chip | Purpose | Compliance Impact |
|------|---------|------------------|
| **View Sensitive Account Details** | Reveals full account numbers | **Triggers HITL + gateway denial** — shows all 12 steps |
| **Show All Customer Accounts** (Admin only) | Lists all accounts | Shows elevated-permission steps |

---

## Quick Demo Flow

### Scenario A: Simple Action (Shows Skip-Step Footer)

```
1. Click "💰 Withdraw" or "📋 Recent Transactions"
2. Agent responds
3. Compliance panel shows ~6 applicable steps
4. Skip-step footer appears:
   "7 steps not triggered — gateway denial and HITL steps only fire on..."
5. Check "Side panel" → FloatingPanel opens
6. Drag and resize to test modal features
```

**Result:** Skip-step footer demonstrates why simple operations don't trigger all steps.

---

### Scenario B: Sensitive Action (No Skip-Step Footer)

```
1. Click "🔒 Sensitive Account Details"
2. Consent dialog appears
3. User accepts consent
4. Compliance panel shows ~10 applicable steps
5. **Skip-step footer is ABSENT** (all steps are applicable)
6. Check "Side panel" → FloatingPanel opens
7. Verify "Last Response" shows consent dialog details
```

**Result:** Demonstrates the difference — sensitive operations trigger more steps.

---

### Scenario C: Test HITL Action (Comparison)

```
1. Scroll down to find "🧪 Test HITL Transfer"
2. Click the chip
3. Compliance panel shows mix of steps
4. Skip-step footer appears (comparing to Scenario B)
5. Use "Side panel" to open modal
```

**Result:** Shows HITL-specific compliance flow.

---

## UI Layout (When Agent is Open)

```
┌─────────────────────────────────────┐
│  AI Demo Assistant                │
├─────────────────────────────────────┤
│  [Messages area - scrollable]        │
│                                      │
│  Agent: "How can I help you today?" │
├─────────────────────────────────────┤
│  ✅ Compliance (inline by default)  │
│  ☐ 1. Agent starts...               │
│  ☐ 2. Agent consults LLM...         │
│  ...                                 │
│  ☐ 12. UI shows GatewayConsentModal │
│                                      │
│  [Skip-step footer if applicable]   │
├─────────────────────────────────────┤
│  [☐ Side panel]                     │
│  [Type your message...]             │
│  [Send button]                      │
└─────────────────────────────────────┘

When "Side panel" checked:

┌──────────────────────────────┐  ┌──────────────────┐
│  AI Demo Assistant        │  │ MCP Compliance   │
├──────────────────────────────┤  │ Checklist (modal)│
│  [Messages area]             │  ├──────────────────┤
│                              │  │ [Draggable!]     │
│  Agent: "..."                │  │ ✅ Step 1        │
│                              │  │ ⚙ Step 2        │
│  (Inline compliance hidden)  │  │ ○ Step 3        │
│                              │  │ ...              │
│                              │  │ [Skip-note]     │
├──────────────────────────────┤  └──────────────────┘
│  [Type your message...]      │
│  [Send button]               │
└──────────────────────────────┘
```

---

## Interpreting the Skip-Step Footer

### Appears When:
- User performs a **simple action** (withdraw, deposit, transfer, etc.)
- The action has **fewer than 12 applicable steps**
- Some steps remain **pending** because they're not needed for this action

**Example:** Withdraw doesn't need HITL consent, so those steps are skipped.

### Does NOT Appear When:
- User performs a **sensitive action** (View Sensitive Account Details)
- **All steps are applicable** to this action
- Every step is relevant to the compliance flow

**Example:** Sensitive details require HITL, so all 12 steps are needed.

---

## Pro Tips

1. **Compare actions side-by-side:**
   - Do "Withdraw" → see skip-step footer
   - Then do "Sensitive Account Details" → footer disappears
   - This visually demonstrates the purpose of the footer

2. **Test modal dragging:**
   - Click the title bar "MCP Compliance Checklist"
   - Drag across multiple monitors if available
   - Uses pointer capture for smooth cross-screen dragging

3. **Test resizing:**
   - Grab the corner handles (8 directions: N, NE, E, SE, S, SW, W, NW)
   - Min size: 260×300px, Max size: respects viewport
   - Resize while agent is processing messages

4. **Test pop-out window:**
   - Click ↗ button → new window opens
   - Window includes all styles and functionality
   - Can resize and position independently
   - Click ↗ again to bring back to main window

---

## Accessibility

- ✅ Keyboard navigation (Tab through steps)
- ✅ ARIA labels on buttons
- ✅ Color contrast passes WCAG
- ✅ `aria-live="polite"` on panel for screen readers
- ✅ Clear semantic structure (ordered list for steps)
