# Token Chain UI Redesign Specification

**Date:** 2026-06-30  
**Status:** Approved  
**Effort:** Medium  

---

## Overview

Redesign the Token Chain Inspector UI to be **cleaner, easier to read, and more visually appealing** while maintaining all data and functionality. Use a **modal-driven architecture** with collapsible/expandable sections to reduce on-screen clutter.

### Goals
- Simplify the visual hierarchy without losing information
- Make the interface scannable and focused
- Provide deeper insights through expandable details, not fewer details
- Support multiple user intents: debugging, learning, inspection

---

## Current State Problems

1. **Token Exchange Mode table** is prominent but static — takes up lots of vertical space
2. **All claims visible at once** — information overload for quick scans
3. **Limited context** — hard to see the flow and what changed across the exchange
4. **No step-by-step details** — users can't drill into individual steps

---

## Design Approach: Option 1 (Single-Line Summary)

### Layout Strategy
- **Token Exchange Mode** → Collapsed by default as a single-line summary with expandable details button
- **Token Chain Analysis** → Stays as tabbed interface with rich expandable content
- **Token Legend** → Moves to a popup modal (not always visible)
- **Claim Details** → Summary view with "Inspect" buttons that open modals
- **Security Guarantee** → Dismissible/collapsible banner
- **Steps** → Native HTML `<details>` elements (collapsible) with deep drill-down

---

## Detailed Specifications

### 1. Token Exchange Mode Section

#### Collapsed State (Default)
```
🔗 3 tokens in chain: User Token → Agent Token → MCP Token    [Chained]  [View Details]
```

**Components:**
- Left: Summary text with icon and token count
- Center: Badge showing chain status ("Chained", "Single", etc.)
- Right: "View Details" button (primary action)

**Behavior:**
- Clicking "View Details" expands to show the full table below
- Button text toggles to "Hide Details"
- Smooth expand/collapse animation

#### Expanded State
Full table showing:
- **Token Type** (with colored badge: pink for User, purple for Agent, green for MCP)
- **Full Name** (subject_token, actor_token, etc.)
- **Issued By** (PingOne AS)
- **RFC 8693 Role** (Actor, Delegated, etc.)

---

### 2. Token Chain Analysis (Current Call Tab)

#### Sub-sections (in order)

##### a) Token Exchange Flow Diagram (RFC 8693)
- **Default:** Collapsed with toggle button
- **Expanded:** Shows the flow visually
  ```
  User Token (BFF) ─── RFC 8693.1 ──→ Agent Token ─── RFC 8693.2 ──→ MCP Token
  
  ① sub: user-123        → ① act: agent-001       → ① act: [agent, user]
  ② scope: read write    → ② scope: read write    → ② scope: read (narrowed)
  ③ aud: banking-api     → ③ aud: banking-api     → ③ aud: mcp-server (bound)
  ```

##### b) Request Steps (Native `<details>` Elements)
Each step is **expandable** and shows:

**Summary Line:**
- Step number and title
- Timestamp (UTC, with elapsed time from previous step)
- Status badge (✓ Done, ⏳ In Progress, ✗ Error, ⚠️ Warning)

**Expanded Detail Content:**
- **What happens** (narrative explanation)
- **HTTP Request** (full headers + body)
- **HTTP Response** (full headers + body)
- **Token Structure** (JWT claims in code format with highlighting)
- **RFC Citations** (which specs apply)
- **Links to Inspect** (→ Inspect full claims) that open the modal
- **Validation Checks** (✓/✗ for each validation)
- **Errors/Warnings** (⚠️ warning badge if applicable)

**Example Steps:**
1. User presents token to BFF
2. BFF exchanges for Agent Token (RFC 8693 §4)
3. BFF exchanges for MCP Token (scope narrowed)
4. MCP Server validates & executes

##### c) Current Token Chain (3-Column Card View)
Three card layout (User, Agent, MCP):
- Each card shows token type, key claims (abbreviated), and "Inspect" button
- Color-coded borders (pink, purple, green)
- Clicking "Inspect" opens full claims modal

##### d) Scope Changes Highlight
Yellow callout showing:
```
🔍 Scope Changes Across Exchange
User Token: read write → Agent Token: read write → MCP Token: read (narrowed)
← only the 'read' scope was required by this tool
```

---

### 3. Token Legend (Modal Popup)

**Trigger:** "📋 Token Legend" button above tabs

**Content:**
3-column grid showing:
- **Color swatch** (gradient background matching the token type)
- **Token Type** (User Token, Agent Token, MCP Token)
- **Role/Description** (e.g., "subject_token — authenticated user")

