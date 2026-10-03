# langchain_agent as a Privilege Remote Agent (a2a) — status

## Summary

`langchain_agent` is registered in the PingOne Privilege console as Remote
Agent `langchainagent` (mesh cluster `ai-demo-cmuir`, Frontend URL Path
`/a2a`, Backend URL
`http://langchain-agent.ping-devops-cmuir.svc.cluster.local:8888`). **The A2A
surface this needs is already built, merged to `main`, deployed, and verified
live** — this doc exists so the next person/agent doesn't re-investigate or
re-build it. The one open item is picking an explicit Auth Mode in the
console (see below).

## What's already done

- **Code** (`langchain_agent/src/api/a2a_handler.py`, wired into
  `src/main.py`'s FastAPI app on port 8888 alongside the AG-UI `/run`
  endpoint): serves `GET /.well-known/agent-card.json` (public, unauthenticated
  — what Privilege's "Discover A2A agent card" fetches) and
  `POST /a2a/jsonrpc` (A2A JSON-RPC `message/send`, authenticated). Landed in
  three commits on `main`: `f79927e64` "Expose LangChain agent through
  Privilege A2A", `f9b4b9e27` "Add federated direct LangChain A2A auth",
  `f93761f6f` "fix: expose standard direct A2A agent card path" (2026-09-19).
- **Deploy**: `langchain-agent` Deployment+Service already live in namespace
  `ping-devops-cmuir` (`kubectl get deploy -n ping-devops-cmuir` → 1/1 ready),
  image `ghcr.io/cmuir_pingcorp/ai-demo-langchain-agent:sha-0504823c...`,
  pod running since 2026-09-26 — postdates all three A2A commits, so it has
  the code.
- **Verified live (2026-09-30)**: curled
  `http://langchain-agent.ping-devops-cmuir.svc.cluster.local:8888/.well-known/agent-card.json`
  from inside the cluster and got back a real, correctly-shaped A2A v0.3.0
  card:
  ```json
  {
    "name": "langchainagent",
    "description": "LangChain MCP agent exposed through PingOne Privilege AI Gateway.",
    "protocolVersion": "0.3.0",
    "preferredTransport": "JSONRPC",
    "skills": [{"id": "langchainagent-chat", "name": "LangChain agent chat", ...}],
    "securitySchemes": {"customerOAuth": {"oauth2": {...}}},
    ...
  }
  ```
  This is exactly what Privilege's "Discover A2A agent card" toggle needs —
  the registration's Backend URL is correct and reachable right now.

## The one open item: Auth Mode

The console's Remote Agent modal has an Auth Mode picker (Static Token / User
Token / Pass Agent Token / None) with a warning that an unset mode "behaves
as Static Token when an auth token is set, and as None otherwise." The
backend's `POST /a2a/jsonrpc` requires one of:
- a `txn-token` header — Privilege's own gateway workload token, validated by
  `validate_privilege_transaction_token()`
  (`langchain_agent/src/authentication/token_validator.py:52`), issued for
  the `PingGateway` audience, or
- a `Bearer` OAuth token from an allowlisted customer IdP (federated
  path — `A2A_TENANT_REGISTRY_JSON` / `FederatedTokenValidator`), not
  relevant for an in-mesh peer call.

**Corrected 2026-10-03 after a live test** (full write-up:
`privilege/GATEWAY-AGENT-TO-AGENT-A2A.md`). This section used to say "Pass
Agent Token" is Privilege forwarding its *own* workload token. It is not: the
gateway passes on the **caller's** workload identity and mints nothing.

- With "Pass Agent Token", a person signed in at the gateway is refused after
  policy passes — a bare 403, and the gateway log reads `app langchainagent
  requires token-pass, but this session presented no workload assertion`.
  Only a calling agent that holds a workload identity can use this mode.
- With "None", the call reaches the backend with no credential (the gateway
  never forwards the caller's sign-in token) and the handler answers
  `Bearer authentication required`.
- Still untested: a real agent-to-agent call under "Pass Agent Token", so it
  is not yet proven that the token arrives as `txn-token` or passes
  `validate_privilege_transaction_token()`. "User Token" and "Static Token"
  are untested too.

"Pass Agent Token" remains the right setting for agent callers and is what
the app is set to; it just cannot be exercised by a human caller.

## What's NOT built (out of scope unless asked)

Only the `/a2a/jsonrpc` `message/send` method is implemented — no streaming,
no push notifications (`capabilities.streaming`/`pushNotifications` both
`false` in the card, truthfully). That matches what's actually there; don't
build these speculatively.

## Related

- `standalone/hostile-a2a-agent/` — the unrelated red-team analog (a
  deliberately poisoned Agent Card + JSON-RPC stub used to test Privilege's
  Inter-Agent Abuse detector). Different purpose, same wire shape — useful as
  a second real-world example of the Agent Card / JSON-RPC pattern.
- `[[project-privilege-gateway-is-mcp-only-no-a2a]]` memory note — tracked
  the "MCP-only vs a2a" confusion and the (now resolved) open question of
  what wire protocol a Privilege Remote Agent needs to speak.
- `.claude/skills/a2a-protocol/` — this repo's general A2A compliance rules.
