# PingFederate token exchange into Privilege, with Pass Agent Token

Set up, deploy and use the agent-presents-token path: a PingFederate token exchange produces a token that acts for an agent, the agent sends it to a Privilege MCP door, and the door forwards the verified token to the MCP server (Pass Agent Token). Expected configuration follows the recipe from the Ping thread (Federico Carbone and Suman Sharma, 2026-10-23). Status as of 2026-10-26: **working end to end** on gateway `v1.261024` (see "Working configuration" right below). Each claim below is tagged:

- **[measured]**: seen on our tenant or in the gateway log, 2026-10-22.
- **[ping]**: stated by Ping engineers in the thread. Not yet verified on our tenant.
- **[expected]**: our reading of what must be true. Not tested.

Companion docs: `PF-TOKEN-ON-PRIVILEGE-STATUS.md` (where the test stands and the restart checklist) and `PF-CLAIMS-IN-CEDAR-POLICIES.md` (what Cedar can read).

## Use case: federated agents

**Federated agents** are AI agents whose identity already lives in the customer's own identity provider (here PingFederate). The agent presents a token its IdP issued, and Privilege trusts that IdP instead of handing the agent a Privilege-issued static key.

> **Naming.** "Federated Agents" is the new name that is coming for what the Privilege console currently calls **Non-Human Identities** (and the **NHI Agents** page). This guide uses the console's current labels so the steps match the screens; read "Non-Human Identity" as "Federated Agent".

What this covers:

| Covered | How |
|---|---|
| An agent authenticates to a Privilege MCP door with a PingFederate-issued JWT | Non-human identity trusting the PF issuer and JWKS |
| No Privilege secret in the agent | The PF token is the only credential |
| Only one specific agent is accepted | Required claims `act.sub` and `client_id` pin the agent |
| The token is bound to one door | Audience = the door URL |
| What the agent may do on the door | The agent key's grant (tools per door) |
| The MCP server can verify the token itself | Pass Agent Token forwards the verified token (proven with `whoami`, section 15) |

What it does not cover yet:

- **On behalf of a user** (user in `sub`, agent in `act.sub`, via PingFederate token exchange): the identity settings below already fit this shape, but it has not been run end to end. Privilege's OBO support is in staging (Ping, 2026-10-23).
- **Token claims in Cedar policies**: `context.token.claims` is coming in a later release. Today claim checks live in the identity (required claims) and in the Access Policy step of the agent key.
- **Per-MCP audiences on a shared identity**: the audience must contain the gateway; an allow-list of audiences is possible on request.

Example: a customer such as NYLife has agents registered in PingFederate and wants Privilege to govern which MCP tools those agents may call, without issuing each agent a Privilege key.

## Step-by-step setup

Values in angle brackets are yours; the values we used are in brackets. Every step was done on 2026-10-26 and the result is in "Working configuration" below.

### Before you start

1. The Privilege gateway is `privilege-aigw:v1.261024` or later. (Earlier versions cannot discover tools on a Pass Agent Token door.)
2. The MCP door's backend is reachable from **every** gateway pod. (Ours needed a restored Service and two network policies; see section 14.)

### A. PingFederate: make the agent's token

1. **Client.** Create an OAuth client for the agent with the `client_credentials` grant. [`pf-route-c-test`]
2. **Access token manager.** Create a JWT token manager for this agent (clone an existing JWT one; give it a unique Key ID).
   - Audience claim value: the door URL. [`https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp`]
   - Resource URIs: the same door URL.
3. **Access token mapping** for the `CLIENT_CREDENTIALS` context on that token manager:
   - `sub` ← Context: ClientId
   - `client_id` ← Context: ClientId
   - `act` ← Expression: `#{"sub": "<agent id>"}` [`#{"sub": "pf-route-c-test"}`]. It must be an **object**; text `"{}"` will not work.
4. Set the client's default access token manager to the one from step 2.
5. **Check:** mint a token and decode it. You need `iss`, `sub`, `aud` = the door URL, `client_id`, and `act.sub` = the agent id (see "The token that passed").

### B. Privilege: register the federated agent (Non-Human Identity)

Console: **Non-Human Identities → Register Identity** (or **Edit** on an existing one).