**Interaction:**
- Opens as modal overlay
- Closes when user clicks × button or outside the modal
- No animation required (immediate open/close)

---

### 4. Claim Details Modal

**Trigger:** "Inspect" buttons in token cards or "→ Inspect full claims" links in step details

**Content:**
Dynamic based on token type (User, Agent, or MCP):

Each claim shows:
- **Key** (monospace, color-coded: blue)
- **Value** (monospace, gray, word-wrappable for long strings)
- **Description** (plain text, explains the claim per RFC, ~2-3 sentences)

**RFC Claims Covered:**
- Standard (RFC 7519): sub, iss, aud, exp, iat, scope, client_id
- RFC 8693: act, may_act
- RFC 8707: aud binding
- OpenID Core: acr, amr, sid, auth_time
- RFC 9449 (DPoP): cnf
- RFC 9396 (RAR): authorization_details
- PingOne-specific: org, env

---

### 5. Security Guarantee Banner

**Default:** Visible at the top

**Content:**
```
🔒 Security guarantee: User Token and Agent Token are secrets — stored only 
on Backend-for-Frontend (BFF). Only the Delegated Access Token (limited scope + 
nested delegation proof) reaches the MCP Server.
```

**Interaction:**
- Dismissible with × button (floated right)
- Dismissed state persists via sessionStorage (user sees it once per session)
- Can be re-shown via a toggle elsewhere (optional, not required)

---

### 6. Additional Tabs (Minimal Expansion Required)

Tabs remain (Current Call, MCP Results, History, Trust) but only "Current Call" is redesigned.

Other tabs can show existing content or simple placeholders:
- **MCP Results** — Response from MCP Server
- **History** — Audit log of past exchanges
- **Trust** — Trust chain validation results

---

## Data & Functionality Preservation

✅ **All token claims** — still accessible via "Inspect" modals  
✅ **Request/response details** — shown in each step's expanded section  
✅ **Validation results** — displayed as checkmarks/X marks  
✅ **Scope narrowing visualization** — highlighted in the flow diagram and callout  
✅ **Delegation chain proof** — visible in the act claim and RFC citations  
✅ **Timestamps** — shown on each step with elapsed time  
✅ **Errors/warnings** — badges and callouts for failures  

---

## Interaction Patterns

| Action | Result |
|--------|--------|
| Click "View Details" on Token Exchange Mode | Expand table below summary |
| Click step title | Expand step details (native `<details>` toggle) |
| Click "→ Inspect full claims" link | Open modal with all claims explained |
| Click "Inspect" button on token card | Open modal with claims for that token |
| Click "📋 Token Legend" | Open modal with color legend |
| Click × on banner | Dismiss security guarantee (session duration) |
| Click × on modal | Close modal |
| Click outside modal | Close modal |

---

## Visual Design Notes

- **Color Coding:**
  - User Token: Pink (#fce7f3 background, #f472b6 border)
  - Agent Token: Purple (#e9d5ff, #c084fc)
  - MCP Token: Green (#d1fae5, #34d399)
  - Warnings: Yellow (#fef3c7, #fcd34d)
  - Info: Light Blue (#dbeafe, #7dd3fc)

- **Fonts:**
  - Headers: System sans-serif (semibold, 13-14px)
  - Body: System sans-serif (regular, 12-13px)
  - Monospace: Courier New (11-12px for code)

- **Spacing:**
  - Margins between sections: 16px
  - Padding within cards: 12px
  - Gap between columns: 12px

---

## Files to Modify

1. **UnifiedTokenFlowInspector.jsx** — Refactor to use new summary/expand pattern
2. **UnifiedTokenFlowInspector.css** — Update styles for collapsible sections, modals
3. **TokenCard.jsx** (if exists) — Ensure card layout works in new grid
4. **Modal components** (if not existing) — Create reusable modal for claims, legend

---

## Success Criteria

- ✅ Initial page load feels cleaner (no overwhelming table)
- ✅ User can expand any section to get detailed information
- ✅ No data loss — all claims, headers, validation results are accessible
- ✅ Timestamps and error states are visible at a glance
- ✅ Links in step details open claims modals
- ✅ Mobile-responsive (stack columns, collapse modals gracefully)
- ✅ Keyboard accessible (tab through steps, open/close with Enter)

---

## Out of Scope

- Changes to other tabs (MCP Results, History, Trust) — keep existing content
- Agent flow section (left side) — no redesign needed
- Token validation logic — only UI presentation changes
- New data sources or API calls

