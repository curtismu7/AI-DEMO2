# Backend auth modes: demo runbook

October 13, 2026 · SE demo script · **mode flips run live 2026-10-14 (see "Verified live"); the rest is from code and the
measured guides.** Measured results are from
[GATEWAY-A2A-AUTH-MODES-COMPARED](GATEWAY-A2A-AUTH-MODES-COMPARED.md) (3 Oct 2026)
and [AUTH-MODES-MCP-BACKENDS](AUTH-MODES-MCP-BACKENDS.md). Re-run before you quote.

## The story in one sentence

The caller's own credential is **never** passed to the backend. The app's Auth
Mode is the only thing that puts a credential on the last hop — so the same
call can reach a backend with nothing, with a shared token, or not at all.

Master index row: [feature 15](../docs/privilege-agent-features.md).

## The harness (already in the repo)

The A2A demo's worker agent can be made to demand a bearer. In
[standalone/privilege-a2a-anthropic-demo](../standalone/privilege-a2a-anthropic-demo/README.md):

| Env var | Effect (`src/worker-agent/index.ts`) |
|---|---|
| `WORKER_REQUIRE_BEARER=true` | Worker answers **401** `{"error":{"code":-32001,"message":"Authorization: Bearer required"}}` to any request without `Authorization: Bearer …` (agent-card paths under `/.well-known/` are exempt) |
| `MCP_REQUIRE_BEARER=true` | Same gate on the MCP server (`src/mcp-server/index.ts`) |

That makes the worker a stand-in for "an agent that checks its caller", which is
exactly what each mode needs to be told apart. (Both default to `false`.)

## Verified live 2026-10-14 (flipping the spare app `workeragentdemo2`)

**Setup.** `workeragentdemo2` is a copy of the live `worker-agent` door (same backend,
`AuthMode: none`) that no key could reach. With the user's approval, a temporary policy
`tmp-w2-authmodes` (3-hour expiry, owner metadata copied from an existing policy so it is
not reaped) granted `main-agent` access to it; the app was flipped in place, then restored
and compared field by field to a saved copy; the policy was deleted afterwards.
**Probe:** a JSON-RPC `tasks/get` for a task that does not exist, sent through
`https://mcpgw.ai-demo.ping-devops.com/workeragentdemo2/a2a/jsonrpc` with the main
agent's key — it reaches the worker without calling the model, so the worker answers
`Task not found` in about a second.

| State of the app | What the probe returned |
|---|---|
| Before the grant (any mode) | `403 Forbidden` — stopped by policy, before the mode matters |
| `none`, with the grant | **200 in 1.4 s** — worker answered `-32001 Task not found: does-not-exist` (reached the worker) |
| `static-token` (random token set) | **200 in 0.7 s**, same worker answer. Reached the worker; the forwarded bearer itself was **not** confirmed (the gateway log lines could not be located) |
| `token-pass` | **`403 Forbidden`, bare body, 0.2–0.3 s** — refused by the gateway: the main agent's key carries no workload assertion. Took effect within seconds of the change |
| Restored to `none` | 200 again; the app's `HttpAppConfig` was identical to the saved original |
| Policy deleted | `403` again on the first probe |

**What this proves.** Only `token-pass` is visibly different, because the gateway refuses
the call itself. **None and Static Token cannot be told apart on this worker:** it does
not enforce a bearer (`WORKER_REQUIRE_BEARER` is not set on `workeragentdemo`), so both
return the same. Showing None → 401 and Static → 200 needs a worker started with
`WORKER_REQUIRE_BEARER=true`, which was not done on the shared one.
**Not located:** the gateway-log line giving the `token-pass` reason (`requires token-pass`)
— searched in the gateway pods, not found.

**Closed 2026-10-14 (evening): None vs Static Token, told apart.** A temporary copy of the
worker (`workeragentdemo-bearer`, same image and env plus `WORKER_REQUIRE_BEARER=true`, its own
Service) was put behind `workeragentdemo2`, with a 2-hour grant for `main-agent` cloned from the
existing `main-agent` → `worker-agent` rule. Same `tasks/get` probe:

| Auth Mode on `workeragentdemo2` | Result |
|---|---|
| `none` | **401** from the worker, `Authorization: Bearer required` — the gateway added no credential |
| `static-token` (random token) | **200** — worker answered `Task not found` |
| `token-pass` | **403 Forbidden** from the gateway, 83 ms |

