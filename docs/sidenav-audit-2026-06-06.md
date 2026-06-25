# SideNav Audit — 2026-06-06

Playwright-driven audit of every `AdminSideNav` route across both admin and customer sessions.

## Test coverage

- **Admin routes tested**: 44 (all items in `AdminSideNav.jsx` that navigate to a path)
- **Customer routes tested**: 25 (customer-visible subset)
- **Total route checks**: 68
- **All passed**: ✅ 68/68 — no 404s, no React error boundaries, no blank pages
- **Visual spot-check**: 13 key pages screenshotted and confirmed rendering real content

---

## Issues found

### 1. ✅ FIXED — `ArchitectureSimStepDesc.jsx`: `tagStyle` undefined (compile blocker)

**Severity**: Critical — blocked the entire CRA dev server from rendering anything  
**File**: `demo_api_ui/src/components/ArchitectureSimStepDesc.jsx`  
**Root cause**: The component called `tagStyle('#64748b')`, `tagStyle('#22c55e')` etc. throughout, but the function was never defined in the file.  
**Fix applied**: Added the `tagStyle(color)` function definition before `barStyle`.

---

### 2. Dead code — `SideNav.js` has emoji violations and is no longer used

**Severity**: Low  
**File**: `demo_api_ui/src/components/SideNav.js`  
**Detail**: `SideNav.js` and `AdminSideNav.jsx` coexist, but `App.js` only imports and renders `AdminSideNav`. `SideNav.js` contains `🔄 Reset Demo` labels (lines 39, 89) which violate the emoji rule (CLAUDE.md §4 — only `⚠️ ✅ ❌ ☑️` permitted).  
**Action**: Remove `SideNav.js`, `SideNav.css`, and `SideNavEducationTrigger.js` if confirmed unused. Before deleting, verify nothing else imports them (`grep -r "SideNav" src/`).

---

### 3. Action-based nav items not covered by automated routing test

**Severity**: Informational — needs manual walkthrough  
**Detail**: The automation only tests URL-navigable routes. The following action items in `AdminSideNav` were **not** exercised:

| Section | Item | Action |
|---------|------|--------|
| Top | Agent Demo Guide | `navigate('/agent', { state: { openDemoGuide: true } })` |
| Monitoring | Agent Request Flow | dispatches `agent-flow-diagram-open` event |
| Diagrams | Token Flow (Interactive) | opens `/architecture/token-flow.html` in new tab |
| AI Attack Demos | All 6 items | open education modals via `openEdu()` |
| Learn | All 35 items | open education modals / navigate |
| Agent UI | Embedded / Float only | changes dashboard layout + reloads |
| Vertical | picker | calls `POST /api/verticals/active` |
| STOP AGENT | kill switch | shows `KillSwitchConfirmModal` |
| Actions | Customer View / Admin View | calls `POST /api/auth/switch` |
| Actions | Dark Mode | toggles `data-theme` attribute |
| Actions | Reset Demo | shows `ConfirmModal` then logs out |
| Actions | Log Out | calls `performLogout()` |

**Recommended manual check**: Click "STOP AGENT" to confirm the modal appears and can be dismissed. Click "Reset Demo" to confirm the confirm modal appears. Toggle Dark Mode to confirm theme changes.

---

### 4. `/agent` route loses sidebar nav (UX note)

**Severity**: Design observation — not a bug  
**Detail**: Navigating to `/agent` renders a full-screen agent interface without `AdminSideNav`. The only way back is the yellow "Admin Dashboard" / "My Dashboard" banner button. This is intentional but means users have no access to any other nav items while on `/agent` without using the browser back button.  
**Consider**: If this is a demo friction point, add a small "← Back" link or restore the collapsed sidebar in the agent layout. No code change needed unless UX feedback says otherwise.

---

## Summary

The nav is in good shape. The only blocking issue was the compile error in `ArchitectureSimStepDesc.jsx` which is now fixed. The remaining items are cleanup / manual verification.

### Next actions (in priority order)

1. ~~Fix `ArchitectureSimStepDesc.jsx` compile error~~ ✅ Done
2. Manually verify the action-based nav items (STOP AGENT modal, Reset Demo modal, role switch, dark mode)
3. Audit and remove `SideNav.js` / `SideNav.css` / `SideNavEducationTrigger.js` if fully dead
