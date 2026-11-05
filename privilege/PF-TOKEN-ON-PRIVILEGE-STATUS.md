# PingFederate token on Privilege: status and restart checklist

> **Terminology:** Ping's 2026-11-02 release notes (deck "ID4AI Workforce - H2 2026", slide 35) rename **Non-Human Identity** to **Federated Identity** (display name only; the console API object is still `NonHumanIdentity` at `/v1/nonhumanidentities` in the 2026-10-31 swagger). This page was written under the old name and is kept as measured. Not yet seen on our tenant.


Status as of 2026-10-22 (about 15:00 UTC). Tenant `0428ba4f-169c-436b-aff9-b230496e0e3b`, gateway `mcpgw.ai-demo.ping-devops.com`. No secret values are in this file.

**Bottom line (updated 2026-10-26):** **it works.** A PingFederate-issued token is accepted by the gateway (key `pftoken-agent`) and `tools/list` on the `pftoken` agent app returns 200 with all nine tools. The full working configuration, and every fix it took, is in [`PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md`](PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md), section "Working configuration". The rest of this file is the history up to 2026-10-22.

**Added 2026-10-27:**

- **Passthrough proven** (section 15 of that doc): on the agent app `pftoken-rs`, the MCP resource server's `whoami` returns every claim of the PingFederate token it verified. The gateway forwards the agent's own token.
- **Cedar blocks by token scope** (setup part I): the AI policy `pftoken-scope-search` denies `SearchIndexTool` unless the PingFederate token's scopes contain `opensearch:search`. An API-created AI policy is a candidate (`State: ""`) until set to `Active`.
- **Scope tiers proven** (section 16): grant rules with `RequiredClaims` on `scope` give the same agent 9 tools, 3 tools or 403 on the same agent app.
- **What Privilege does here and what it can't** is a table near the top of that doc and a section on https://ai-demo.ping-devops.com/privilege-pf-token.

## What is proven

| Step | Result | Evidence |
|---|---|---|
| PF mints a client-credentials token for `pf-route-c-test` | Works | `sub` = `pf-route-c-test`, `aud` = the agent app URL, lifetime 3600 s |
| Gateway accepts the PF token as a workload identity | Works | `mcpgw: workload token accepted for key pftoken-agent issuer=https://cmuir-pf.ping-devops.com subject=pf-route-c-test` |
| Gateway refuses the PF token on policy | Happens | `mcpgw: policy denied PFtoken access to pftoken (agent=true)`, then the client gets a bare `403 Forbidden` |
| Garbage bearer is refused at sign-in | Happens | `401 Bearer token required` |
| Audience check passes when the PF audience equals the agent app URL | Works | Token `aud` = agent app URL, accepted (the policy denial is the next step) |

The `pftoken` and `opensearch-hitl` agent apps look the same from outside. Their plain `403 Forbidden` is a policy refusal in the log, not an auth-mode refusal.

## What is NOT proven

- That a PF token can list or call tools on any agent app. No PF test has returned a tool list.
- Whether the console can discover tools on `pftoken` at all. It can't yet.
- Why `pftoken-agent-grant` keeps disappearing (see below).

## Objects and their state