1. **Token issuer type:** OIDC Provider.
2. **Issuer (iss):** exactly the token's `iss`. [`https://cmuir-pf.ping-devops.com`]
3. **Key source:** Fetch from URL; **JWKS URL** = the PingFederate JWKS. [`https://cmuir-pf.ping-devops.com/pf/JWKS`]
4. **Subject (sub):** `*`. (The agent is pinned by the required claims in step 7, so the subject can stay open for an end user later.)
5. **End user in a presented token:** Opaque; End-user claim empty (= `sub`). Use Resolved instead if the end user exists in Privilege.
6. **Audience:** the door URL, the same value PingFederate puts in `aud`.
7. **Required claims:** `act.sub` = `<agent id>` and `client_id` = `<client id>`. [both `pf-route-c-test`]
8. **Permissions:** `mcp` (add `llm` or `a2a` only if the agent needs them).
9. Save. If the console refuses with "Spec.UserClaim resolves to "sub" …", the subject is pinned while End user reads `sub`: set Subject to `*` as in step 4.

### C. Privilege: the MCP door

Console: **Agentic Apps → <door> → Edit**.

1. **MCP Server URL:** a backend address that resolves from every gateway pod. [`http://opensearch-mcp-noget.ping-devops-cmuir.svc.cluster.local/mcp`]
2. **Auth Mode:** Pass Agent Token.
3. Save. The Overview shows "Awaiting first agent call - tools will be discovered from a forwarded assertion".

### D. Privilege: the agent key and its tools

Console: **Agent Registry → Add Agent** (or **Edit** an existing key).

1. **Custodian:** the identity from part B. Scope: `mcp`. [key `pftoken-agent`, custodian `PFtoken`]
2. **Gateway & Apps:** select the door from part C.
3. **Configure Tool Access:** MCP Server = the door; Access tier Everyone; select the tools (selecting none grants every tool). Optional: **Add Claim** to require a token claim for this tier.
4. Save Configuration, finish the wizard and save the key. The door's **Agent Registry** tab now lists the key with its grant.

Do **not** create the grant as a separate policy through the API: every such policy was deleted by the gateway within seconds (section 7). Editing the key's own grant works.

### E. First call and test

1. Make one agent call with the PingFederate token (for example `tools/list`). Even if it is refused, it triggers tool discovery; the door's Overview then lists the tools.
2. Call again. Expected: **200** with the tool list. A garbage bearer still gets 401.
3. Check the gateway log (all three pods, `--all-containers`, section 14): `workload token accepted for key <key>` and no `policy denied`.
4. Live demo of exactly this: the **PingFederate Token Demo** page, `https://ai-demo.ping-devops.com/privilege-pf-token`.

## Working configuration (verified 2026-10-26, 18:12 UTC)

A PingFederate-issued token was accepted by the gateway and `tools/list` on `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` returned **HTTP 200 with all nine tools**. A garbage bearer still got 401. Gateway log: `workload token accepted for key pftoken-agent issuer=https://cmuir-pf.ping-devops.com subject=pf-route-c-test`, no policy denial. [measured]

Everything below had to be true at the same time:

| Layer | Setting | Value |
|---|---|---|
| Gateway | image | `privilege-aigw:v1.261024` or later (discovers tools on a Pass Agent Token door from the first agent call) |
| PF token manager `routeCTestAtm` | audience claim and resource URI | `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` |
| PF mapping `client_credentials\|routeCTestAtm` | `sub`, `client_id` | the client id (`pf-route-c-test`) |
| PF mapping `client_credentials\|routeCTestAtm` | `act` | expression `#{"sub": "pf-route-c-test"}` (an object, not the text `"{}"`) |
| NHI `PFtoken` | Issuer / JWKS | `https://cmuir-pf.ping-devops.com` / `https://cmuir-pf.ping-devops.com/pf/JWKS` |
| NHI `PFtoken` | Subject | `*` (Allow any subject was left **unticked** in the saved, working setup; the agent is pinned by the required claims instead) |
| NHI `PFtoken` | Audience | `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` |
| NHI `PFtoken` | Required claims | `client_id` = `pf-route-c-test` and `act.sub` = `pf-route-c-test` |
| NHI `PFtoken` | End user | Opaque — record the end user, never look them up; End-user claim left empty (= `sub`) |
| Agent key `pftoken-agent` | custodian / scope | NHI `PFtoken` / `mcp` |
| Door `pftoken` | Auth Mode / backend | Pass Agent Token / `http://opensearch-mcp-noget.ping-devops-cmuir.svc.cluster.local/mcp` |
| Grant | policy | the key's own console-made grant `KarunRiver-5a485737526f`, with a rule added for app `pftoken`, key `pftoken-agent`, the nine tools |
| Cluster | Service and policies | Service `opensearch-mcp-server` (9900) in `ping-devops-cmuir`; network policies `opensearch-mcp-noget-from-gateways` (cmuir) and `gateways-to-opensearch-mcp-noget` (curtismuir) |

