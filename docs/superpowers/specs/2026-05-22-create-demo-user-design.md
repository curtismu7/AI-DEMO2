# Create Demo User — Design Spec

**Date:** 2026-05-22  
**Status:** Approved  
**Branch:** fix/mcp-403-deny-reason (implement on a new branch)

---

## Overview

A "Create Demo User" feature that lets admins provision fully-configured PingOne demo users without leaving the admin panel. The feature covers: creating the user in PingOne, setting mobile/cell, configuring delegation (`may_act`), optionally pre-enrolling MFA devices, auto-seeding banking data, and navigating to an editable user detail page.

---

## 1. Entry Point

A **"+ Create Demo User"** button is added to the top-right of the existing `Users.js` admin list page. Clicking it opens a slide-over panel from the right. The Users list remains visible and dimmed behind it.

---

## 2. Create Demo User — Slide-Over Panel (`CreateUserPanel.jsx`)

Single-page form (no wizard steps) with four grouped sections. Each required field displays an inline explanation of *why* it is needed, so admins presenting the demo understand what each field does in PingOne.

### Form fields

| Field | Required | Explanation shown to admin |
|---|---|---|
| First name | Yes | PingOne display name |
| Last name | Yes | PingOne display name |
| Email address | Yes | Used as PingOne username and login identifier — must be unique in the environment |
| Mobile / cell number | Yes | Stored on the PingOne user profile; required to enroll SMS OTP as an MFA device |
| Temporary password | Yes | PingOne requires an initial password; user is prompted to change it on first login |
| Enable delegation toggle | No | Sets the `may_act.sub` custom attribute — enables RFC 8693 token exchange for agent delegation demos |
| Delegate target (email search) | Only when toggle on | The PingOne user whose `sub` is set as the delegation principal |
| Enroll email OTP | No (checkbox, default on) | Pre-enrolls email as an MFA device so the user can log in without manual MFA setup |
| Enroll SMS OTP | No (checkbox) | Pre-enrolls phone as an MFA device; requires cell number above |
| Seed demo banking data | No (checkbox, default on) | Creates checking + savings accounts with sample transactions so the user can demo banking features immediately |

### Submit behaviour

- On submit: spinner overlay, form disabled.
- On success: ✅ banner showing user email, PingOne ID, and a **"View profile →"** link to `/users/:userId`. Form clears, ready for the next user.
- On partial failure (steps 2–6 failed but user was created): ⚠️ banner listing which steps succeeded and which failed, so the admin knows what to retry.
- On hard failure (step 1 — PingOne create — failed): ❌ banner with error detail.

---

## 3. Backend — `POST /api/admin/demo-users`

New Express route in `demo_api_server/routes/adminDemoUsers.js`. Mounted under the admin router.

**Auth:** `requireAdmin` middleware. **Not** blocked by the demo-mode guard — this route *is* the demo provisioning tool.

### Sequential steps

1. **Create PingOne user** — `pingoneUserService.createUser(email, firstName, lastName, email, password, population)`
   - Failure here → `400` or `502`, abort.
2. **Set mobile attribute** — `pingoneUserService.updateUserAttributes(pingoneId, { mobilePhone: cell })`
3. **Set `may_act`** (if delegation enabled) — `pingoneUserService.updateUserAttributes(pingoneId, { 'urn:pingidentity:may_act': { sub: targetUserId } })`
4. **Pre-enroll email OTP** (if checked) — new `mfaService.enrollEmailDevice(pingoneId, email)`
5. **Pre-enroll SMS OTP** (if checked) — new `mfaService.enrollSmsDevice(pingoneId, cell)`
6. **Seed demo data** (if checked) — new `dataStore.seedAccountsForUser(pingoneId)` — reads the active vertical from `configStore` and creates two accounts + five transactions using vertical-native terminology (e.g. "Pro Member Account" + "Nike Running Shoes — In-Store" for sporting-goods, not generic banking descriptions). `SEED_PROFILES` in `store.js` is the source of truth for all five verticals.

### Response

