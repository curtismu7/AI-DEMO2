# Admin badge + forced admin login for ops/config pages

Date: 2026-06-12. Status: approved (Approach A).

## Problem

All sidebar pages are now visible to every logged-in user, but ops/config pages
are admin functionality. Customers can't tell which links are admin features,
and clicking one should route them through an admin login rather than silently
showing an admin page (or a broken one).

## Behavior

- Admin-marked nav items render a small `admin` chip (reuses the existing
  `admin-side-nav__badge` chip used by "Latest Report").
- A non-admin clicking an admin-marked link gets a confirm dialog:
  "This is an admin feature. Log in as admin? Your current session will end."
  - Confirm → `POST /api/auth/switch {targetRole:'admin'}` → browser navigates
    to the returned admin login URL with `return_to=<clicked path>` → after
    PingOne admin login, lands on the clicked page.
  - Cancel → stays put (nav click) or goes home (deep link).
- Admins see the chip too (clarity) but navigate normally.
- Deep links to admin-marked routes behave identically via a route wrapper.

## Admin-marked set

- Users & Accounts group: Users, Accounts, Transactions (sidebar entries are
  the admin views). `/accounts` and `/transactions` routes stay role-branched —
  customers keep their own views via dashboard links; only the sidebar click
  prompts.
- System Tools group: Feature Flags, LLM Config, App Configuration, Postman
  Collections, Vault.
- Vertical Ops group: all five ops pages.
- OAuth & Identity: Client Registration, Security Settings (config pages).
- `/admin` dashboard (already admin; switches to the new wrapper for the same
  UX).

Everything else stays open to any logged-in user (Audit Trail, Scope
Audit/Reference, MCP pages, OAuth Debug, Error Audit, monitoring, diagrams,
tests, education).

## Components

1. **`AdminLoginConfirmModal`** (new, demo_api_ui/src/components) — props
   `{targetPath, onCancel}`. Confirm calls `/api/auth/switch`, then sets
   `window.location.href = redirectUrl + '?return_to=' + encodeURIComponent(targetPath)`.
   High-contrast text per modal rules (no muted gray).
2. **`RequireAdminLogin`** (new, demo_api_ui/src/routes) — route wrapper:
   admin renders children; non-admin renders the modal (cancel → navigate
   home). Replaces the bare login ternary on the admin-marked routes and
   replaces `AdminRoute` on `/admin`.
3. **AdminSideNav.jsx** — restore `adminOnly: true` flags on the set above
   with NEW semantics: items are no longer hidden; they get the badge chip,
   and non-admin clicks are intercepted to open the modal. `customerOnly`
   filtering is unchanged. Auto-expand index map unchanged (nothing is hidden
   for either role, so indices stay as they are today).
4. **BFF `routes/oauth.js`** — admin login gains the same return-path support
   the user login has: `GET /api/auth/oauth/login?return_to=<path>` stashes a
   sanitized path in `req.session.postLoginReturnToPath`; the callback
   redirects there instead of always `/admin`. Reuses
   `sanitizePostLoginReturnPath` from `routes/oauthUser.js` (exported).

## Limits / notes

- The sanitizer rejects query strings, so `/configure?tab=feature-flags`
  returns to `/configure` after login. Acceptable.
- Switching to admin ends the customer session (existing `/api/auth/switch`
  semantics) — the dialog says so.
- `AdminRoute` (toast + redirect home) remains for any future hard-gated
  pages; only `/admin` migrates in this change.