The token that passed (claims only):

```json
{
  "iss": "https://cmuir-pf.ping-devops.com",
  "sub": "pf-route-c-test",
  "aud": "https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp",
  "client_id": "pf-route-c-test",
  "act": { "sub": "pf-route-c-test" },
  "scope": "openid"
}
```

### Screenshots of the working setup (2026-10-26)

Taken with Playwright from the local console after the passing test. Dialogs were opened and cancelled; nothing was saved.

**1. Identity `PFtoken`: issuer, subject `*`, JWKS, End user = Opaque.**

![PFtoken edit, top](images/pf-token-exchange/working/02-nhi-pftoken-edit-top.png)

**2. Identity `PFtoken`: End-user claim empty (uses `sub`), audience = the door URL.**

![PFtoken edit, end user and audience](images/pf-token-exchange/working/03-nhi-pftoken-edit-end-user.png)

**3. Identity `PFtoken`: required claims `act.sub` and `client_id` = `pf-route-c-test`.**

![PFtoken edit, required claims](images/pf-token-exchange/working/04-nhi-pftoken-edit-claims.png)

**4. Door `pftoken`: Pass Agent Token, noget backend, nine tools discovered.**

![pftoken overview with nine tools](images/pf-token-exchange/working/05-door-pftoken-overview.png)

**5. Door `pftoken`, Agent Registry tab: `pftoken-agent` via `KarunRiver-5a485737526f` (the grant that made it work), next to `pftoken-wl`.**

![pftoken agent registry tab](images/pf-token-exchange/working/06-door-pftoken-agent-registry.png)

**6. Door `pftoken`, Edit: Auth Mode = Pass Agent Token, MCP Server URL = the noget front.**

![pftoken edit dialog](images/pf-token-exchange/working/09-door-pftoken-edit-auth-mode.png)

### What broke along the way, and the fix

| Symptom (client) | Gateway log | Cause | Fix |
|---|---|---|---|
| 401 Unauthorized | `workload token rejected: required claim "act.sub" does not match` | the NHI required `act.sub` = `aud` (a typo), and the token's `act` was the text `"{}"` | set the required claim to the agent id; make PF emit `act` as an object |
| 401 Unauthorized | no `workload token` line in the first read of the log | same cause as the `act.sub` row above; a later request logged `required claim "act.sub" does not match`. (We first blamed Subject `*` with Allow any subject off; that was wrong: the working setup has exactly that.) | fix the required claim; always read the log line that names the claim |
| console error on save: "Spec.UserClaim resolves to \"sub\" … every caller reads as the same end user" | — | End user Opaque on `sub` while Subject pins `sub` to one value | widen Subject to `*` + Allow any subject, and pin the agent with a required claim instead |
| 403 Forbidden | `policy denied PFtoken access to pftoken (agent=true)` | no grant for the key on the door | add a rule to the key's existing grant (below) |
| tools stay empty | `tool discovery for pftoken failed: … no such host` | backend Service deleted | restore the Service; point the door at the noget front |
| 504 / timeouts to the backend | noget log: `upstream timed out` | noget nginx forwards to the deleted Service | restore Service `opensearch-mcp-server`, restart noget |
| 404 Not found from a new door | `rejecting /mcp on app pftoken-rs: outside entry path "/mc"` | the door's MCP Server URL was saved ending in `/mc`; the gateway splits the URL path off as the door's entry path | edit the door: the URL must end in exactly `/mcp` |
| timeouts from some gateway pods only | — | network policy `ai-demo-internal` blocks the curtismuir gateway pods | add the two narrow policies above |

### How the grant must be made

- **Works:** add a rule to the key's **existing** grant policy (the one the console created for the key, here `KarunRiver-5a485737526f`), through the console's tool-access screen for the key or a `PUT` of that policy. It survived 90 s and the gateway honoured it.
- **Does not work:** `POST` a **new** separate grant policy for the key. Every one (`pftoken-agent-grant` x4, `tmp-pf-route-c-grant`) was deleted by the gateway within 11 to 80 seconds (`RDP terminate: policy deleted`). The cause is still not known; avoid this route.

## 1. What the agent presents

The token must have the user in `sub` and the agent in `act.sub`. This is the shape from the Ping thread [ping]:

```json
{
  "sub": "<user id, e.g. fcarbone>",
  "aud": "<gateway audience, see section 4>",
  "act": { "sub": "pf-route-c-test" },
  "client_id": "pf-route-c-test",
  "scope": "mcp"
}
```