Afterwards the app was restored from a saved copy (its `HttpAppConfig` compared identical), the
grant was deleted (probe back to **403**), and the temporary Deployment and Service were removed.
The shared `workeragentdemo` worker was never changed.

**Facts learned.** Valid `AuthMode` values for a Remote Agent (HTTP) app, from the console's
swagger: `none` / `""`, `static-token` (uses the app's `AuthToken`), `user-token`, and
**`token-pass`** (the console's name for Pass Agent Token). A grant is a `pacpolicys`
rule: `Spec.ActionMap.HTTP.PolicyRule[]` with `ObjectRef` = the app
(`tenant@@@default@@@<app>`, base64) and `Attributes.Map.agentaccesskey` = the key
(base64), with `IssuedTo` = the user. The console creates this kind of rule only with
approval: the auto-mode classifier treats it as a permission grant.

## The modes

| Auth Mode | The backend receives | Status on our build |
|---|---|---|
| **None** | no `Authorization` header | verified (default in every tested app) |
| **Static Token** | `Authorization: Bearer <configured token>` | verified |
| **User Token** | the user's stored vault credential; **nothing** if none | verified only for the empty-vault case |
| **Pass Agent Token** | the caller's workload assertion; the gateway **refuses** (`403`) if the caller has none | refusal verified; the success path is **not demoable** (see below) |
| **OAuth** | not established | **avoid** |

## The run — the same call, three outcomes

Setup: set `WORKER_REQUIRE_BEARER=true` and restart the worker. In the console,
open the `workeragentdemo` Remote Agent app → Auth Mode. Send one A2A call each
time with the main agent's key (UI chat, or `message/send` at the app's gateway
route).

1. **None.** Send the call. Expect the **agent's own** `401 Bearer authentication
   required`, passed back unchanged — the gateway added nothing.
   *Say:* "The gateway forwarded the call and sent no credential. The backend
   can't tell this from any other call that reaches it — only use None when
   nothing but the gateway can reach the agent."
2. **Static Token.** Generate a long random secret, give it to the worker as its
   expected bearer, then paste the **same** value into the app's Static Token
   field. Resend: expect **200** and the agent's reply. *Say:* "Now the agent
   learns one thing: the call came through the gateway. Every caller shows the
   same token, so it can't tell callers apart."
   - **Say the cautions:** the gateway log prints this token in full on each
     forwarded call, and if the agent has its own public address the token works
     there too — a call made that way skips the gateway's policy, guardrails and
     logging.
   - **Rotation order:** update the agent first, the console straight after;
     calls fail while the two differ.
3. **Pass Agent Token.** Resend with the main agent's ordinary key. Expect a bare
   **`403 Forbidden`** from the gateway, with this in the log only:

   ```text
   backend credential refused for <user-id> on <app>: app <app> requires token-pass,
   but this session presented no workload assertion
   ```

   *Say:* "This is the only mode where the gateway refuses the call itself. A
   person or a plain agent key has no workload token to pass."

Confirm what mode an app is in without the UI: the console API exposes it as
`Spec.McpAppConfig.AuthMode` (the same field the gateway client reads in
`standalone/ai-gateway-client/server/lib/relay.js`, which also reports
`aiGuard.enabled` / `failClosed` per app). See
[console API recipe](../.claude/skills/privilege-console-api/SKILL.md).

## User Token — say this, don't demo it

If the user has no vault credential, the gateway **forwards the call anyway with
no `Authorization` header**; the log shows `no vault credential for user <id> on
app <app>`. A 401 on this mode usually means an empty vault, not a wrong
setting. How the vault gets filled was **not established** — ask Ping before you
plan around it.

## What is not demoable, and why

**Pass Agent Token's success path.** It needs a caller holding a *workload
identity* (a signed token from the caller's platform). No caller in this stack
holds one, so the mode can only be shown refusing. The SPIFFE side is built and
verified in this repo; the gap that keeps the two from meeting is written up in
[WORKLOAD-IDENTITY-AGENT-CALLERS](WORKLOAD-IDENTITY-AGENT-CALLERS.md).

## What this proves, and what it does not

- **Proves:** credential forwarding is a per-app setting, distinct from how
  clients authenticate to the gateway, and the modes behave differently on the
  same call.
- **Does not prove:** User Token with a stored credential, or Pass Agent Token
  succeeding.
