# Backend auth modes: demo runbook

October 13, 2026 · SE demo script · **written from code and the measured guides;
the steps were not re-run on this date.** Measured results are from
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
