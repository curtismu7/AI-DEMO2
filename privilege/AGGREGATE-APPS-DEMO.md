# Aggregate apps: demo runbook

October 13, 2026 · SE demo script · **written from code and the measured guide;
the steps were not re-run on this date.** Measured results are from
[GATEWAY-AGGREGATE-APPS](GATEWAY-AGGREGATE-APPS.md) (4 Oct 2026, two members, one
agent key with the `mcp` scope). The guide itself notes that full sign-in through
the aggregate is **not yet recorded** — rehearse before showing.

## The story in one sentence

One address, many MCP servers: the client connects once and sees every granted
tool from every member in a single list, each prefixed with the server it comes
from — and a central grant decides what each caller gets.

Master index row: [feature 12](../docs/privilege-agent-features.md).

## Where it is in the stack

- **Door:** `https://mcpgw.ai-demo.ping-devops.com/aggregate/mcp` — the demo's
  aggregate fronts `opensearch` + `banking-mcp`. The gateway client lists it as a
  preset ("MCP Aggregate app: opensearch + banking-mcp behind one URL",
  `standalone/ai-gateway-client/server/lib/relay.js`), and the demo's
  [/privilege-mcp-client](https://ai-demo.ping-devops.com/privilege-mcp-client)
  can select it as a door.
- **Console:** an application of type **MCP Aggregate** — a name (its address) and
  a member list; no backend and no Auth Mode of its own. Reachable through the
  Agent Privilege only, not the device agent.
- **API shape** (for scripts; see the
  [console API recipe](../.claude/skills/privilege-console-api/SKILL.md)):
  `McpAppConfig.Members.Members[].AppRef.RefID` = base64(`{tenant}@@@default@@@{appName}`),
  `Alias` = the member's display name. A member's `ToolFilter.Elems` are **bare**
  tool names (no prefix) and are *intersected with the caller's policy grant*;
  empty `Elems` means **all** tools — there is no "empty means none".

## Before you present

1. **Each member works alone first.** Call one tool through the member's own door.
   Fix anything that fails there before blaming the aggregate.
2. The caller has a grant on the aggregate — **in prefixed form**
   (`opensearch__ListIndexTool`, not `ListIndexTool`).
3. A client timeout on every call (see the hang below).
4. A gateway-log terminal:

   ```bash
   kubectl -n <gateway-namespace> exec deploy/<gateway-deployment> -c <gateway-container> -- \
     sh -c 'tail -n 3000 /var/log/procyon/cyonproxy.log | grep "\[mcpagg\]" | tail -n 10'
   ```

## The run

1. **List.** One request, one address:

   ```bash
   curl -s -X POST https://mcpgw.ai-demo.ping-devops.com/aggregate/mcp \
     -H 'Authorization: Bearer <agent-key>' -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   Expect each granted tool **once**, prefixed with its member.
   *Say:* "Two servers, one connection. The prefix is the member's app name — so
   a prompt that names `ListIndexTool` has to say `opensearch__ListIndexTool`
   now."
2. **Call one tool per member** by its prefixed name, with a timeout. A reply with
   a `result` means **both** access layers passed — the aggregate's grant *and*
   the member's own access and backend credential.
3. **Ungranted tool.** Call a tool you left out of the grant. Expect
   `access denied`. *Say:* "A smaller list than the members have is the grant
   working — not a bug."

## Two things to say out loud

- **Two layers of access.** The aggregate's grant decides what the caller *sees*;
  each member still applies its own access and credential when the tool runs.
- **Listed does not mean working.** In testing, tools appeared in the list and
  then failed or hung when called, because of the member behind them.

## Troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| `is not namespaced` | bare tool name | use `<member>__<tool>` |
| `unknown server` | prefix isn't a member's app name | check names in the tool list |
| `access denied` on a tool you granted | misspelled, or member's tool list changed | compare with `tools/list` |
| `<member>: … Unauthorized` | member's backend rejected what its Auth Mode sent | fix the member's Auth Mode; test it alone |
| A call hangs | member is recorded with the `sse` transport; aggregate waits on its event stream | client timeout; use a member recorded as streamable HTTP; raise it with Ping |
| Client says success, nothing happened | error returned with HTTP 200 | check the JSON-RPC `error` field |
| Names changed after re-registration | prefix is the member's app name | update prompts/clients |

## What this proves, and what it does not

- **Proves:** one connection and one central grant can front many servers.
- **Does not prove:** a clean end-to-end person sign-in through the aggregate (not
  recorded), or that every listed tool is callable (member-dependent). The create
  form itself was not walked through in the source guide.
