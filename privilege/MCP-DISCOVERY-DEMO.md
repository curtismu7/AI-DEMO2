# Agent Privilege: MCP discovery-gating demo

October 9, 2026 · SE demo script

> **Update 2026-10-12: the `opensearch22` Agentic App was deleted from the console** (unused for
> 15 days). Anything below that names it describes the demo as written on October 9, not the
> current tenant. The aggregate family (`aggregate`, `aggregate-limited`, `aggregate-none`) is now
> the teaching door set (see `demo_api_server/services/mcpProfileStore.js`); re-verify the
> permit/deny pairing against it before presenting. A deleted door is not a 403: the gateway
> answers it with an empty HTTP 200, which clients report as `response id mismatch`.

## The story in one sentence

An MCP client connects to the Agent Privilege, signs in, and the `tools/list`
it gets back contains **only the tools its policy grants** — the agent never
learns that other tools exist.

Every claim in this script was measured against the live Agent Privilege
(2026-10-02 to 2026-10-04). Sources: [GATEWAY-REGISTERING-AN-MCP-SERVER.md](GATEWAY-REGISTERING-AN-MCP-SERVER.md),
[GATEWAY-CONNECTING-AN-MCP-CLIENT.md](GATEWAY-CONNECTING-AN-MCP-CLIENT.md),
[GATEWAY-AGGREGATE-APPS.md](GATEWAY-AGGREGATE-APPS.md),
[GATEWAY-SETTING-UP-A-CALLING-AGENT.md](GATEWAY-SETTING-UP-A-CALLING-AGENT.md),
[CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md).

## Doors and state to check before presenting

| Door | URL | Policy state | Expected |
| --- | --- | --- | --- |
| ~~`opensearch22`~~ | ~~`…/opensearch22/mcp`~~ | **app deleted 2026-10-12**; its policy `opensearch22-permit-presenter` and the tag policy `demo-map-opensearch22` were deleted 2026-10-14 | **Gone** — an empty 200, not a 403. Use `aggregate-limited` for the permit side |
| `aggregate-limited` | `https://mcpgw.ai-demo.ping-devops.com/aggregate-limited/mcp` | per-member tool filter | **Permit, filtered** — `tools/list` returns exactly 4 tools (`banking-mcp__get_investment_accounts`, `banking-mcp__get_airline_bookings`, `opensearch__ListIndexTool`, `opensearch__MsearchTool`), per [AGGREGATE-APPS-DEMO.md](AGGREGATE-APPS-DEMO.md) |
| `aggregate-none` | `https://mcpgw.ai-demo.ping-devops.com/aggregate-none/mcp` | `…____no_tools_by_design` on each member | **Door up, zero tools** — the "nothing granted" side of the contrast |
| `opensearch` | `https://mcpgw.ai-demo.ping-devops.com/opensearch/mcp` | **deliberately none** | **Deny** — always 403 by design. Never attach a policy to it; never report its 403 as broken |
| `aggregate` | `https://mcpgw.ai-demo.ping-devops.com/aggregate/mcp` | grant listing tools in `<member>__` form | Permit for the granted tool set; full sign-in through it not yet recorded — rehearse before showing |

Pre-demo check, from the Mac with the `us` kubectl context:

```bash
kubectl config current-context                 # expect: us
kubectl logs -n ping-devops-curtismuir deployment/agentless-mcpgw -c log-tailer --tail=200 \
  | grep -E 'identity resolved|policy denied'
```

Sign in once on `/privilege-mcp-client` against `opensearch22`. If it answers
200 with tools, the demo is live. A 403 here is an expired policy — renew in
the console (AI Security → Agentic Apps → `opensearch22`), it takes effect
without a gateway restart.

Have the log command running in a visible terminal through the whole demo:
the client shows only bare 403s; the log lines are the story.

## Act 1 — Discovery shrinks to the grant (person sign-in)

> **Status 2026-10-14: stale as written.** It was scripted and measured against `opensearch22`,
> which is deleted along with its permit policy. The numbers below (nine tools, a recorded three)
> describe that run. The nearest live equivalent is `aggregate-limited`: its console config
> filters each member, so `tools/list` returns exactly four tools
> (`banking-mcp__get_investment_accounts`, `banking-mcp__get_airline_bookings`,
> `opensearch__ListIndexTool`, `opensearch__MsearchTool`). That filter is verified from the
> app config only; **no signed-in `tools/list` has been recorded against it yet. Rehearse before presenting.**

1. Open `/privilege-mcp-client` in the browser and sign in to the
   `opensearch22` door. The sign-in federates once into the demo tenant —
   no second login.
2. Ask the client to list tools. The backend MCP server exposes **nine**
   tools; a recorded session was shown **three** (`ListIndexTool`,
   `SearchIndexTool`, `ClusterHealthTool`, plus `ExplainTool` in another
   session's screenshot — the exact set is whatever the policy grants that
   day, which is itself the point).

**What to say:** "The backend has nine tools. The user's policy grants a
subset. `tools/list` returns the subset — the client cannot tell the others
exist. Not disabled, not greyed out: undiscoverable."

**The proof line in the log:**

```
Removing unauthorized tool from MCP response: <tool>
```

six such lines in the recorded session, plus the permitted set delivered in
the `X-Procyon-Mcp-Cap` header:

```
[mcpfilter] cap header present on request: {"tools":[...]}
```

## Act 2 — Deny-by-default (the no-policy door)

> **Status 2026-10-14: still valid as written.** It uses the `opensearch` door, which still exists
> and has no policy attached (checked against the console's policy list; the only OpenSearch
> permit policy left is `opensearch-hitl-permit`, which targets `opensearch-hitl`, not this door).

