# Sidebar Nav Customization + Saved Demo Configs

Date: 2026-07-19
Status: Approved for planning

## Problem

Sidebar (`AdminSideNav.jsx`) has ~92 paths across 13 sections. For a demo,
presenter wants only the items relevant to that demo visible, and wants to
set this up once per demo and reuse it later without redoing the checklist.
There is no existing concept of a reusable demo/nav preset.

## Goals

- Feature flag gates whether the sidebar respects a per-user hidden-items
  list at all.
- A page (visible to everyone, own nav link, not adminOnly) where a user
  checks which nav items they want visible.
- Named, reusable configs bundling nav visibility + feature flag states.
- Built-in starter configs: **Demo mode**, **Full mode**, **Learning**.
- A user's active nav selection persists per-user (LMDB), so it comes back
  on next login regardless of browser/device.

## Non-goals

- No change to *who* can see adminOnly/customerOnly items (role filtering
  stays as-is; nav customization only removes items, never adds items a
  role wouldn't otherwise see).
- No per-user feature flags. Flags remain global, exactly as today.
- No multi-tenant sharing/permissions on named configs — the shared config
  library is readable/writable by anyone signed in, matching the existing
  feature-flags and vertical-switcher trust model.

## Design

### 1. Feature flag

New `FLAG_REGISTRY` entry (`demo_api_server/routes/featureFlags.js`):

```js
{
  id: 'ff_sidebar_customization',
  name: 'Sidebar Customization',
  category: 'ui',
  description: 'When ON, the sidebar hides items the current user has unchecked on the Demo Config page. When OFF, the full sidebar always shows (today\'s behavior) regardless of any saved selection.',
  impact: 'Changes what nav items render for the signed-in user.',
  type: 'boolean',
  defaultValue: false,
}
```

Follows the existing three-point wiring (K13): registry entry (required),
`configStore.js` `FIELD_DEFS` entry (required), `QuickFlagsPill.js` entry
(optional — skipped, this isn't a pill-worthy flag).

### 2. New page: Demo Config

Route `/demo-config`, component `demo_api_ui/src/components/DemoConfigPage.js`.
Nav link added to `allNavItems` in `AdminSideNav.jsx` with no `adminOnly` /
`customerOnly` — visible to every signed-in user, per explicit instruction.

Contents:

- Checkbox list of every nav item from `allNavItems` (label + section),
  reflecting current per-user visibility state.
- The Demo Config page's own nav entry is excluded from the checkbox list
  (can't hide the page that controls visibility — avoids self-lockout).
- "Save current selection" → updates this user's active state (see §4).
- "Save as new named config" → prompts for a name, snapshots current nav
  selection + current global flag states into the shared library (§3).
- A picker/list of existing named configs (built-ins + custom) with
  "Apply" and "Delete" (delete blocked for the 3 built-ins).

### 3. Named config library (shared, server-side)

Stored in the existing LMDB environment (`services/lmdb/openEnv.js`), new
sub-DB `navConfigs`, one row per config:

```js
{
  id, name, isBuiltin: boolean,
  navItems: ['/path/a', '/path/b', ...],   // visible paths
  flagSnapshot: { ff_knowledge_grounding: true, ... },
  createdAt, updatedAt,
}
```

Seeded on first boot with 3 builtins (`isBuiltin: true`, undeletable).
Built-ins are flag-neutral by design — applying one only changes nav
visibility, never touches global feature flags; only custom user-saved
configs carry a flag snapshot:

- **Full mode** — `navItems` = every path in `allNavItems` (nothing
  hidden), `flagSnapshot` = `{}`.
- **Demo mode** — starter subset (exact items TBD by the user after first
  use — ships with a reasonable default of top-level items per section,
  freely editable/overwritable via "Save current selection" once live),
  `flagSnapshot` = `{}`.
- **Learning** — starter subset oriented at walkthrough/education nav
  items (same caveat — editable after first use), `flagSnapshot` = `{}`.

New routes, `demo_api_server/routes/navConfigs.js`:

- `GET /api/nav-configs` — list all (builtins + custom).
- `POST /api/nav-configs` — create new named config from a snapshot.
- `DELETE /api/nav-configs/:id` — delete a custom one (403 on builtins).

### 4. Per-user active state (LMDB, per-user)

New sub-DB `userNavPrefs`, following the same keying pattern as
`conversationStore.lmdb.js` (`userId` prefix, sourced from `req.user.id` /
`sub` claim — the canonical per-user key already used by
`tokenChainService` and `conversationStore`):

```js
key:   userNavPrefs:${userId}
value: { hiddenPaths: ['/path/x', ...], activeConfigName, updatedAt }
```

New routes, `demo_api_server/routes/userNavConfig.js`:

- `GET /api/user/nav-config` — this user's current hidden-paths list.
- `PUT /api/user/nav-config` — update this user's hidden-paths list
  (used both by manual checkbox edits and by "Apply" below).

### 5. Applying a named config

"Apply" on the Demo Config page does two writes, in this order:

1. `PATCH /api/admin/feature-flags` with the config's `flagSnapshot` —
   existing endpoint, existing global behavior, affects every viewer.
2. `PUT /api/user/nav-config` with the config's `navItems` inverted to
   `hiddenPaths` (everything in `allNavItems` not in `navItems`) — scoped
   to the current user only.

If step 1 fails partway (some flags rejected), apply proceeds to step 2
regardless — nav visibility is independent of flag success, and the flags
UI already surfaces individual failures.

### 6. Nav render filtering

In `AdminSideNav.jsx`, after the existing `customerOnly` role filter
(line 821), add one more filter step, only when
`ff_sidebar_customization` is ON:

```js
navItems = navItems.filter(item => !hiddenPaths.includes(item.path));
```

`hiddenPaths` comes from `GET /api/user/nav-config`, fetched alongside the
existing flags fetch on mount. When the flag is OFF, this filter is
skipped entirely — full nav, ignoring any saved `hiddenPaths` (so turning
the flag back on later restores the user's last selection, it isn't lost).

## Data flow summary

```text
Demo Config page
   |-- checkbox edits --------> PUT /api/user/nav-config (this user, LMDB)
   |-- "save as named config" -> POST /api/nav-configs (shared library, LMDB)
   |-- "apply <name>" ---------> PATCH /api/admin/feature-flags (global)
                            \--> PUT /api/user/nav-config (this user, LMDB)

AdminSideNav.jsx (on mount / flag change)
   |-- GET /api/admin/feature-flags  (existing)
   |-- GET /api/user/nav-config      (new, only if ff_sidebar_customization ON)
   \-- filter allNavItems -> role filter -> hidden-paths filter -> render
```

## Error handling

- `GET /api/user/nav-config` 404/empty for a first-time user → treat as
  `hiddenPaths: []` (full nav), not an error.
- Deleting a builtin config → 403, surfaced as a disabled Delete button
  plus a server-side guard (defense in depth, matches existing patterns
  like `blockInDemoMode`).
- No `req.user` (unauthenticated) → nav customization endpoints 401;
  `AdminSideNav.jsx` simply skips the hidden-paths fetch and shows full
  nav filtered only by role, same as today for anonymous/pre-login state.

## Testing

- Unit: `navConfigs.js` and `userNavConfig.js` routes (CRUD, builtin
  delete-guard, missing-user-pref defaults to empty).
- Unit: `AdminSideNav.jsx` filter logic — flag OFF ignores hiddenPaths;
  flag ON hides listed paths; Demo Config page's own link never hidden.
- Integration: apply a named config → flags PATCH’d globally + this
  user's `hiddenPaths` updated; a second user's nav is unaffected.

## Open questions for implementation (not blocking spec approval)

- Exact starter `navItems` lists for the **Demo mode** and **Learning**
  builtins — left as an editable placeholder, first real content decided
  when the page is live and the user picks what they actually want
  visible for a real demo.
