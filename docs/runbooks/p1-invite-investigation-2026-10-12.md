# P1 console invites — investigation record (2026-10-12)

**Status: invites NOT sent yet — confirmed via PingOne Management API.** The
onboarding checklist in `privilege-onboarding-email.md` lists the console
invites as Curtis's remaining pre-send step; nobody has done them.

## What was checked

`pingcli pingone api` (client_credentials, already authenticated) against the
Management API:

| Query | Result |
| --- | --- |
| `GET /environments/0428ba4f-…/users?limit=100` | **count 0** — the tenant has no users at all |
| same with `page=1`, and filters `username sw "matthew"`, `email sw "matthewpollicove"` | all 0 — not a paging artifact |
| `GET …/populations` | 4 populations exist; metadata claims `Sample Users`=24, `More Sample Users`=20, `Example`=2 |
| users per population (direct query) | **0 in every one** — the population `userCount` values are stale cache, not real users |

So "there is no invite in P1" is correct, and stronger: there are no users of
any kind in the tenant, invited or otherwise.

## The two-tenant trap (why the console looks empty/confusing)

- **`01d89b06-66d5-430e-9f28-65636843788b` "AI-Demo"** — 66 users, including
  `demoUser`, `demoAdmin`, `demoDelegate`, and the `cmuir+…` accounts. This is
  what the demo sign-in and the welcome wizard provision against. **Not the
  invite target.**
- **`0428ba4f-169c-436b-aff9-b230496e0e3b` "AI Agent"** — the Privilege console
  tenant (SANDBOX). Empty. **This is the invite target.**

Note: pingcli's configured default profile points at `01d89b06` (AI-Demo), so
Management-API calls must pass the `0428ba4f` environment ID explicitly in the
URI (which is what the runbook URLs do).

## API path ruled out (2026-10-12, later)

Management-API invites into the **invite target** `0428ba4f` **do not work
with any current credential** — but that is a cross-tenant scoping limit, not
an API limitation (see bullets):

- The BFF worker client (`e1e33bbe…`, client_credentials on `01d89b06`) can
  **read** `0428ba4f` (users GET → 200) but **cannot write** there
  (POST /users → 403 `ACCESS_FAILED`): its admin rights are scoped to the
  AI-Demo environment. The console-only limitation is true **ONLY for tenant
  `0428ba4f`**.
- Group writes inside the demo tenant `01d89b06` **DO work** via the
  user-centric endpoint — `POST /users/{id}/memberOfGroups` → 201 (verified
  live 2026-10-12). What 403s is the **group-centric** endpoint
  (`/groups/{id}/members`) — that is the probe `pingcli`'s configured client
  (same `e1e33bbe…`) hit.
- Further write-probing with other credential sources was intentionally
  NOT attempted — cross-tenant writes against a tenant we don't hold admin
  on are out of bounds.

**Consequence: the console invite is the only path.** It stays Curtis's
2-minute step (Users → Invite User at
<https://console.pingone.com/?env=0428ba4f-169c-436b-aff9-b230496e0e3b>),
or a new worker app must be granted admin rights inside `0428ba4f` if API
invites are ever wanted (not worth it for two invites).

## What remains (from the onboarding runbook)

1. Invite `matthewpollicove@pingidentity.com` and `cmuir@pingone.com` into
   tenant `0428ba4f` — **console only for `0428ba4f`** (no current credential
   can write cross-tenant; see "API path ruled out" above):
   <https://console.pingone.com/?env=0428ba4f-169c-436b-aff9-b230496e0e3b>
   → Users → **Invite User** (PingOne emails the links).
2. After each accepts: **Grant Roles → PingOne Privilege Administrator**
   (without it the console shows only User view).
3. Verify Privilege identity sync — user must appear in Privilege before any
   Agentic-App policy matches, else first policy hit 403s with
   `user not found in system` (`privilege/LESSONS-LEARNED.md`).
4. Send the email — draft ready in `privilege-onboarding-email.md`.

**Known blocker (documented, do not retry):** adding either recipient as a
GitHub collaborator is blocked — `cmuir_pingcorp` is an Enterprise Managed User
org and the API rejects outside collaborators (422). The email draft already
routes them through Tier 1 / the welcome wizard, which needs no GitHub access.