| Object | State now | Notes |
|---|---|---|
| NHI `PFtoken` | Subject `pf-route-c-test`, any-subject off, required claim `client_id` = `pf-route-c-test`, audience = `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp`, scopes `shadowai:write, llm, policy:read, mcp, a2a` | Audience changed 2026-10-22 from `priv-nhi-fa3gvmpkubxvuipp3gyuaolsltbulhkc`. Scopes left as they were: the key `pftoken-agent` depends on this identity. |
| Key `pftoken-agent` | Custodian is NHI `PFtoken`, scope `mcp`, has a workload identity, expires 2026-10-29 | The key the gateway matches the PF token to |
| Key `pftoken-wl` | Custodian is user `AI Agent DemoAdmin` | Not the key the PF token uses |
| App `pftoken` | Auth mode **User Token** (changed 2026-10-22 15:57 UTC, earlier Pass Agent Token). Backend `opensearch-mcp-server:9900`. Discovers **no tools**. | Discovery is the blocker |
| App `opensearch-hitl` | Auth mode User Token. Discovers its tools. | Control: same backend, same mode |
| Grant `SlaveRiver-3869364f3144` | Exists. Rule for app `pftoken` / key `pftoken-wl`: nine HITL tools. Rule for `opensearch-hitl` / `pftoken-wl`: `.*` | Changed by us 2026-10-22 (tools added to the `pftoken` rule). Created in the console. |
| Grant `KarunRiver-5a485737526f` | Exists. App `agent-gateway` / key `pftoken-agent`, no tools | Console-made, untouched |
| Grant `pftoken-agent-grant` | **MISSING**. Created through the API three times, deleted each time | See "Grant deletions" |
| Token manager `routeCTestAtm` | Audience and resource URI = `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp`. Client `pf-route-c-test` is pointed at it. | Was `priv-nhi-…` and the `opensearch-hitl` agent app. Clone of `aiDemoPfJwtAtm`, with a unique key id suffix `-routec`. |
| Shared token manager `aiDemoPfJwtAtm` | Has a `CLIENT_CREDENTIALS` mapping added 2026-10-21 (Option A). It adds `sub` = client id, and also `act`, `Username`, `spiffeId` to client-credentials tokens. | Still present. Not removed. Shared with OBO and A2A. See "Still to clean up". |

## Grant deletions (unexplained)

`pftoken-agent-grant` was created through the Swagger/REST API and removed by the gateway each time:

| Created (CDT) | Deleted (CDT) | Gap |
|---|---|---|
| 10:24 (first attempt) | 10:24:21 | seconds |
| 10:43:40 (with `ObjectMeta.ID` set) | 10:45:06 | about 80 s |
| 10:48:52 | 10:49:03 | about 11 s |

Also `tmp-pf-route-c-grant` was created 09:42 and deleted at 09:43:53 CDT, before we deleted it ourselves.

The gateway log for each deletion says `RDP terminate: policy deleted — policy=<name>`, then `policy has no RDPACCESS action map`. It does not say who or what sent the delete. Nobody on our side ran a delete for these names, and the user confirmed no one should have.

Things we ruled out: the `ObjectMeta.ID` was not the cause (fix did not help). Timing does not match our test runs.

**To find the deleter:** the Activity Logs tab on the `pftoken` app in the console, around the times above. Or the console audit feed. Or ask the other Claude sessions (agents-60 and others) whether they run grant cleanup.

## Why the console can't create the grant

The console's "Create Policy" dialog on `pftoken` says "No Tools, Prompts, or Resources Discovered". Discovery reads the tool list through the app's own auth mode.

- `pftoken` was on Pass Agent Token: an admin discovery call has no agent token, so nothing is discovered. This was the first suspect.
- We switched it to User Token (15:57 UTC). Force-sync ran at 15:57:10 to 15:57:42 UTC, which was the same second as the save, so it may have used the old mode.
- The user pressed Sync after that. Afterwards `McpServerStatus.Capabilities.Tools` is still `[]` and `LastDiscoveredAt` is still `0`.
- `opensearch-hitl`, on the same backend and same User Token mode, lists nine tools.
- The gateway log shows no discovery error for `pftoken`. Next to check: the `pftoken` Activity Logs tab, and whether its Edit dialog matches `opensearch-hitl` (server URL, headers, mesh cluster).

## Feedback from Ping (2026-10-22) to act on

From a Ping engineer, pasted by the user:

- **Subject and End User Claim are the wrong way round for OBO.** For an autonomous agent, the agent id belongs in `sub`. That is what our pinned `pf-route-c-test` setup does. For digital assistants and OBO, the token is `sub` = user and `act.sub` = agent. Privilege should resolve both in logs and policies, and today it doesn't.
- **Audience should belong to the MCP, not the agent.** A fixed generic audience is too coarse. An agent may present a token minted for a specific MCP audience. This is what step 1 and step 2 above implement for the PF test. It should be checked against the OBO docs.

