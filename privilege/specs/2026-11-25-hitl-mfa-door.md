# Spec: `lab-banking-hitl` door for hitl-mfa-lab-LAB real mode

**Date:** 2026-11-25 · **Tier 2** (live SE-cluster Privilege tenant change) · Owner go required before `--apply`.

## What
Create the Privilege objects the HITL MFA lab needs for its real mode, named per `privilege/NAMING-CONVENTION.md`, in tenant `5bfb4e12-8d71-4b81-8ef8-940b91728c05`:

| Object | Name | Kind |
|---|---|---|
| Door (Agentic App) | `lab-banking-hitl` | `applications`, AppType `mcp` |
| Permit policy | `lab-banking-hitl-permit` | `pacpolicys`, tools `["transfer_funds"]`, issued to the key's custodian user |
| Agent key | `lab-banking-hitl-key` | `agentaccesskeys`, scope `["mcp"]`, no `Provider`, custodian `aidemo`, expiry 2027-02-20 |
| Key-bound grant | `lab-banking-hitl-key-grant` | `pacpolicys`, tools `["transfer_funds"]`, `agentaccesskey` attribute |
| Hold policy (AI policy) | `lab-banking-hitl-hold` | `aipolicys`, `forbid mcp:InvokeUnattended` on `transfer_funds`, State **Active**, `@approvers` = group id, transaction grant, ttl 120 / request 300 |

Then repoint the lab: `HMLAB_REAL_URL=https://mcpgw-pingid.ai-demo.ping-devops.com/lab-banking-hitl/mcp`, `HMLAB_REAL_AGENT_KEY=<new key>` (written to the lab `.env` by the script, never printed), `docker compose up -d`.

## Why
The lab's real take 401s: its `.env` key was minted in the retired tenant `ea040334` (worked 2026-11-22, `video/out/real-take.mp4`); the tenant moved to `5bfb4e12` on 2026-11-24 and the old key (and the old door's app object) did not come across. Console check: 34 apps, none serving the `pingid-hitl` path; the only `lab-agent` key is an LLM key (`Provider: anthropic`). The pingid gateways (`agentless-mcpgw-pingid*`) are enrolled to the new tenant, so a door created here is served on `mcpgw-pingid.ai-demo.ping-devops.com`.

## For whom
The HITL MFA lab's real video take (blocked, see the handoff in this thread) and any future HITL-on-banking demo.

## Acceptance criteria
1. Dry run prints the exact create plan (door, permit, key, grant, hold) and no `--apply` writes anything.
2. After apply: door POST 200; key has a `VirtualKey` (saved mode-600 to `~/.config/demo-kit/hitl-banking.env`, never printed); grant exists; hold policy `State: Active` with the approver **group** id (not a user id).
3. Live call: `initialize` through the gateway 200 with the new key; `tools/call transfer_funds` → 403 `pending_approval` with an `ins_…` instruction id (observed in the lab's trace panel).
4. The hold appears under HITL Requests for the approver group; approving + retry with `X-Procyon-Approval-Id` → 200. (Without tenant MFA/PingID, approval is the console click — stage-2 PingID push is a separate owner decision, already recorded in the rebuild guide.)
5. `apply-tag-schema.mjs` reports `orphan 0` after the family edit (`lab-banking-hitl*` → `tag-map-banking`).
6. Lab `npm test` passes; a rehearsal take (`REHEARSE=1 SAMPLE=1`) exits 0.

## Unhappy paths
- **409 duplicate** ("a token cannot select between two keys sharing one identity"): the script skips creates for names that already exist (idempotent), and uses a fresh custodian mapping; `aidemo` currently holds no other MCP key.
- **Propagation lag ~4 min** before the gateway enforces the new door; the live-call check retries for up to 5 minutes before declaring failure.
- **Gateway doesn't route the new door** (404/no `authorization_uri`): the gateway builds routes from tenant objects; if the route is stale the fallback is a gateway re-read (restart the `agentless-mcpgw-pingid` deployment) — owner go needed for that too.
- **PingID push does not fire** (expected today): tenant MFA is OFF on `5bfb4e12`; approval is a console click in HITL Requests. The video's "push on your phone" beat cannot be recorded until the owner finishes the PingID capability step (recorded in SETUP-Privilege-gateway-GUIDE.md "NOT MIGRATED: PingID").
- **Hold policy inactive/blank State**: the gateway shadows instead of enforcing — the script sets `State: Active` and verifies on read-back (lesson from step 20).

## Out of scope
- PingID capability/paired-phone setup on the new tenant (owner, needs a person at the console).
- Renaming or deleting the old-tenant objects (they are gone with `ea040334`).
- Changing the lab's mock side or Story mode.
