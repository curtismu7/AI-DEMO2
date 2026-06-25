# Red Button / Kill Switch Feature

**Phase 159**: Agent Emergency Control — Emergency stop for BX Finance AI agents via kill switch UI.

---

## Overview

The **Red Button** (🛑 STOP AGENT) is an emergency control mechanism that allows **both admin and customer users** to immediately revoke (kill) the AI agent's session and access across all dashboard pages. When activated, the agent loses all permissions and cannot execute further actions.

---

## User Interface

### Where It Appears

Red button appears in the sidebar on **all authenticated pages**:

| Sidebar Type | Location | Pages |
|--------------|----------|-------|
| **Admin Sidebar** (AdminSideNav.jsx) | Collapsible "🛑 Safety" section | Admin Dashboard, Monitoring, Architecture, Tests, Config, etc. (13 routes) |
| **User Sidebar** (SideNav.js) | "Safety" section | Customer Dashboard, Delegated Access, Account, Transactions, etc. |

### Button States

| State | Appearance | Behavior |
|-------|-----------|----------|
| **Active** | 🛑 STOP AGENT (red #ef4444) | Clickable, opens confirmation modal |
| **Revoked** | 🔒 AGENT REVOKED (gray #999) | Disabled, shows agent has been stopped |
| **Collapsed Sidebar** | 🛑 emoji only | Icon visible without label |

---

## User Flow

### 1. User Initiates Kill Switch

```
User sees red button in sidebar
        ↓
Clicks "🛑 STOP AGENT" button
        ↓
showKillModal state = true
        ↓
KillSwitchConfirmModal renders
```

### 2. Confirmation Modal

Modal shows:
- **Heading**: "🛑 Agent Kill Switch — Are you sure?"
- **Reason Dropdown** with 5 predefined options:
  1. "Security concern"
  2. "Unexpected behavior"
  3. "Testing purposes"
  4. "User request"
  5. "Other (specify)"
- **Text field** for custom reason if "Other" selected
- **Cancel** button (closes modal without action)
- **STOP AGENT** button (red, triggers kill switch)

### 3. Kill Switch Execution

When user confirms:

```
User clicks "STOP AGENT" in modal
        ↓
handleKillSwitchConfirm(agentId, reason) handler executes
        ↓
POST /api/admin/agent/{agentId}/kill-switch
    with body: { reason: "Security concern" }
        ↓
If success (200-299):
    - agentRevoked state = true
    - showKillModal state = false
    - Red button becomes gray + disabled
    - Shows "🔒 AGENT REVOKED"
    - Console logs success
        ↓
If error:
    - Modal stays open
    - Error logged to console
    - User can retry or cancel
```

---

## Backend Implementation

### Endpoint

**Route**: `POST /api/admin/agent/:agentId/kill-switch`

**Authenticated**: ✅ Yes (via session cookie)

**Payload**:
```json
{
  "reason": "Security concern"
}
```

**Response** (on success):
```json
HTTP 200 OK
{
  "success": true,
  "agentId": "default-agent",
  "revokedAt": "2026-04-30T12:00:00Z",
  "reason": "Security concern",
  "status": "revoked"
}
```

### Backend Actions (Phase 159)

When kill switch is triggered, backend:

1. **Revokes agent session** via `killSwitchService.js`
   - Invalidates all current tokens
   - Prevents token reuse/refresh

2. **Logs revocation** via `auditLogService.js`
   - Records timestamp, user, reason, agent state
   - Immutable audit trail for compliance

3. **Rate limits further attempts** via `agentRateLimit` middleware
   - Prevents agent from executing new calls
   - Returns 429 Too Many Requests

4. **Updates forensic audit** (ForensicAuditDashboard.jsx)
   - Shows kill event in timeline
   - State snapshot before revocation captured

---

## Component Architecture

### Frontend Components

#### 1. **RedButton.jsx** (Used in Admin.jsx only directly)
- Circular red button, 120px diameter
- Props: `isRevoked`, `onClick`
- Shows "🔴 STOP AGENT" label
- Disabled when `isRevoked={true}`

#### 2. **KillSwitchConfirmModal.jsx**
- Modal dialog with backdrop
- Props: `isOpen`, `onClose`, `onConfirm`
- Reason dropdown + custom reason field
- Callback signature: `onConfirm(agentId, reason)`

#### 3. **AdminSideNav.jsx** (Admin sidebar)
- Imports: RedButton, KillSwitchConfirmModal
- State: `showKillModal`, `agentRevoked`
- Handler: `handleKillSwitchConfirm()`
- Render: Collapsible "🛑 Safety" section with red button
- Modal rendered before closing `</div>`

#### 4. **SideNav.js** (User sidebar)
- Imports: RedButton, KillSwitchConfirmModal
- State: `showKillModal`, `agentRevoked`
- Handler: `handleKillSwitchConfirm()`
- Render: "Safety" section with red button
- Modal rendered before closing `</aside>`

### Data Flow Diagram

```
User clicks red button
    ↓
showKillModal = true (state update)
    ↓
KillSwitchConfirmModal renders
    ↓
User selects reason and confirms
    ↓
onConfirm callback fired
    ↓
handleKillSwitchConfirm(agentId, reason)
    ↓
fetch POST /api/admin/agent/{agentId}/kill-switch
    ↓
Backend processes kill switch
    ↓
Response: 200 OK
    ↓
setAgentRevoked(true)
setShowKillModal(false)
    ↓
Red button becomes gray + disabled
    ↓
ForensicAuditDashboard shows revocation event
```

---

## Session & Token Impact

### Before Kill Switch

```
User Session: ACTIVE
Session token: valid
Agent permissions: full (can execute MCP tools)
Audit log: normal activity
```

### After Kill Switch

```
User Session: ACTIVE  (user can still navigate)
Session token: valid  (user authenticated)
Agent permissions: REVOKED (cannot execute tools)
Error on agent call: 401 Unauthorized or 429 Too Many Requests
Audit log: kill_switch_triggered event recorded
ForensicAuditDashboard: shows revocation timestamp + reason
```

**Key**: User remains logged in but agent is disabled.

---

## Visibility & Access Control

### Who Can Use Kill Switch

| Role | Can Access | Pages |
|------|-----------|-------|
| **Admin** | ✅ Yes | 13+ admin routes (AdminSideNav) |
| **Customer** | ✅ Yes | All customer routes (SideNav) |
| **Logged out** | ❌ No | N/A (no sidebar) |

**Note**: Both roles can revoke the agent. This is intentional — allows customers to disable agent on their own account.

---

## Error Handling

### Network/API Error

```javascript
try {
  const response = await fetch(`/api/admin/agent/${agentId}/kill-switch`, {...});
  if (!response.ok) throw new Error(`Kill switch failed: ${response.status}`);
  // success path
} catch (e) {
  console.error("[ComponentName] Kill switch error:", e.message);
  // Modal stays open, user can retry
}
```

### Modal Still Open on Error

- User can click Cancel to close modal
- User can try again with different reason
- No state mutation on error (safe retry)

---

## Testing the Feature

### Manual Test (Browser)

1. **Navigate to any dashboard page** (admin or customer)
2. **Sidebar visible** on left with navigation
3. **Look for "🛑 Safety" section** (admin) or "Safety" section (customer)
4. Click "🛑 STOP AGENT" button
5. **Modal appears** with:
   - "🛑 Agent Kill Switch — Are you sure?" heading
   - Reason dropdown (default: "Security concern")
   - STOP AGENT button (red)
   - Cancel button
6. **Select a reason** (or "Other" + enter custom text)
7. **Click "STOP AGENT"**
8. **Expected outcome**:
   - Modal closes
   - Button becomes gray
   - Button text changes to "🔒 AGENT REVOKED"
   - Button disabled (no more clicks)
   - Console shows: "[AdminSideNav] Agent kill switch successful" or "[SideNav] Agent kill switch successful"

### API Test (curl)

```bash
curl -X POST http://localhost:3001/api/admin/agent/default-agent/kill-switch \
  -H "Content-Type: application/json" \
  -H "Cookie: sessionId=..." \
  -d '{"reason":"Security concern"}'

# Expected response:
# HTTP 200
# {
#   "success": true,
#   "agentId": "default-agent",
#   "revokedAt": "2026-04-30T12:00:00Z",
#   "reason": "Security concern",
#   "status": "revoked"
# }
```

---

## Compliance & Audit Trail

### TRiSM / Agent Safety

- **Transparency**: User can see kill switch button at all times
- **Responsibility**: Reason captured in audit log
- **Immutability**: Audit log via auditLogService (database-backed)
- **Monitoring**: ForensicAuditDashboard shows revocation events

### Audit Schema

```json
{
  "timestamp": "2026-04-30T12:00:00Z",
  "eventType": "agent_kill_switch",
  "agentId": "default-agent",
  "userId": "815b8ce9-b3a7-4ba7-ab99-7393c92b76ca",
  "reason": "Security concern",
  "sessionId": "V7qBUSwXSokgFp4UbiA4xqlaJY3lGm-R",
  "status": "revoked",
  "agentState": { /* snapshot of agent state before revocation */ }
}
```

---

## Files Modified (Phase 159)

### UI Components

| File | Changes |
|------|---------|
| `banking_api_ui/src/components/AdminSideNav.jsx` | Added imports (RedButton, KillSwitchConfirmModal), state (showKillModal, agentRevoked), handler, Safety section, modal |
| `banking_api_ui/src/components/SideNav.js` | Added imports (useCallback, RedButton, KillSwitchConfirmModal), state, handler, Safety section, modal |

### Backend Services

| File | Role |
|------|------|
| `banking_api_server/services/killSwitchService.js` | Revokes agent session + tokens |
| `banking_api_server/middleware/agentRateLimit.js` | Rate limits revoked agent |
| `banking_api_server/services/auditLogService.js` | Logs revocation event |
| `banking_api_server/routes/admin.js` | Exposes POST /api/admin/agent/:agentId/kill-switch |

### UI Components (Pre-Phase-159, Used by Kill Switch)

| File | Role |
|------|------|
| `banking_api_ui/src/components/RedButton.jsx` | Red circular button (40 lines) |
| `banking_api_ui/src/components/KillSwitchConfirmModal.jsx` | Confirmation modal (83 lines) |
| `banking_api_ui/src/components/ForensicAuditDashboard.jsx` | Audit trail viewer (shows kill events) |
| `banking_api_ui/src/components/Admin.jsx` | Uses red button in safety tab |

---

## State Persistence

### Current Session

- `agentRevoked` state **resets on page refresh**
- Backend session stores actual revoked status
- **On next page load**: Check `/api/admin/agent/status` to get current state (optional enhancement)

### Across Tabs

- Each tab has independent `agentRevoked` state
- **Issue**: One tab kills agent, other tab shows button still active
- **Future**: Could use `localStorage` or broadcast channel to sync across tabs

---

## Limitations & Future Enhancements

### Current Limitations

1. **No persistent UI state** — Refresh page loses button state (but backend knows agent is revoked)
2. **Single agent only** — Currently `default-agent`, future versions could support multiple agents
3. **No revocation restoration** — Once killed, agent stays revoked until admin resets
4. **No time-based auto-recovery** — Requires manual intervention to re-enable

### Potential Enhancements

- [ ] Cross-tab state sync via `localStorage` or broadcast channel
- [ ] Admin ability to "unkill" agent in security settings
- [ ] Multi-agent support (revoke specific agents by ID)
- [ ] Time-based auto-recovery (kill switch expires after N hours)
- [ ] Additional metrics (kill count, most common reasons, patterns)
- [ ] Slack/email notification on kill switch event
- [ ] Token revocation endpoint validation
- [ ] Device fingerprinting before allowing kill switch

---

## Security Considerations

### Attack Surface

| Concern | Mitigation |
|---------|-----------|
| CSRF (cross-site request forgery) | Session cookie + SameSite=Strict (BFF) |
| XSS (injected reason field) | Input sanitization in modal + backend validation |
| Replay attacks | POST (not GET), session token required, CSRF token if configured |
| Unauthorized kill switch | /api/admin/agent/:id/kill-switch requires auth + user=session user |

### Permissions

- **Frontend**: No role check (both admin + customer can kill)
- **Backend**: Session authentication required; no additional role check
- **Design intent**: Allow users to self-revoke agent on their own account

---

## Example: Complete Kill Switch Flow

```
=== SCENARIO ===
Admin on /admin dashboard notices unusual agent behavior

Step 1: Admin sees 🛑 Safety section in AdminSideNav (collapsed by default)
Step 2: Admin clicks Safety section chevron → expands
Step 3: Admin sees red "🛑 STOP AGENT" button
Step 4: Admin clicks button
Step 5: Modal pops up: "🛑 Agent Kill Switch — Are you sure?"
        Reason dropdown shows "Security concern" (default)
Step 6: Admin satisfied with "Security concern", clicks "STOP AGENT"
Step 7: Frontend POSTs to /api/admin/agent/default-agent/kill-switch
        with body { reason: "Security concern" }
Step 8: Backend receives request, validates session auth
Step 9: killSwitchService revokes agent session + invalidates tokens
Step 10: auditLogService logs event with timestamp, user ID, reason, state snapshot
Step 11: Backend responds 200 OK
Step 12: Modal closes, state updates:
         - agentRevoked = true
         - Red button becomes gray
         - Shows "🔒 AGENT REVOKED"
         - Button disabled
Step 13: Admin can navigate to ForensicAuditDashboard to see revocation event
Step 14: Agent attempts to execute MCP tool → gets 401 Unauthorized from /api/agent/execute
Step 15: User tries to activate agent → sees "Agent is revoked" message
```

---

## Summary

The **Red Button** is an **emergency safety mechanism** that:

✅ **Appears everywhere**: Admin & user sidebars on all dashboard pages
✅ **One-click revocation**: Click button → confirm reason → agent dead
✅ **Immutable audit trail**: Every kill logged with reason + timestamp + state snapshot
✅ **TRiSM compliant**: Transparency, responsibility, immutability
✅ **Low barrier to use**: Both admins and customers can activate
✅ **No recovery hacks**: Agent stays revoked until admin manually resets

**Phase 159** completes the **Agent Emergency Control** feature, providing a clear, accessible, high-visibility mechanism for users to immediately stop an AI agent in their BX Finance banking dashboard.
