# Agent Builder Page — Design

**Date:** 2026-06-12
**Status:** Approved (brainstorming complete)
**Scope:** Phase 1 builds a self-service page; Phase 2 (token-chain wiring) is documented here as a follow-on plan only.

## Goal

A single page where **any logged-in user** can see the four pillars of the agentic identity model — themselves, their AI agent (a PingOne OIDC application), the demo's resources, and scopes — and, with one click, actually **build their own AI Agent in PingOne** and grant it resource scopes. No PingOne admin access required by the user.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What gets created | A **per-user** PingOne application of the first-class **AI_AGENT** type (Ping's agentic-identity feature), named after the user |
| Resources & scopes | **Grant from existing** resource servers defined in `scope-topology.json` (read / write / admin), **plus** users may create their own resource servers with custom scopes. User-created resources live only in PingOne (tagged as builder-created); `scope-topology.json` stays the single source of truth for the demo's own services and is never modified by this page |
| Runtime use | **Visualize only** in Phase 1 — the demo's RFC 8693 chain keeps using the shared agent client. Phase 2 (wiring the user's agent into the chain) is planned below but not built |
| Approach | New self-contained page + thin BFF routes reusing the existing provisioning plumbing (worker token, Management API helpers) |

## Phase 1 — what we build

### UI: `AgentBuilderPage` at `/agent-builder`