Our route C token is different [measured 2026-10-22]: a client-credentials token with `sub` = `pf-route-c-test`, `client_id` = `pf-route-c-test`, and **no user and no `act`**. That is the autonomous-agent shape. It will not satisfy the recipe in section 3.

## 2. The door: `pftoken`

| Setting | Required value | Status |
|---|---|---|
| Auth Mode | **Pass Agent Token** (`token-pass`) | **Pass Agent Token, saved 2026-10-26** [measured, console] |
| MCP Server URL | `http://opensearch-mcp-noget.ping-devops-cmuir.svc.cluster.local/mcp` | Changed 2026-10-26. The old `opensearch-mcp-server…:9900` Service no longer exists; see section 14 [measured] |
| Mesh cluster | `ai-demo-cmuir` | [measured] |
| Tools | the nine HITL tools (below) | [measured]: discovery shows none under User Token, and the console can't discover under Pass Agent Token. See section 6. |

The nine tools: `ListIndexTool`, `SearchIndexTool`, `ClusterHealthTool`, `CountTool`, `MsearchTool`, `ExplainTool`, `IndexMappingTool`, `GetShardsTool`, `GenericOpenSearchApiTool`.

Pass Agent Token forwards the agent's verified token to the backend. The backend must accept it. [expected] The `opensearch-mcp-server` does not check PF tokens today; the call is refused before it reaches the backend.

## 3. The identity: NHI `PFtoken` (Suman's recipe)

Suman's configuration [ping], with our names filled in:

| Field | Value | Why |
|---|---|---|
| Issuer | `https://cmuir-pf.ping-devops.com` | the PF that signs the token [measured] |
| JWKS URI | `https://cmuir-pf.ping-devops.com/pf/JWKS` | [measured] |
| Subject | `*`, Allow any subject **on** | the user is in `sub`; a pinned subject would be the agent |
| Audience | the gateway audience, see section 4 | RFC 7519: the gateway must be in `aud` |
| Required claim | `act.sub` = `pf-route-c-test` | accept only tokens acting for this agent |
| UserClaim | `sub` | the user comes from `sub` |
| SubjectBinding | `resolved`, or `opaque` if the user is not in Privilege | shows the user in the audit log |
| Scopes | `mcp` only | least privilege |
| Max lifetime | 7200 s | [expected] |

Our current `PFtoken` values [measured 2026-10-22]:

| Field | Current |
|---|---|
| Subject | `pf-route-c-test`, any-subject off |
| Required claim | `client_id` = `pf-route-c-test` |
| Audience | `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` |
| Scopes | `shadowai:write, llm, policy:read, mcp, a2a` |
| SubjectBinding | empty |
| UserClaim | empty |

Changing these from the pinned-agent shape to the table above is a change to a live identity. Key `pftoken-agent` depends on it.

## 4. Audience

- Suman [ping]: the gateway must be in `aud`, and the audience cannot be a wildcard. A per-MCP audience is not supported today. The intended route is OBO, which is in staging and due in the release at the end of next week.
- Suman offered an allow-list of audiences as a possible change. Not built.
- Our current test uses the door URL as the audience [measured], which is per-MCP. The gateway accepted the token on that audience. So an exact-match door URL works. Whether a per-MCP audience is allowed in production is open.

## 5. The grant

- Key `pftoken-agent` on app `pftoken`, tools = the nine tools. Create it in the console (Create Policy on the `pftoken` page). [measured] Entities on that page: the policy is attached to the custodian user, and `pftoken-agent`'s custodian is the NHI `PFtoken`, not a user. Whether the console lists NHI-custodied keys is unknown.
- Do not create it through the API. [measured] Every API-created copy was deleted by the gateway within 11 to 80 seconds. Cause unknown; see section 7.
- Do not press Sync after saving. [measured]: it did not populate the tools list, and it may reconcile policies.

## 6. Why Pass Agent Token blocks the console

- The console's "Create Policy" dialog needs discovered tools. [measured]: "No Tools, Prompts, or Resources Discovered".
- Discovery is an admin call with no agent token. Under Pass Agent Token it has nothing to forward, so it finds no tools. [expected]
- Under User Token discovery did not populate either, even after Sync. [measured] `opensearch-hitl` on the same backend and User Token does discover all nine. So `pftoken`'s own settings differ somewhere. The Activity Logs tab on `pftoken` should show the error.

**Open:** can Privilege discover tools on a Pass Agent Token door at all? If not, the grant must come from another route. Ask Privilege.

## 7. Grant deletions (unexplained)

