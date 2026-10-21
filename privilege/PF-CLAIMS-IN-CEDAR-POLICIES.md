# Protecting on PingFederate identity in Privilege AI policies (Cedar)

2026-10-20. Read-only investigation of the demo tenant (`0428ba4f-…`, "AI Agent") and the SE gateway
(`mcpgw.ai-demo.ping-devops.com`, door `opensearch-hitl`). **Nothing was changed on the console.**
This guide separates what was measured from what is a design guess, because the answer to "can a PF token
claim drive a Cedar rule?" is narrower than the question assumes.

## The short answer

- **Cedar rules do not read the raw PingFederate token.** They read a fixed set of attributes the gateway
  builds (below). There is no `context.claims`, no raw `groups` claim, and no hook for `act` or ID-JAG
  that we could find in the console editor.
- **What a PF user can be protected on today** is *who they resolve to in Privilege* (user, email alias,
  group, named agent), plus the door, the tool and its arguments.
- **PF-issued scopes reaching `context.token.scopes` is untested.** The door's token is issued by the
  Privilege-owned PingOne environment, which requests a fixed scope list. Do not promise PF scopes.
- **PingFederate is not registered anywhere in Privilege yet.** The tenant's IdP list is empty.

## What the door trusts today (measured)

| Fact | Evidence |
|---|---|
| The door advertises **itself** as the authorization server | `/.well-known/oauth-authorization-server` issuer = `…/opensearch-hitl`; protected-resource metadata lists only that issuer |
| A client can register through the door | `POST …/opensearch-hitl/register` → 201 |
| `/authorize` redirects to PingOne environment `0428ba4f` | client `1a403855…`, scopes `openid profile email offline_access p1:read:env p1:read:user p1:read:application`, `state` = `idp\|<nonce>` |
| That environment federates onward to the demo environment | `0428ba4f` → `rp/authenticate?providerId=…` → `01d89b06` (client "Demo AI App - Privilege Tenant Federation") → sign-on (`CURRENT-CONFIGURATION.md`, "Which PingOne identity is which") |
| Privilege has **no external IdP registered** | `GET /v1/idproviders` → empty list |
| The tenant's own OIDC server has no signing keys exposed | `GET /v1/oidcservers` → one server `oidc`, empty key fields |

So the token Cedar sees is **issued by `0428ba4f`**, after a sign-in that happened in `01d89b06`. A PF
token never reaches the door; at best PF is a sign-in source behind `01d89b06`.

## What Cedar can see (measured: console editor + 5 live AI policies)

| To protect on | Cedar expression | Source |
|---|---|---|
| Token scope | `context.token.scopes.contains("x")` | template "Restrict a tool to tokens carrying a scope"; fails closed with no token |
| Agent-key scope | `context.agent.scopes.contains("x")` | editor condition `agent_scope` |
| Group of the caller | `principal in Group::"x"` | template "…for one team"; groups come from Privilege's directory |
| One named agent | `principal == Agent::"x"` | template "A named agent may never call a tool" |
| Door / app | `context.app == "x"` | every live policy |
| Tool | `resource == Tool::"x"` | every live policy |
| Tool arguments | `context.args.<name>` | templates (amount, country, …) |
| Approval state | `context has approval_count && context.approval_count >= 1` | the HITL policies |
| Content findings | `context.aiguard.pii_kinds`, `context.aiguard.categories` | PII / injection templates |

Actions: `mcp:Invoke` (refuse) and `mcp:InvokeUnattended` (hold for a human); `llm:Receive` for LLM replies.

**Not found:** `context.claims`, `principal.<attribute>`, a raw `groups` claim, `act`, ID-JAG. Absence from
the editor is not proof the engine rejects them; it is proof there is no supported way to write them.

## How a PF user becomes a Cedar principal (inferred, one measured line)

The gateway log reports its Cedar registry: `125 entities: 4 users (+4 email aliases), 4 agents, 1 groups,
112 resources`. Callers are therefore matched to **Privilege users, by email alias**, and their groups come
from the Privilege directory. *Inference:* a PF user whose email matches a Privilege user is that principal.
*Not tested.* The log never prints scopes, so scope contents could not be confirmed from logs.

## Directions

**1. Get PF into the sign-in chain (not done; a write, ask first).**
- *Route A, recommended:* add PF as an external OIDC IdP in `01d89b06` (the AIC pattern, `ai-demo2-aic-external-idp`:
  IdP object + sign-on policy assigned to the federation app). Result: PF identity in, PingOne-issued token out.
- *Route B, untested:* register PF as a Privilege `IDProvider` (`ProviderType`, `OidcProvider{ProviderURL,
  ClientID, ClientSecret}` per the console swagger). Whether the gateway then trusts PF-issued tokens is unproven.

**2. Make the PF user a Privilege principal.** Ensure a Privilege user exists with the PF user's email, and
put them in the group the rule will name.

**3. Author the rule** (Access Management → AI Policies, `/ui/admin/ai-policys`). Group-gated hold, adapted
from the live `hitl-opensearch` policy (adaptation, not yet run):

```
@grant("capability")
@ttl("900")
@request_ttl("3600")
@approvers("<approver-id>")
@reason("Only the search-admins group may run SearchIndexTool without a hold")
forbid (principal, action == Action::"mcp:InvokeUnattended", resource == Tool::"SearchIndexTool")
when   { context.app == "opensearch-hitl" && !(principal in Group::"search-admins") }
unless { context has approval_count && context.approval_count >= 1 };
```

Scope-gated refusal, verbatim from the console template:

```
@reason("SearchIndexTool requires the search:read scope")
forbid (principal, action == Action::"mcp:Invoke", resource == Tool::"SearchIndexTool")
when   { context.app == "opensearch-hitl" }
unless { context.token.scopes.contains("search:read") };
```

**4. Enforce it.** Create as **Candidate** (validated, never enforced), then move to **Active**. A policy created
through the API lands with `State:''` and is never enforced until `PUT` to `Active`. AI policies live in
`aipolicys`, not `pacpolicys`. Watch the gateway log for `aipolicy: … compiled N policies`.

**5. Test through the door.** Register a client (DCR), sign in, call the tool. A refusal logs
`mcp_policy_denied`; a hold logs `mcp_policy_approval_required` and opens an approval that someone approves
under Access Request Approvals before the client retries. See `AGENT-APPROVALS-DEMO.md`.

## Status of each claim

| Claim | Status |
|---|---|
| Cedar vocabulary above | **Measured** (editor + live policies) |
| Door trusts only itself; PF not registered | **Measured** |
| Sign-in chain `0428ba4f → 01d89b06` | **Measured** (existing doc, redirect re-observed) |
| PF user matched by email alias | **Inferred** |
| Group rule above | **Adapted**, not run |
| PF scopes in `context.token.scopes` | **Untested**; assume absent |
| `act` / ID-JAG in Cedar | **No hook found** |
| Route B (PF as `IDProvider`) | **Untested** |

## Side effect to know about

Probing registered one throwaway OAuth client (`pf-claims-probe`) through the door via DCR, the same call
any MCP client makes on first connect. No delete endpoint was found; remove it in the console if one exists.

Related: `PRIVILEGE-POLICIES-IN-DEPTH.md`, `AGENT-APPROVALS-DEMO.md`, `GATEWAY-RELEASE-v1.261009-DEMO.md`,
`CURRENT-CONFIGURATION.md`.