1. On the same page, switch to the `opensearch` door ("Use this door").
   It reuses the PingOne session silently — sign-in succeeds, a token is
   issued.
2. The **first** call — `initialize`, before any tool is even named —
   answers bare `403 Forbidden`. The backend is never contacted.

**What to say:** "Same user, same token mechanics, different app: the app
has no policy, so everything is denied. Not the tool call — the very first
handshake. Deny-by-default is the platform default, not a configured rule."

**The log line:**

```
[mcpgw] policy denied <user-id> access to opensearch (agent=false): Access Denied for
```

Client nuance worth saying out loud if asked: a refused call is plain HTTP
403 with no JSON-RPC body — the same response a non-existent tool gets — so
the log is the only place the *reason* lives. Four different failures (no
policy, tool outside policy, tool that does not exist, app that does not
exist) produce that identical bare 403.

## Act 3 — A different grant, a different list

> **Status 2026-10-14: cannot be run as written.** Step 1 edits the `opensearch22` policy, which
> no longer exists. The nearest live move is to change the per-member tool filters on
> `aggregate-limited` in the console, which changes its `tools/list` the same way; how soon a
> change shows up has not been measured. Needs re-scripting and a rehearsal.

1. In the Privilege console, edit (or duplicate) the `opensearch22` policy:
   change the tool list for the demo user. Policies name a user or group,
   list permitted tools, and carry a time window.
2. Sign in again (or refresh tools). The client's tool list now matches the
   new grant exactly.

**What to say:** "Policy is data, not code. The grant changed; the next
sign-in sees a different catalog. A new policy takes effect without
restarting the gateway."

## Act 4 (optional) — Machines get the same gate (agent key)

For the machine-identity flavor, registered agents in
**Agent Registry** hold a key with an `mcp` scope and a grant listing
which apps — and which tools per app — they may reach. The key is the
bearer; there is no separate policy to write:

```bash
curl -s -X POST https://mcpgw.ai-demo.ping-devops.com/<app>/mcp \
  -H "Authorization: Bearer <agent-key>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A tool outside the agent's grant is **hidden from `tools/list`** and refused
if called; an app it was not granted answers a bare 403 (log:
`policy denied`). Tested 3–4 Oct — see
[GATEWAY-SETTING-UP-A-CALLING-AGENT.md](GATEWAY-SETTING-UP-A-CALLING-AGENT.md)
for agent setup and the review checklist.

## Act 5 (optional) — One address, two servers, one grant (aggregate)

Connect to the `aggregate` door: two member servers (`opensearch`, 9 tools;
`banking-mcp`, 33 tools) behind one URL, tool names prefixed
`opensearch__…`, `banking-mcp__…`. In the tested session the caller was
granted 11 of the members' 42 tools and **saw exactly 11**.

The two-layer story: the grant on the aggregate decides what is discoverable;
each member still applies its own policy and credential at call time.
Tested 4 Oct — one member returned data end-to-end, the other hung on its
member transport, which is a known aggregate limitation, not a policy
failure. A full person-sign-in through `aggregate` is not yet recorded —
rehearse before presenting this act.

## Closing line

> "Discovery is the first privilege decision an agent hits — before any
> tool call, before any data. PingOne Agent Privilege applies it at
> `tools/list`: the catalog an agent sees IS its privilege level."

## Troubleshooting during the demo

| Symptom | Truth | Fix |
| --- | --- | --- |
| ~~`opensearch22` 403s~~ (the app was deleted 2026-10-12; a call now gets an empty 200) | Expired policy time-box — the demo-killer named in [CURRENT-CONFIGURATION.md](CURRENT-CONFIGURATION.md) | Renew the policy in the console; effective immediately, no restart |
| Console says "Gateway Unreachable" / "Unauthorized" on a 403 | Both messages lie — Privilege denies at its own policy layer before dialling the backend (measured: backend 401 in 13 ms while the console showed "Unreachable") | Read the `log-tailer` output; check the policy time-box |
| Client shows 403, log shows `policy denied … user not found in system` | User not synced into Privilege | Fix the PingOne Privilege app's Group Membership Policy and the user's group |
| Empty Email= in `User identity resolved` | Cosmetic — empty for every user, including working ones | Ignore it |
| Aggregate tool call hangs | The member's transport, not policy (reproduced; persisted across policy swaps) | Swap the act to the healthy member; known limitation |
| 403 on a door you just fixed | Policy union: old + new grants add up; an expired one still denies | Delete superseded policies rather than layering new ones ([FAQ](../docs/FAQ.md)) |

## Untested — say so if asked

- Policy expiry behaviour (an expired policy reads as a missing one) and
  policy union semantics are **partly confirmed only** — permit, deny,
  deny-by-default and the granted identity are confirmed; expiry windows
  and multi-policy union are not.
- Aggregate reached with a person's sign-in (Act 5 used an agent key).
- `opensearch`-door numbers for Act 3 assume per-user policies behave as the
  per-app policies measured; the recorded sessions used one user. Rehearse
  the two-grant side-by-side once before showing it.

## Audience tips

- **Security buyers:** lead with Act 2 (deny-by-default) — "the platform's
  default answer is no" lands harder than a filtered list.
- **Platform/agent teams:** lead with Act 4 (agent key) — machine identity
  with tool-level grants, no browser in the loop.
- **Everyone:** keep the log terminal visible; the bare 403 on screen and
  the reason in the log is the whole product story in two panes.