`pftoken-agent-grant` was created through the API three times and deleted by the gateway each time [measured]:

| Created (CDT) | Deleted (CDT) |
|---|---|
| 10:24 | 10:24:21 |
| 10:43:40 (with `ObjectMeta.ID`) | 10:45:06 |
| 10:48:52 | 10:49:03 |

The log says `RDP terminate: policy deleted — policy=pftoken-agent-grant`. No requester is recorded. The `ObjectMeta.ID` made no difference. Check the Activity Logs tab on `pftoken`, and ask other sessions whether they run grant cleanup.

## 8. Deploy and use

Deploy here means the console configuration above. There is no image or container to ship.

1. **Door:** set `pftoken` to Pass Agent Token. Save. (Console, Edit.)
2. **Identity:** set NHI `PFtoken` to section 3. Read back.
3. **PF token exchange:** the exchange already exists on the shared token manager `aiDemoPfJwtAtm` [measured 2026-10-25]: token-exchange mappings `aiDemoStandardTePolicy`, `aiDemoPfStep9TePolicy` and `aiDemoSpiffeTePolicy` set `sub` = the subject token's subject, `act` = `{sub: spiffeId, act: priorAct}`, and `client_id`. It was built for the OBO demo. What is not tested is whether an exchange for our agent yields `act.sub` = `pf-route-c-test`, and with the audience in section 4. Next step: run one exchange with a user subject token and read the claims.
4. **Discovery:** make one agent call with the token (step 7 works for this even before the grant exists; it is refused on policy but triggers discovery). Then confirm the nine tools on `pftoken` (Overview tab). Needs gateway v1.261024 or later and a backend URL that resolves (section 14).
5. **Grant:** create the policy for `pftoken-agent` with the nine tools. Save. Do not sync.
6. **Check persistence:** the grant must still exist 90 seconds later. If not, stop and find the deleter.
7. **Use:** the agent calls `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` with the exchanged token as the bearer, and calls `tools/list` then one tool.

## 9. Test

Expected results when everything is in place:

| Call | Expected |
|---|---|
| exchanged token, `tools/list` | 200 with the nine tools |
| exchanged token, tool call | 200 (a `SearchIndexTool` call is HELD by the HITL rule until approved) |
| garbage bearer | 401 `Bearer token required` |
| exchanged token with no `act.sub` | refused at the NHI required claim, not on policy |
| a client-credentials token (route C shape) | refused at the NHI required claim (`act.sub` missing) |

The gateway log should show, in order: `workload token accepted for key pftoken-agent`, then no `policy denied`. Refusals show as `policy denied PFtoken access to pftoken` (policy) or `auth rejected` (sign-in).

Our current test [measured 2026-10-22] reached the policy step and was refused, because the grant is missing.

## 10. Open questions

1. ~~Can Privilege discover tools on a Pass Agent Token door?~~ **Answered (gateway v1.261024):** yes, from the first accepted agent call. It needs a backend URL that resolves (section 14).
2. Does the console list NHI-custodied keys in Create Policy? (blocks step 5)
3. What deletes `pftoken-agent-grant`? (blocks step 6)
4. Is a per-MCP audience acceptable in production, or must it be the gateway? (Suman says gateway)
5. Does PF issue the exchanged token with `act.sub` and `sub` as section 1 needs? (exchange exists for OBO; the claims for our agent are untested)
6. When does `context.token.claims["act.sub"]` reach Cedar? (Suman: next release)

## 11. Ping thread, summarized

- Federico (2026-10-23): the agent's token has user in `sub` and agent in `act.sub`; Privilege expects the agent id in `sub`. The attributes are inverted for OBO. Audience should live with the MCP, not the agent. The logs and policies should resolve both attributes.
- Suman (2026-10-23): the subject config is the issue. Use Subject `*` (or AllowAnySubject), `RequiredClaims["act.sub"]` = the agent, `UserClaim` = `sub`, `SubjectBinding` = `resolved` (or `opaque`). The audience must include the gateway; OBO is the intended route. Cedar `context.token.claims` checks are coming in the next release.

## 12. Test results, 2026-10-25

What was checked, and what could not be checked.

