# MCP resource server decision log spec

**Status:** built (review findings applied) (owner, 2026-11-22: shapes the shared panel reads; every decision, on by default; code + PR + deploy in one run)   **Owner:** Curtis

## Goal
`demo_mcp_resource_server` (the SE-cluster Service `mcp-resource-server`, port 8081, the backend behind the Privilege door `testobo`) logs only startup lines today. It must write one timestamped stdout line per authorization decision, so the "resource server" layer of a run (rule 27, the OBO video's observability slide) has real log lines to show, and so a refusal is visible somewhere other than the HTTP reply.

## Line shapes (the shapes the shared `run-observability` panel already reads)
All lines: `[<ISO-8601 UTC>] <LEVEL>: <message>`, one line each, no newline in any value, nothing longer than 400 characters.

| Event | Level | Message |
|---|---|---|
| Token passed signature, expiry and audience | INFO | `token audience validated method=<m> sub=<sub> client=<client_id or -> act=<act.sub or -> actprior=<act.act.sub or -> scope="<scopes, comma separated>"` |
| The gateway's static token accepted (a shared secret: no audience check, no person) | INFO | `token accepted method=<m> kind=gateway-static sub=- scope="<scopes>"` (never "audience validated") |
| Token failed | WARN | `token validation failed ...` (bad signature or malformed), `token expired ...`, or `audience mismatch ...`, then `method=<m> reason=<TokenError code>` (the code, never the message: the message can carry claim values) |
| No bearer (POST `/mcp`, POST `/messages`, a WebSocket connect) | WARN | `unauthorized method=<JSON-RPC method, or ws-connect> path=<request path, no query string> reason=no bearer token` |
| Tool not registered | WARN | `tool call denied tool=<name or -> reason=unknown tool sub=<sub>` |
| Token lacks the tool's scope | WARN | `insufficient scope tool=<name> required="<scopes>" sub=<sub>` |
| Tool ran | INFO | `Tool <name> called` (exactly this, so the panel reads it as served) |
| Tool threw | ERROR | `tool call failed tool=<name> sub=<sub>` (the panel has no matcher for it: it is a log line, not a row) |

Never logged: the token, any claim value other than `sub`, `client_id`, `act.sub`, `act.act.sub`, `scope`, an error message (only its code), tool arguments, results. Field values keep only `A-Za-z0-9._:/@+<>,*-`; a JWT-shaped run (`eyJ...`, whole or in part) becomes `<jwt>`.

## Acceptance criteria (each one a check in `tests/decisionLog.test.ts`)
1. A call to `whoami` with a token carrying `sub`, `client_id`, `act: { sub: G, act: { sub: A } }`, scope `whoami:read` logs `token audience validated` with those ids, then `Tool whoami called`.
2. A call whose token lacks the scope logs `insufficient scope tool=whoami required="whoami:read"` at WARN and the HTTP reply is still 403 (behaviour unchanged).
3. An expired token, a wrong-audience token and a malformed token each log one WARN line starting `token expired`, `audience mismatch`, `token validation failed`; HTTP reply still 401.
4. `POST /mcp` with no bearer logs `unauthorized method=tools/call path=/mcp ...` and replies 401 as before; a WebSocket connect with no bearer logs `unauthorized method=ws-connect ...` and closes 4001 as before; a valid call over WebSocket logs once, not twice.
5. An unknown tool name logs `tool call denied`; the tool name in the line is only written when it is a registered tool (a request-supplied name is replaced by `-`), so request text cannot forge a field.
6. Hostile input: a `sub`, `client_id`, scope or error text holding newlines, quotes, `key=value` pairs or a JWT-shaped string yields exactly one line and no unmasked JWT.
7. Every line the server writes for the cases above is read by the shared panel's own matchers as the expected row (`mcp-server-validation`, `mcp-server-refused`, `mcp-server-served`), and the `tool call failed` and startup lines are read as nothing (the matcher source is copied into the test as a pinned list of patterns, not imported across repositories).
8. `MCP_RESOURCE_SERVER_DECISION_LOG=false` (or `0`, `off`) writes no decision line; unset or any other value writes them (default ON).
9. A failing log sink, a throwing `console` method, or a claim shape that makes a log message throw never changes an MCP reply (a 200 stays a 200, a 403 a 403).
10. The gateway static token logs `token accepted ... kind=gateway-static`, not `audience validated`; `completion/complete` token failures are logged like every other method; a tool that throws logs `tool call failed` through the server; a JWT or a piece of one in any claim is never written and a 5000-repeat `eyJ` run is handled in bounded time.

## Unhappy paths
- Log volume: one to two short lines per request, no payload; no sampling needed for a demo server. The flag turns it off.
- `act` absent, `client_id` absent, static gateway token (`sub` empty): the fields read `-`; nothing throws.
- Dependency down (JWKS unreachable): unchanged behaviour (fail closed when JWKS is configured); the failure is logged as `token validation failed`.
- Concurrent requests: each line is written with one `console` call, so lines never interleave inside a line.

## Out of scope
Changing any token, audience, scope or transport behaviour; request or response bodies in logs; log shipping (the collector reads container stdout already); the standalone `mcp-resource-server` repository (a different codebase that does not serve `testobo`); the other AI-DEMO2 services; a metrics change.

## Protected / must not break
Audience validation, the per-tool scope gate, 401/403 mapping and `WWW-Authenticate` headers, `tools/list` filtering, the gateway static-token path, OpenTelemetry and metrics wiring, every existing test in `demo_mcp_resource_server/tests`.

## Verification plan
- Tests: `tests/decisionLog.test.ts` (new), the whole `demo_mcp_resource_server` jest run, `tsc --noEmit`, the repo's `npm run ci:local`. Each new test is shown failing without its change (revert, red, restore).
- Independent `/code-review` of the diff before merge.
- Live (only after the owner's go, which this run already has for the roll): build the image, roll `mcp-resource-server` in the SE cluster, make one real `whoami` call and one made-up-token call through the `testobo` door, read `kubectl logs` for the lines and check they carry this run's ids. A line count above zero is not enough: each expected line is checked by content.