## Commands and files (kept in the session scratchpad, not in git)

Scratchpad: `/private/tmp/claude-502/-Users-cmuir--agents/28437301-59e1-4d0f-ba3b-8dd1d6864039/scratchpad/`

| File | What it does |
|---|---|
| `route-c-test.mjs` | Mints a PF token (client `pf-route-c-test`) and calls the agent app `DOOR` with it. Writes `result.json`. Currently `DOOR` = `pftoken`. |
| `grant-check.mjs` | Read-only: is `pftoken-agent-grant` present. |
| `grant-pftoken-agent.mjs` | Creates `pftoken-agent-grant` (nine HITL tools, key `pftoken-agent`, app `pftoken`). |
| `grant-tmp.mjs` | Creates or deletes `tmp-pf-route-c-grant` on `aggregate-limited`. |
| `pftoken-tools.mjs` | PUTs the nine tools onto the `pftoken` rule in `SlaveRiver-3869364f3144`. |
| `pftoken-aud.mjs` | Sets the PFtoken identity audience. |
| `auth-read.mjs`, `disc3.mjs`, `tools-read.mjs` | Read-only: auth mode, discovered tools. |

Console API: `https://local.procyon.ai:8643/api/0428ba4f-169c-436b-aff9-b230496e0e3b/v1/…` (needs the desktop app running). The PF admin API runs only inside `pingfederate-0` (`kubectl --context us -n ping-devops-curtismuir exec`).

Settings: `~/.claude/settings.json` allow-lists the scratchpad scripts `grant-tmp.mjs`, `route-c-test.mjs` and `pftoken-tools.mjs` by path.

## Checklist: when Privilege fixes discovery

1. Confirm `pftoken` auth mode is User Token: `auth-read.mjs`.
2. Confirm tools are discovered: `disc3.mjs` should list nine tools. If not, stop and check the Activity Logs tab.
3. Create the policy from the console (`pftoken` → Create Policy), key `pftoken-agent`, the nine tools. Do not press Sync after saving.
4. Wait about 90 seconds, then `grant-check.mjs`. It must still be there. If it disappears, find the deleter before doing anything else.
5. Wait about four minutes for propagation, then `route-c-test.mjs`. Expected: `pfToken` 200 with tools. Garbage stays 401.
6. Check the gateway log for `workload token accepted` and no `policy denied` on that request.
7. Only then decide whether the PF path is the demo's story, and update the PF claims doc and the AI Policies demo text.

## Still to clean up (after the test)

- Keep `pf-route-c-test` (client) and `routeCTestAtm` (access-token manager) in PF: they are the permanent demo client and ATM for /privilege-pf-token, renamed "Privilege PF token demo agent" and "Privilege PF token demo access tokens" on 2026-10-28. The ids are unchanged on purpose; renaming an id would break the identity's required `client_id` claim and the demo secret.
- Decide on Option A (`aiDemoPfJwtAtm` CLIENT_CREDENTIALS mapping). It adds `act`, `Username`, `spiffeId` to all client-credentials tokens from that manager. Remove it unless someone needs it.
- Revert `PFtoken` audience to `priv-nhi-fa3gvmpkubxvuipp3gyuaolsltbulhkc` if the per-MCP audience is not adopted.
- Delete the six `cedar-demo-*` Candidate policies (tenant leftovers from the Cedar demo).
- Delete `pftoken-agent-grant` if it is still there after the test (we created it).
- Key `pftoken-agent` expires 2026-10-29. Renew or delete.
- The local `pftoken-agent` key and the `KarunRiver` grant are not ours to remove.

## Related

- [`PF-CLAIMS-IN-CEDAR-POLICIES.md`](PF-CLAIMS-IN-CEDAR-POLICIES.md): the PF claims and Cedar explainer.
- [`WORKLOAD-IDENTITY-AGENT-CALLERS.md`](WORKLOAD-IDENTITY-AGENT-CALLERS.md): the workload identity setup.
- The `privilege-nhi-setup` and `privilege-agent-nhi-lessons` skills: refusal table and the auth-mode trap.