| Check | Result | Tag |
|---|---|---|
| Shared manager `aiDemoPfJwtAtm`: Option A `CLIENT_CREDENTIALS` mapping (`sub` = client id, plus `act`, `Username`, `spiffeId`) | **Gone.** Removed. The cleanup item is done. | [measured] |
| Shared manager: token-exchange mappings | Present. Fill `sub`, `act`, `client_id`, `scope`, `spiffeId`. Built for the OBO demo. | [measured] |
| Client `pf-route-c-test` | Still exists (PF admin API returns 200). Cleanup item still open. | [measured] |
| Token manager `routeCTestAtm` | Exists. Audience and resource URI = the `pftoken` door URL. | [measured] |
| Privilege console (`local.procyon.ai:8643`) | **Down** at 2026-10-25, even after reopening PingOne Privilege. Cannot read or change Privilege. Auth mode, grants and tool discovery were not re-read. | [measured] |
| Demo page `https://ai-demo.ping-devops.com/privilege-ai-policies`, hold scenario | **Not run.** The browser extension was not connected, so the page could not be opened from here. | not tested |
| Demo user's access to `opensearch-hitl` | **Not settled.** `opensearch-hitl` is on User Token, which should remove the 403 that the demo user saw, but nobody has run it. | not tested |
| `pftoken` auth mode | **User Token** (saved). The Pass Agent Token seen in a 2026-10-25 dialog was not saved. The target for this guide is Pass Agent Token; switching back is still to do. | [measured, console screenshot] |
| `pftoken` tool discovery | Overview says "Awaiting first user credential - tools will be discovered on first sign-in". Under User Token, discovery waits for a person to sign in to the door once. Nobody has, so Tools is empty. | [measured, console screenshot] |
| `pftoken` Activity Logs, 2026-10-18 to 2026-10-25 | **No data.** The grant deletions are not recorded on this tab. | [measured, console screenshot] |
| `pftoken` Agent Registry tab | One access config: key `pftoken-wl`, policy `SlaveRiver-3869364f3144`, expires 2026-11-21. `pftoken-agent` has no access config on this door. | [measured, console screenshot] |

Still to run: the demo page's hold scenario in a signed-in browser.

## 13. Console walkthrough (screenshots, 2026-10-25)

Taken with Playwright against the local console (`https://local.procyon.ai:8643`, signed in as the tenant admin). Dialogs were opened and cancelled; nothing was saved.

### Non-Human Identities list

![Non-Human Identities list](images/pf-token-exchange/03-nhi-list.png)

`PFtoken` is an OIDC Provider identity with subject `pf-route-c-test`. End user shows "not resolved". Scopes: `shadowai:write`, `llm`, `policy:read`, `mcp`, `a2a`.

### Edit PFtoken: identity, keys, permissions, end user

![Edit PFtoken, upper half](images/pf-token-exchange/11-nhi-pftoken-edit.png)

Where Suman's recipe goes in this screen:

| Recipe field | Console control | Current | Recipe |
|---|---|---|---|
| Subject | Subject (sub) | `pf-route-c-test` | `*`, with Allow any subject on (lower half) |
| UserClaim + SubjectBinding | End user → "End user in a presented token" | None — the identity is the only principal | Resolved (or Opaque if the user is not in Privilege), claim `sub` |
| Scopes | Permissions | all five ticked | `mcp` only |
| JWKS | Key source → Fetch from URL | `https://cmuir-pf.ping-devops.com/pf/JWKS` | unchanged |

The console note under End user: "Only Resolved enables per-user model rules on an access key that names this identity as custodian."

### Edit PFtoken: subject, audience, required claims

![Edit PFtoken, lower half](images/pf-token-exchange/12-nhi-pftoken-edit-lower.png)

| Recipe field | Console control | Current | Recipe |
|---|---|---|---|
| Allow any subject | checkbox | off | on |
| Audience | Audience | `https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp` | the gateway audience (section 4) |
| Required claims | Required claims | `client_id` = `pf-route-c-test` | `act.sub` = `pf-route-c-test` |
| Max token lifetime | Max token lifetime (seconds) | 0 (controller default, 3600) | 7200 |

The page header says the audience cannot be changed in the console ("every deployed workload is bound to them"). We changed it through the API on 2026-10-22 and the gateway honoured it. Treat a console-side audience change as "register a new identity".

### The `pftoken` door: Overview

![pftoken Overview](images/pf-token-exchange/20-app-pftoken-overview.png)

Auth Mode is User Token. Tools, Prompts and Resources are empty, with the banner "Awaiting first user credential - tools will be discovered on first sign-in".

### The `pftoken` door: Edit (Auth Mode)

![pftoken Edit dialog](images/pf-token-exchange/24-app-pftoken-edit.png)

For this guide, set Auth Mode to **Pass Agent Token** and Save. Under User Token, the console says the token "will be sourced automatically from the user's vault credential at request time".

### The `pftoken` door: Access Summary and Agent Registry