```json
// 201 — full success
{ "user": { ... }, "pingoneId": "...", "steps": { "created": true, "mobile": true, "mayAct": true, "emailOtp": true, "smsOtp": false, "banking": true } }

// 207 — partial success (user created, some steps failed)
{ "user": { ... }, "pingoneId": "...", "steps": { "created": true, "mobile": false, "mayAct": false, ... }, "errors": { "mobile": "..." } }
```

Steps 2–6 failures produce a `207` with per-step status — never mask a partial failure as a full success.

---

## 4. New Route — `/users/:userId` (User Detail Page)

New `UserDetailPage.jsx` component registered in `App.js` at path `/users/:userId`. Accessible from:
- The **"View profile →"** link in the Create User success banner
- (Future) row click on the Users list

### Editable sections

| Section | Fields | API call on save |
|---|---|---|
| Basic info | First name, last name, email, mobile | `PUT /api/users/:userId` (existing) |
| Delegation | Toggle + target email search | new `PATCH /api/users/:userId/attributes` (sets `may_act`) |
| Agent restrictions | read / write / none dropdown | `PATCH /api/admin/management/users/:userId/agent-restrictions` (existing) |
| MFA devices | List of enrolled devices (read-only) with Enroll / Remove actions | existing MFA service endpoints |
| Banking accounts | Linked accounts (read-only list) | `GET /api/users/:userId/accounts` (existing or new) |

Each section has its own Save button to avoid a single large PUT overwriting unintended fields.

### New backend endpoint

`PATCH /api/users/:userId/attributes` — updates PingOne custom attributes (`may_act`). Admin-only. Calls `pingoneUserService.updateUserAttributes()`.

---

## 5. Files Changed

### New files

| File | Purpose |
|---|---|
| `demo_api_ui/src/components/CreateUserPanel.jsx` | Slide-over form component |
| `demo_api_ui/src/components/UserDetailPage.jsx` | User detail + edit page |
| `demo_api_server/routes/adminDemoUsers.js` | `POST /api/admin/demo-users` orchestration route |

### Modified files

| File | Change |
|---|---|
| `demo_api_ui/src/components/Users.js` | Add "+ Create Demo User" button; wire `CreateUserPanel`; add row link to `/users/:userId` |
| `demo_api_ui/src/App.js` | Register `/users/:userId` route → `UserDetailPage` |
| `demo_api_server/app.js` (or admin router) | Mount `adminDemoUsers` router at `/api/admin/demo-users` |
| `demo_api_server/services/mfaService.js` | Add `enrollEmailDevice()` and `enrollSmsDevice()` methods |
| `demo_api_server/data/store.js` | Add `seedAccountsForUser(pingoneId)` method |
| `demo_api_server/routes/users.js` | Add `PATCH /api/users/:userId/attributes` endpoint |
| `REGRESSION_PLAN.md` | §4 entry for this feature |

---

## 6. Constraints & Non-Negotiables

- **Token custody:** all PingOne Management API calls happen in the BFF; browser never sees tokens.
- **Emoji rule:** only `⚠️`, `✅`, `❌` permitted in UI text.
- **`configStore.getEffective()`**: all config values (PingOne env ID, region, population ID) read via `configStore`, never `process.env` directly in route handlers.
- **No demo-mode guard** on `POST /api/admin/demo-users` — this is explicitly an admin provisioning tool.
- **207 on partial failure** — never silently drop step errors.
- **Build check:** `cd demo_api_ui && npm run build` must exit 0 after UI changes.

---

## 7. Success Criteria

- Admin can create a new PingOne user with email, cell, name, password from the Users list page without leaving the admin panel.
- After creation, a "View profile" link navigates to the new user's editable detail page.
- `may_act.sub` is correctly set on the PingOne user when delegation is enabled.
- Banking accounts + transactions exist for the new user immediately after creation.
- Partial failures (e.g., MFA enroll fails) surface clearly in the UI without hiding that the user was created.
- `npm run build` exits 0; no regressions in existing admin flows.
