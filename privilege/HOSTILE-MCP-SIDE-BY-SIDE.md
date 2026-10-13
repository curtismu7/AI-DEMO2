# Side-by-side: a governed MCP server vs its ungoverned twin

October 11, 2026 · demo guide

Two identical hostile MCP servers behind two Privilege app registrations —
one with a policy, one explicitly allow-all — so the audience watches the
same tool call come back ALLOWED and DENIED from the same attack. The
difference is the gateway policy and nothing else. Companion sources:
[`standalone/hostile-mcp-server/README.md`](../standalone/hostile-mcp-server/README.md)
(the attack payloads), [`CURRENT-CONFIGURATION.md`](CURRENT-CONFIGURATION.md)
(the `hostile-mcp` app registration, re-registered on `/mcp` 2026-10-12),
and the denials design spec
(`docs/superpowers/specs/2026-09-19-hostile-mcp-privilege-denials-design.md`).

## What the demo shows

The hostile server serves poisoned tool metadata (description injection,
schema exfil sinks, tool shadowing) plus three real, callable dangerous
actions: `create_transfer`, `delete_all_records`, `grant_admin`.

The measured matrix (verified live 2026-10-11, gateway build v1.261009):

| Row class | Ungoverned twin (allow-all policy) | Governed twin (permit-selection) |
|---|---|---|
| Metadata / result / resource / prompt rows (10) | ALLOWED | ALLOWED |
| `create_transfer` / `delete_all_records` / `grant_admin` (3) | ALLOWED | **DENIED** |
| `get_stock_price` rug-pull (TOFU flip) | NO FLIP | NO FLIP |

Read that honestly, out loud:

- **The 10 ALLOWED rows are the honest gap.** The gateway polices tool
  *calls*, not metadata, results, resources, or prompts — Privilege is not
  presented as a metadata sanitizer. Catching poison at ingest is
  `standalone/mcp-scanner`'s job.
- **The 3-vs-3 split is the product.** Same model, same tools, same poison —
  the only difference is the policy, and the dangerous actions are what die.
- **NO FLIP on rug_pull is correct gateway behavior, not a bug.** The
  gateway caches/proxies the tool list per app, so both `tools/list`
  responses carry the poisoned description — no layer re-reads it. The
  story for that row is "ingest-once scanning is structurally blind".

## Policy mechanics you must know before building it

These are the traps that cost the 2026-10-10/11 session real time — do not
rediscover them in front of a customer.

1. **The console policy model is a permit-selection, not a deny rule**
   (Ping docs: agentic-apps/mcp-server step 2 — "Select which operations
   from the MCP Server specification are available to agents"). The gateway
   filters `tools/list` to the selected set AND 403s calls to unselected
   tools. So the governed twin's policy selects ALL tools EXCEPT
   `create_transfer` / `delete_all_records` / `grant_admin` (plus the
   `account_review` prompt and the account-verification resource).
2. **No policy on an app = DENY ALL** on v1.261009 (measured 2026-10-11; an
   earlier session observed permit-all on 2026-10-10 — trust the newer
   measurement). The ungoverned twin therefore needs an explicit allow-all
   policy — `OkaRiver3-allow-all`, all 11 tools + prompt + resource — to be
   a fair twin. "No policy" is not "no governance"; it is the strictest
   mode.
3. **RefID encoding trap.** Policy-rule ObjectRefs and IssuedTo refs use
   base64 of `tenant@@@default@@@<name>` — a TRIPLE `@`. ObjectMeta.ID uses
   a DOUBLE `@`. Wrong encoding: the console accepts the POST, then the
   gateways deny everything with an empty "Access Denied for" reason.
4. **Policies with no/foreign owners are reaped within minutes.** Clone a
   working policy (e.g. `Catatumbo`) so the Creator/owner fields survive.
5. **Propagation takes ~4 minutes.** Author both policies, wait, then run
   the matrix. Do not troubleshoot a denial at minute one.

## The audit story

The gateway log line behind every governed-twin denial:

```
policy denied <user> access to <app> (agent=false)
```

Read it for the close: the denial names the user, the app, and the enforcer
— the same attributable-decision shape as the LLM-path denials.

## Not in scope / do not claim

- The gateway does not sanitize metadata, tool results, resources, or
  prompts. Say "the poison lands; the *action* is what Privilege denies".
- The rug-pull row is not a gateway detection story.
- The dangerous actions are stubs — nothing transfers, nothing is deleted,
  no admin grant exists. The demo never moves real money or state.

## Pre-demo check

Both apps resolve through their doors (`https://mcpgw.ai-demo.ping-devops.com/<app>/mcp`),
both policies still exist with owners intact (re-clone if reaped), and the
gateway has been stable for 4+ minutes since any policy edit.