![pftoken Access Summary](images/pf-token-exchange/21-app-pftoken-access-summary.png)

![pftoken Agent Registry tab](images/pf-token-exchange/23-app-pftoken-agent-registry.png)

The door has one entity (AI Agent DemoAdmin) and one policy (`SlaveRiver-3869364f3144`), which is the access config for key `pftoken-wl`. The key the PF token actually maps to, `pftoken-agent`, has no access config here. That is the missing grant.

## 14. Gateway v1.261024 (2026-10-26): what changed, and how to troubleshoot

The gateway was updated to `privilege-aigw:v1.261024`. With it, a Pass Agent Token door **discovers its tools from the first agent call** instead of needing a person to sign in.

### What the console shows

Before the first agent call, on Pass Agent Token:

![pftoken on Pass Agent Token, awaiting first agent call](images/pf-token-exchange/31-pftoken-overview-passagent.png)

The banner reads "Awaiting first agent call - tools will be discovered from a forwarded assertion". The equivalent banner on User Token reads "Awaiting first user credential - tools will be discovered on first sign-in" (section 13).

| Banner | Auth mode | What triggers discovery |
|---|---|---|
| Awaiting first user credential - tools will be discovered on first sign-in | User Token | A person signs in to the door once |
| Awaiting first agent call - tools will be discovered from a forwarded assertion | Pass Agent Token | The first agent call with a token the gateway accepts |

### What happened on the first agent call

The PF token call (2026-10-26 10:39 UTC) produced, in order [measured, gateway log]:

1. `mcpgw: workload token accepted for key pftoken-agent issuer=https://cmuir-pf.ping-devops.com subject=pf-route-c-test`
2. `[mcpgw] policy denied PFtoken access to pftoken (agent=true): Access Denied for` (no grant for `pftoken-agent`)
3. `[mcpgw] tool discovery for pftoken failed: calling "initialize": ... dial tcp: lookup opensearch-mcp-server.ping-devops-cmuir.svc.cluster.local on 172.20.0.10:53: no such host`

So discovery **was** triggered by the agent's call, even though the call itself was refused on policy. It failed because the door's backend URL pointed at a Kubernetes Service that no longer exists.

### The backend fix

- `opensearch-mcp-server.ping-devops-cmuir.svc.cluster.local:9900` has no Service in `ping-devops-cmuir`. The OpenSearch MCP server now runs as a container inside the gateway pod, and the in-cluster address is `opensearch-mcp-noget` (port 80, endpoint on 8080; the nginx front that refuses `GET /mcp`).
- Both `pftoken` and `opensearch-hitl` were moved to `http://opensearch-mcp-noget.ping-devops-cmuir.svc.cluster.local/mcp` on 2026-10-26. Auth modes unchanged: `pftoken` Pass Agent Token, `opensearch-hitl` User Token.
- `opensearch-hitl` is the door behind the AI Policies demo page. Its nine tools were listed from an earlier discovery, but any call forwarded to the backend (the "allow" scenario, a retry after approval) would have failed until this change.

![pftoken after the backend change](images/pf-token-exchange/41-pftoken-overview-after.png)

![opensearch-hitl after the backend change](images/pf-token-exchange/41-opensearch-hitl-overview-after.png)

The second PF call after the change (11:11 UTC) was accepted and refused on policy again, and logged no discovery error. Whether `pftoken` now lists its nine tools has to be read in the console (Overview, Tools). Next step after that: create the policy for `pftoken-agent` (section 5), then rerun the test (section 9).

### Finding the right gateway log

The public host `mcpgw.ai-demo.ping-devops.com` is fronted by `mcpgw-lb`, which spreads requests over **three** gateway pods in two namespaces. A request is logged only on the pod that served it, so search all three:

```bash
kubectl --context us -n ping-devops-cmuir     get pods | grep agentless-mcpgw
kubectl --context us -n ping-devops-curtismuir get pods | grep agentless-mcpgw
# then, for each pod:
kubectl --context us -n <namespace> logs <pod> --all-containers --since=5m \
  | grep -E 'workload token|policy denied|tool discovery|auth rejected' | grep -i pftoken
```

The request lines are in the log-tailer output, so `--all-containers` is needed.

| Log line | Meaning | Fix |
|---|---|---|
| `workload token accepted for key <key> issuer=… subject=…` | The NHI check passed (issuer, audience, subject, required claims, lifetime) | none |
| `policy denied <NHI> access to <app> (agent=true)` | No grant for that key on that door | create the policy for the key (section 5) |
| `tool discovery for <app> failed: … no such host` | The door's backend URL does not resolve | fix the MCP Server URL (this section) |
| `auth rejected: reason=token_not_found` | Logged after a policy denial for the same request; it is the refusal, not a second cause | as above |
| no `workload token` line at all | The token was not recognised as a workload token: check issuer, audience, subject, required claims and lifetime against the NHI | section 3 |

