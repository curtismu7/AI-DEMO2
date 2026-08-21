# PingOne AI Agents Migration Plan

Which of this repo's PingOne app registrations are actually AI agent identities, and how to move them onto PingOne's dedicated **AI Agents** directory feature instead of leaving them as generic OAuth clients.

## Current state

The source of truth for PingOne app registration is [scope-topology.json](../scope-topology.json) (`apps` section, ~22 registrations) plus [demo_api_server/services/pingoneBootstrapService.js](../demo_api_server/services/pingoneBootstrapService.js). Every one of them is provisioned as a plain **`WEB_APP`** or **`WORKER`** OAuth client via the Management API, all hard-coded to `client_secret_basic` auth ([bootstrapPingOne.js:109](../demo_api_server/scripts/bootstrapPingOne.js#L109)). None use PingOne's dedicated **AI Agents** admin surface (`Directory > AI Agents`, requires an Agent IAM Core license) — they're indistinguishable from ordinary service clients today.

The tenant's current AI Agents license/feature availability is unconfirmed — the PingOne MCP connector needs interactive OAuth that wasn't available when this plan was drafted. That's Phase 0 below.

## Classification — which "demo*" apps are actually AI agents

| App (scope-topology `apps` key) | Type today | What it actually is | Migrate to PingOne AI Agent identity? |
|---|---|---|---|
| Super Banking AI Agent | WEB_APP, client_credentials+token_exchange | Root LLM orchestrator identity — the Two-Exchange Step 1 actor for `agentgateway.ping.demo` | **Yes** |
| Investment Advisor / Records / Purchase / Membership / Payroll / Tax Records / Financial Aid / Supplier Contract / Holdings / Passenger Records / Identity Verification Specialist Agent (11 apps) | WEB_APP, client_credentials+token_exchange | A2A specialist sub-agents — each an autonomous actor with one narrow scope, exactly the "one registration per capability" pattern | **Yes** (all 11) |
| Super Banking Agent | WORKER, client_credentials | Name overlaps "AI Agent" but no confirmed live reference found outside scope-topology.json | **Excluded from migration** — left as a plain Worker app (decision made 2026-08-21; revisit if a live reference turns up) |
| Super Banking User App / Admin App | WEB_APP, authorization_code | Human sign-in (passkey/OTP) — a person is present | No — stays a standard OIDC app |
| Super Banking MCP Server / MCP Gateway / MCP Exchanger | WEB_APP, client_credentials/token_exchange | Infrastructure: resource server + gateway + credential-swap hop. They enforce policy, they don't reason. | No — stays Worker/resource-server registration |
| Super Banking Worker | WORKER, client_credentials | Management API + Authorize bootstrap tooling | No |

**12 apps** are in scope for migration: the root AI Agent identity plus the 11 A2A specialists.

## Why this matters

Right now every specialist agent is invisible as an *agent* — an admin looking at PingOne's Applications list sees generic OAuth clients with no owner, no lifecycle flag, no way to bulk-disable "all AI agents" during an incident. Moving them into the AI Agents directory gets, for free: per-agent ownership/audit trail, a dedicated inventory separate from human/infra apps, and a single place to revoke a misbehaving agent (Pattern 4 revocation, `ping-identity-for-ai` skill) without hunting through the Worker/WebApp list.

## Migration plan

### Phase 0 — Prerequisite check (do first, before any tenant change)
- Confirm the target PingOne environment has the Agent IAM Core license / AI Agents feature enabled (`Directory > AI Agents` visible in console). If not licensed, stop here until Sales/admin enables it.

### Phase 1 — Dry-run mapping
- For each of the 12 candidate apps, record current `client_id`, granted scopes, and grant types from scope-topology.json — these must be preserved exactly so the existing RFC 8693 nested-act chains (`servers` section) don't break.

### Phase 2 — Re-register as managed AI Agent identities
- Recreate each app through the AI Agents admin surface instead of the generic Applications API, keeping the same scopes/grant types. Since `client_id` changes when re-created via a different surface, this is a **swap, not an in-place edit** — every `.env` / configStore reference to these 12 client IDs needs updating in the same change.
- Keep `client_secret_basic` for now (matches existing demo pattern). Production guidance is `private_key_jwt` — that's a separate hardening task, out of scope here.

### Phase 3 — Verify
- Re-run the existing token-exchange/A2A flows to confirm nested-act chains and mirrored gateway scopes still resolve after the client_id swap.
- Confirm the 12 agents now appear in `Directory > AI Agents` with correct ownership.

## Excluded / open items

- **Super Banking Agent (WORKER)**: excluded from this migration. If a live reference is found later (e.g. via a PingOne read once the MCP connector is authorized), revisit whether it should join Phase 1/2 or be deleted as dead registration.
