# PingOne AI Agents Migration Plan

Which of this repo's PingOne app registrations are actually AI agent identities, and how to move them onto PingOne's dedicated **AI Agents** directory feature instead of leaving them as generic OAuth clients.

## Current state

The source of truth for PingOne app registration is [scope-topology.json](../scope-topology.json) (`apps` section, ~22 registrations) plus [demo_api_server/services/pingoneBootstrapService.js](../demo_api_server/services/pingoneBootstrapService.js). Every one of them is provisioned as a plain **`WEB_APP`** or **`WORKER`** OAuth client via the Management API, all hard-coded to `client_secret_basic` auth ([bootstrapPingOne.js:109](../demo_api_server/scripts/bootstrapPingOne.js#L109)). None use PingOne's dedicated **AI Agents** admin surface (`Directory > AI Agents`, requires an Agent IAM Core license) — they're indistinguishable from ordinary service clients today.

**Update 2026-08-22 — Phase 0 confirmed, Phase 1 complete.** See the results sections below. Live PingOne app names differ from the `scope-topology.json` key names used in the table below (tenant was rebranded "Super Banking" → "Demo AI App" at some point — see `docs/superpowers/plans/2026-08-03-super-banking-to-ai-demo-rename.md`); the table keeps the original `scope-topology.json` keys for continuity with the rest of this doc, with live names given in Phase 1 results.

## Classification — which "demo*" apps are actually AI agents

| App (scope-topology `apps` key) | Type today | What it actually is | Migrate to PingOne AI Agent identity? |
|---|---|---|---|
| Super Banking AI Agent | WEB_APP, client_credentials+token_exchange | Root LLM orchestrator identity — the Two-Exchange Step 1 actor for `agentgateway.ping.demo` | **Yes** |
| Investment Advisor / Records / Purchase / Membership / Payroll / Tax Records / Financial Aid / Supplier Contract / Holdings / Passenger Records / Identity Verification Specialist Agent (11 apps) | WEB_APP, client_credentials+token_exchange | A2A specialist sub-agents — each an autonomous actor with one narrow scope, exactly the "one registration per capability" pattern | **Yes** (all 11) |
| Super Banking Agent | WORKER, client_credentials | Name overlaps "AI Agent" — **live reference now confirmed** (2026-08-22): live PingOne description reads "Worker actor identity for RFC 8693 delegated exchange. The act.sub claim on exchanged tokens." | **Was excluded 2026-08-21; that decision is now stale** — see Excluded / open items below |
| Super Banking User App / Admin App | WEB_APP, authorization_code | Human sign-in (passkey/OTP) — a person is present | No — stays a standard OIDC app |
| Super Banking MCP Server / MCP Gateway / MCP Exchanger | WEB_APP, client_credentials/token_exchange | Infrastructure: resource server + gateway + credential-swap hop. They enforce policy, they don't reason. | No — stays Worker/resource-server registration |
| Super Banking Worker | WORKER, client_credentials | Management API + Authorize bootstrap tooling | No |

**12 apps** are in scope for migration: the root AI Agent identity plus the 11 A2A specialists.

## Why this matters

Right now every specialist agent is invisible as an *agent* — an admin looking at PingOne's Applications list sees generic OAuth clients with no owner, no lifecycle flag, no way to bulk-disable "all AI agents" during an incident. Moving them into the AI Agents directory gets, for free: per-agent ownership/audit trail, a dedicated inventory separate from human/infra apps, and a single place to revoke a misbehaving agent (Pattern 4 revocation, `ping-identity-for-ai` skill) without hunting through the Worker/WebApp list.

## Migration plan

### Phase 0 — Prerequisite check (do first, before any tenant change)
- Confirm the target PingOne environment has the Agent IAM Core license / AI Agents feature enabled (`Directory > AI Agents` visible in console). If not licensed, stop here until Sales/admin enables it.

**Result (2026-08-22): confirmed licensed.** `getEnvironment`'s `billOfMaterials` does NOT list this license as a distinct product — don't use that field to judge AI Agents licensing on this tenant. Confirmed instead by the console (`Directory > AI Agents`) and by `listApplications` filtering `type eq "AI_AGENT"`, which returned 4 existing agents, none related to this migration:

| Name | Enabled | Created |
|---|---|---|
| Agent | No | 2026-06-15 |
| AI Agent - 85abea5b-70a9-4d50-9250-1d5366bfa5d2 | No | 2026-06-26 |
| AI Agent - demoAdmin | Yes | 2026-08-20 |
| MCPGW | Yes | 2026-07-23 |

The first three say "Created by Agent Builder for 85abea5b-..." — PingOne's own Agent Builder feature, unrelated to this repo's provisioning. None collide with the 12 candidates below.

### Phase 1 — Dry-run mapping
- For each of the 12 candidate apps, record current `client_id`, granted scopes, and grant types from scope-topology.json — these must be preserved exactly so the existing RFC 8693 nested-act chains (`servers` section) don't break.

**Result (2026-08-22): captured live, not from the static file.** Live PingOne app names are `Demo AI App - <role>` (see the rename note above), not the `Super Banking ...` names `scope-topology.json` uses as keys. All 12 are `WEB_APP`, grant types `TOKEN_EXCHANGE, CLIENT_CREDENTIALS` (root also has `AUTHORIZATION_CODE`, unused — a placeholder redirect URI only).

| scope-topology key | Live name | client_id | Live resource grants |
|---|---|---|---|
| Super Banking AI Agent | Demo AI App - AI Agent Actor | `71e878ea-2d79-4760-b570-66f00cbeffe7` | 13 |
| Investment Advisor Specialist Agent | Demo AI App - Investment Advisor Agent | `0bba2bb8-896b-42ae-bb56-503d3c75f82e` | 3 |
| Records Specialist Agent | Demo AI App - Records Specialist Agent | `74d7fafe-67be-452c-9d29-0b54ba59eef8` | 3 |
| Purchase Specialist Agent | Demo AI App - Purchase Specialist Agent | `fb66cb43-169f-461d-bf71-7344ad7f37f3` | 3 |
| Membership Specialist Agent | Demo AI App - Membership Specialist Agent | `5a5d730f-864c-46b4-a651-53516a6f709c` | 3 |
| Payroll Specialist Agent | Demo AI App - Payroll Specialist Agent | `9283be7f-0835-4332-9dca-33236307c79e` | 3 |
| Tax Records Specialist Agent | Demo AI App - Tax Records Specialist Agent | `9fb0efa4-bf04-4f18-b442-70c9b32e684c` | 3 |
| Financial Aid Specialist Agent | Demo AI App - Financial Aid Specialist Agent | `a1dc8b3d-df50-4b57-9c4a-4c34095bea5a` | 3 |
| Supplier Contract Specialist Agent | Demo AI App - Supplier Contract Specialist Agent | `f1ed734a-08d5-4a15-bff7-a84852c1cffd` | 3 |
| Holdings Specialist Agent | Demo AI App - Holdings Specialist Agent | `12651b1e-f61d-46aa-9ab9-760da3a761cd` | 3 |
| Passenger Records Specialist Agent | Demo AI App - Passenger Records Specialist Agent | `77c0dc03-c0b6-4e3a-a3f7-470e724ac6c1` | 2 |
| Identity Verification Specialist Agent | Demo AI App - Identity Verification Specialist Agent | `ce2f6632-906b-461a-8377-6d070c762e25` | 2 |

**Important correction to this plan's Phase 1 instruction:** it says to record scopes "from scope-topology.json," but the static file undercounts reality — e.g. it lists a single `invest:read` scope for Investment Advisor, while the live tenant grants it 3 separate resource grants. Phase 2 must snapshot and replicate from `listApplicationGrants` on the live client_ids above, not from `scope-topology.json`'s `grantedScopes` field.

### Phase 2 — Re-register as managed AI Agent identities

**Blocker (verified 2026-08-22): app creation is console-only — it cannot be scripted through the PingOne MCP server.** `createApplication`'s `subtype` enum offers only `oidc_web_app`, `oidc_native`, `oidc_single_page`, `oidc_worker`, `oidc_device_authorization`, `saml`, `template_app` — no AI-Agent option. Passing `type: "AI_AGENT"` explicitly alongside a subtype does **not** work either: it is silently ignored and the app is created as whatever the subtype implies. Verified empirically with a throwaway probe app (`subtype: oidc_worker` + `type: "AI_AGENT"` → came back `"type": "WORKER"`; probe deleted). This is consistent with all 4 pre-existing `AI_AGENT` apps in the tenant carrying "Created by Agent Builder" descriptions — none came from the Applications API.

**Consequence:** each of the 12 apps must be created **by hand** in `Directory > AI Agents` (Name + grant-type picker; the docs confirm the AI Agent type supports Client Credentials and Token Exchange, which is what all 12 need). Everything after creation is still scriptable — copying resource grants, the `.env`/vault client_id + secret swap, and Phase 3 verification.

- Recreate each app through the AI Agents admin surface instead of the generic Applications API, keeping the same scopes/grant types. Since `client_id` changes when re-created via a different surface, this is a **swap, not an in-place edit** — every `.env` / configStore reference to these 12 client IDs needs updating in the same change.
- **Update the secrets vault too, not just `.env`.** Per [docs/vault.md](vault.md), `PINGONE_AI_AGENT_CLIENT_SECRET` is already in the vault's closed migration allowlist (`demo_api_server/scripts/vault-migrate.js` `ALLOWED_ENV_VARS`), and the vault — not `.env` — wins at runtime whenever it holds an entry (resolution order: `process.env` > vault > configStore LMDB). Rotating this secret via re-registration and only updating `.env` leaves the OLD secret live, since the vault entry still shadows it. Use `npm run vault:set PINGONE_AI_AGENT_CLIENT_SECRET` (or `/admin/vault` for no-downtime rotation) for the root agent, and add each specialist's new client secret under its own vault entry if/when they're migrated onto the allowlist.
- Keep `client_secret_basic` for now (matches existing demo pattern). Production guidance is `private_key_jwt` — that's a separate hardening task, out of scope here.

### Phase 3 — Verify
- Re-run the existing token-exchange/A2A flows to confirm nested-act chains and mirrored gateway scopes still resolve after the client_id swap.
- Confirm the 12 agents now appear in `Directory > AI Agents` with correct ownership.

## Excluded / open items

- **Super Banking Agent (WORKER)** — live PingOne name "Demo AI App - Agent Actor", `client_id 4069fee6-34e1-453e-85a4-d1e485f08ebe`: originally excluded 2026-08-21 for lacking a confirmed live reference. **That's now stale** — its live PingOne description reads "Worker actor identity for RFC 8693 delegated exchange. The act.sub claim on exchanged tokens," and `updatedAt` is 2026-07-23, i.e. actively maintained. This needs a human decision, not an automatic inclusion: is this WORKER app the actual `act.sub` minter for the root agent's delegated tokens (in which case it likely belongs in Phase 1/2 too, as a 13th candidate), or is the description leftover copy from an earlier design that the live token flow no longer uses? Check `demo_api_server/services/oauthService.js`'s token-exchange call sites for which client_id actually gets used as the actor before deciding.