The client only ever sees a bare `403 Forbidden` for a policy denial, and `401 Bearer token required` for a token the gateway did not accept at all. The log is the only place that says which.

### Claims you can check today (Suman, 2026-10-23)

- Claim conditions can be set today in the **Access Policy** step of the Agent Registry creation flow, on four fixed claims only: **scopes, `client_id`, subject, issuer**.
- Cedar cannot read token claims yet. `context.token.claims` (including `act.sub`) is coming in the next release.
- The audience must contain the gateway; a wildcard is not allowed (RFC 7519 §4.1.3). OBO, in staging and due at the end of next week, is the intended route for per-MCP audiences. An allow-list of audiences is possible on request.

## 15. Proving the passthrough: `whoami` behind door `pftoken-rs` (2026-10-27 UTC)

**Question:** with Pass Agent Token, does the MCP server really get the agent's PingFederate token, or a gateway credential? **Answer [measured]:** the agent's own token. The MCP server verified it against PingFederate's JWKS and reported its claims.

### What was set up

| Where | Setting | Value |
|---|---|---|
| MCP resource server (`demo_mcp_resource_server`) | new tool `whoami` (scope `whoami:read`) | returns the issuer, subject, `act`, audience, `client_id` and scope of the token it verified; never the token |
| MCP resource server | trust PingFederate | `PF_ISSUER=https://cmuir-pf.ping-devops.com`, `PF_JWKS_URI=https://cmuir-pf.ping-devops.com/pf/JWKS`; the `pftoken` door URL added to `MCP_RESOURCE_SERVER_RESOURCE_URI` (the accepted audiences) |
| k8s | network policies | `mcp-resource-server-from-gateways` (ingress, port 8081) and `gateways-to-mcp-resource-server` (egress from the curtismuir gateway pods), `k8s/aws/mcp-resource-server-from-gateways.yaml` |
| PingFederate, mapping `client_credentials\|routeCTestAtm` | scope | TEXT `openid whoami:read` |
| Privilege door | `pftoken-rs` | MCP Server, URL `http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081/mcp`, Auth Mode **Pass Agent Token**, mesh `ai-demo-cmuir` |
| Privilege grant | `KarunRiver-5a485737526f` | a third rule added by `PUT`: door `pftoken-rs`, key `pftoken-agent`, tool `whoami` |

No change to the identity `PFtoken` or the key `pftoken-agent`. The same token works on both doors: the audience is still the `pftoken` door URL, and the identity checks the audience, not the door it arrives at.

### What happened

1. First call: 404. Gateway log: `rejecting /mcp on app pftoken-rs: outside entry path "/mc"`. The URL had been saved ending in `/mc`. Fixed in the door's Edit dialog.
2. Second call: 403, `workload token accepted for key pftoken-agent issuer=https://cmuir-pf.ping-devops.com subject=pf-route-c-test`, then `policy denied PFtoken access to pftoken-rs`, then `discovered 35 tools for app pftoken-rs`. Accepted, no grant yet, tools discovered.
3. After the grant rule: `tools/list` 200 with `["whoami"]`, and `tools/call whoami` 200:

```json
{
 "verifiedBy": "mcp-resource-server",
 "issuer": "https://cmuir-pf.ping-devops.com",
 "subject": "pf-route-c-test",
 "actor": { "sub": "pf-route-c-test" },
 "audience": "https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp",
 "clientId": "pf-route-c-test",
 "scope": "openid whoami:read"
}
```

Two layers each cut the tool list: the grant (one tool on this door) and the MCP server's own scope filter (only tools whose scope is in the token). Why discovery saw 35 tools when the token carries only `whoami:read` is **not known**; discovery may run with a different credential.

The demo page shows this live: [https://ai-demo.ping-devops.com/privilege-pf-token](https://ai-demo.ping-devops.com/privilege-pf-token), panel "What the backend received" (PingFederate's claims beside the backend's, row by row).

## Related

- `PF-TOKEN-ON-PRIVILEGE-STATUS.md`: status, object table, restart checklist.
- `PF-CLAIMS-IN-CEDAR-POLICIES.md`: what Cedar can and cannot read.
- `WORKLOAD-IDENTITY-AGENT-CALLERS.md`: the workload identity setup.