Open to any logged-in user. Added to the existing nav arrays only (the AdminSideNav's appearance — icons, CSS, layout, `renderIcon` — is frozen; we only add a nav item). One screen, four zones top to bottom:

1. **Identity chain strip** — horizontal visual `You (user) → Your AI Agent (OIDC app) → Resources & scopes`. Each node renders "lit" once the corresponding thing exists, so the page doubles as a live diagram of the model.
2. **You** — the current user from the BFF session: name, email, `sub`. Read-only; no new auth work.
3. **Your AI Agent** —
   - No agent yet: a single **"Build my Agent"** button. Creates a PingOne AI_AGENT application named deterministically `AI Agent - <username>`, token auth `client_secret_post` (per Ping docs — not basic). When falling back to a standard OIDC app, the app is created as `WEB_APP` with `authorization_code` (placeholder redirect URI) — NOT `WORKER`, because PingOne forbids resource-scope grants on WORKER apps (and `client_credentials` is WORKER-only), which would kill the page's "Apply grants" teaching moment. The token-exchange grant is deliberately deferred to Phase 2. Spinner while creating; result rendered in place.
   - Agent exists (lookup by deterministic name — fully idempotent across visits and double-clicks): show client ID, app-type badge (AI_AGENT), grant types, token auth method, created date.
   - **Delete & rebuild**: a "Delete agent" action (confirm dialog) removes the user's agent from PingOne and returns the zone to the "Build my Agent" state. Deletion is guarded: the BFF only deletes an app that matches BOTH the deterministic name for the *current* user AND the builder-created description marker — topology/provisioned apps can never be deleted from this page.
   - Inline educational copy explaining what an agent identity is (this is a teaching demo; identifiers are intentionally visible).
4. **Resources & scopes** — two subsections, both with checkboxes reflecting what is currently granted to *this user's* agent and a single **"Apply grants"** button (disabled until the agent exists):
   - **Demo resources** — the demo's resource servers and their plain `read` / `write` / `admin` scopes, read from `scope-topology.json` via the existing `scopeTopology` service.
   - **Your resources** — resource servers this user created from the page, read live from PingOne (matched by the builder-created marker + the user's `sub`). An inline **"Create resource"** form takes a resource name, audience (defaulted from the name), and a list of scope names (defaults `read`, `write`, `admin`; custom names allowed). A "Delete" action per user-created resource removes it (and its grants) with the same ownership guard as agent deletion.

### BFF: `routes/agentBuilder.js` + `services/agentBuilderService.js`

| Endpoint | Behavior |
| --- | --- |
| `GET /api/agent-builder/state` | `{ user, agent \| null, resources: [{ name, scopes, granted, ownedByUser }] }` — one call hydrates the whole page; `resources` merges topology resources with the user's own |
| `POST /api/agent-builder/agent` | Create the current user's AI_AGENT app. Idempotent: if the deterministically-named app already exists, return it (200, `created: false`) |
| `DELETE /api/agent-builder/agent` | Delete the current user's agent. Ownership-guarded (deterministic name + builder marker); 404 if none, 403 if the matched app lacks the marker |
| `PUT /api/agent-builder/grants` | Set the agent's resource-scope grants to exactly the submitted set (topology and user-created resources alike) |
| `POST /api/agent-builder/resources` | Create a user-owned resource server + its scopes in PingOne, tagged with the builder marker and the user's `sub`. Idempotent by (user, resource name) |
| `DELETE /api/agent-builder/resources/:id` | Delete a user-owned resource server (and its grants). Same ownership guard; topology resources are never deletable |

- Auth: requires a logged-in BFF session (any user). All Management API calls happen server-side using the existing worker-token acquisition reused from `pingoneProvisionService.js`. The end user never needs PingOne roles.
- `agentBuilderService.js` wraps: find-app-by-name, create/delete AI_AGENT app, create/delete user-owned resource servers + scopes, read/write resource-scope grants. Topology resource/scope listing comes from the `scopeTopology` service — provisioning and this page can never drift apart; user-created resources are read live from PingOne.
- Naming convention `AI Agent - <username>` is the agent idempotency key; user resources use `<username> - <resource name>`. In both cases the PingOne `description` carries a builder marker including the user's `sub` (e.g. `Created by Agent Builder for <sub>`) — this marker is the ownership guard for every delete path and the filter for "Your resources".

### AI_AGENT availability (research item RESOLVED 2026-06-12, REVISED same day)

AI agents are **standard PingOne applications with `type: "AI_AGENT"`** on the `/applications` surface — findable via `filter=type eq "AI_AGENT"` and creatable via `POST /environments/{envId}/applications`. (The initial probe of a guessed `/aiAgents` endpoint 404'd and the bill of materials was misread as "unlicensed" — wrong on both counts; a console-created AI agent in this environment proved the type works, and the live test suite now creates AI_AGENT apps successfully, `fallback: false`.) **Decision: AI_AGENT-first with WEB_APP fallback.** The create flow posts an AI_AGENT application; only if the environment's validation rejects the `type` field does it create a standard OIDC `WEB_APP` instead (grant-capable — WORKER apps cannot hold resource-scope grants). The agent card badges the *actual* type and, when fallen back, shows a note. AI_AGENT apps accept resource-scope grants (verified live via the grant step of the real suite).

### Error handling

- PingOne failures (missing worker role, feature/license unavailable, quota) render as actionable messages inside the agent zone — solid high-contrast text, never muted gray.
- No SSE/streaming needed: each action is 1–3 Management API calls; a per-action spinner suffices.
- Grant application is last-write-wins from the page's checkbox state; the page re-fetches `state` after every mutation so the UI never shows stale grants.

### Testing / done criteria

- Mocked unit tests for `agentBuilderService` (axios mocked): create-when-missing, return-existing, grant set/replace, resource create/delete, delete ownership guard (refuses unmarked apps/resources), PingOne error mapping.
- A `tests/real/` suite for the three routes following the existing real-test helpers (`createBffClient`, `resetSuite`).
- UI build gate: `cd demo_api_ui && npm run build` exits 0.
- Manual verification: a non-admin demo user logs in, builds an agent, creates a custom resource with custom scopes, grants scopes from both demo and own resources, refreshes — page shows the same agent, resources, and grants; the app is visible in the PingOne console as AI_AGENT type. Then deletes the resource and the agent — page returns to the empty state and the objects are gone from PingOne.
- All work in a worktree; explicit `git add <files>`; branch verified before each commit.

## Phase 2 — wiring the user's agent into the token chain (plan only, not built)

Goal: a user's session performs RFC 8693 token exchange with **their own** agent as the actor, instead of the shared demo agent client. This touches the locked token chain, so it ships as its own reviewed phase. Outline:

1. **Token-exchange capability on per-user agents** — created agents need the `urn:ietf:params:oauth:grant-type:token-exchange` grant and resource grants matching what the exchange requests. Decide secret custody: per-agent client secrets stored in the encrypted vault (never in configStore or logs).
2. **`may_act` update** — the user record's `mayAct` attribute must name *their* agent's `client_id` (today it names the shared agent). Use the `${user.mayAct}` user-attribute pattern; the delegation SPEL check (`subjectToken.may_act.sub == actorToken.client_id`) then authorizes the swap naturally.
3. **Per-session actor-client resolution** — the BFF's exchange path (`agentMcpTokenService` and friends) resolves the actor client per session: user's own agent if it exists, shared agent otherwise. Fallback must be seamless — users who never visited Agent Builder see no change.
4. **What stays untouched** — the gateway→MCP-server audience contract (`mcpgateway.ping.demo`) and the gateway's bearer-forwarding behavior do not change; only the actor identity inside the exchanged token differs.
5. **Risks** — exchanger grant misconfiguration (the known Issue-2 401), secret sprawl across many per-user agents, and parity: any change to decision params must be mirrored in the mock authz server (`demo_authz_server`).
6. **Verification** — executable trace showing `act.sub` = the user's own agent client_id end-to-end, plus regression of the shared-agent fallback path.

## Out of scope

- Renaming agents or resources from the page (delete + rebuild covers the need).
- Modifying `scope-topology.json` or any topology-provisioned app/resource from this page.
- Any change to the RFC 8693 chain, may_act rules, or gateway audience in Phase 1.
