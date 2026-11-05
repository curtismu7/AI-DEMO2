# Troubleshooting — symptom/cause/fix table

Referenced from SKILL.md §Troubleshooting.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Proxy exits immediately, no logs | Missing/invalid `proxy-config.data` and no `ENV_PROXY_TOKEN` | Provide enrollment token |
| "not found" on enrollment (500) | Token's `nodeId` was deleted from the gateway in the Privilege console | Go to console → Gateways → Add Node to generate a token for a *new* node; if the gateway itself is gone, recreate it |
| Proxy starts then drops with `token expired` or silent reconnect loop | `ENV_PROXY_TOKEN` JWT `exp` claim is in the past | Get a fresh token from the console (see below) |
| "No Tools, Prompts, or Resources Discovered" in console | Proxy can't reach MCP server (mTLS blocks, wrong URL, wrong port) | Clear `MCP_MTLS_ON` in the root `.env`; set MCP Server URL to `http://mcp-server:8080/mcp` (compose DNS — the proxy shares that network) |
| 401 "User is not authorized" from MCP | User has no Privilege policy for the MCP app | Assign policy in Privilege console (requires discovery first) |
| 401 "Unsupported authentication method" on token exchange | Missing `client_secret` in POST body | Ensure `PINGONE_MCP_GATEWAY_CLIENT_SECRET` is set |
| redirect_uri mismatch | BFF detects wrong host (Docker internal hostname) | Set `PRIVILEGE_MCP_CALLBACK_HOST` or ensure `x-forwarded-host` passes through |
| Session not persisting between requests | Session cookie not sent / saveUninitialized | Use browser (cookies auto-sent), or pass `Cookie` header in curl |
| curl to MCP server gets "Empty reply" | mTLS enabled — server drops non-cert connections | Disable mTLS or provide gateway client cert |
| gRPC `UNAVAILABLE` / proxy silent hang | Firewall blocking outbound to `grpc.privilege.pingone.com:443` | Allow outbound 443; no inbound holes needed |
| `IssuerPublicKey:[]` in proxy logs | The gateway compares the token's `kid` with `infra-root-jwt`, a key it fetches from Privilege's internal Notary PKI. No PingOne credential can match | ⚠️ **Not fixable from here — stop.** `IssuerPublicKey` belongs to `OidcServer` (`cyctl` gives `get`/`list` only), not to the Application. Setting `--spec-mcp-app-config-resource-o-auth-*` was tried live and changed nothing — that field is the *outbound* challenge + DCR config. Use a **console** token, whose `kid` does match. See `privilege/PRIVILEGE-MCP.md` §2026-08-11 |
| `code_challenge is required` from PingOne | App `deff60f5` enforces `pkceEnforcement: S256_REQUIRED` | Set `--spec-mcp-app-config-resource-o-auth-use-pkce`; it is mandatory, not optional |
| `unexpected signing method: RS256` / `ES256` from `cyctl` | `cyctl` wants an HS256 console session token; it rejects PingOne (RS256) and proxy (ES256) tokens on algorithm alone | Grab `Authorization: Bearer …` from a console XHR. `cyctl token jwt` cannot bootstrap — it requires a token itself |
| `curl https://…:8623/mcp` fails to connect (`mcpgw`, current binary) | Are you sure this is the current binary? On `mcpgw` 8623 IS the correct frontend — a connection failure here means something else (container down, wrong host) | Check the container is up before assuming the port is wrong. (On the previous binary, `cyonproxy`, this row's original advice — 8623 is mesh/mTLS-only, use 8620 — was correct; it is not for `mcpgw`.) |
| `has same NodeURL - this happens because of misconfigured Node` | Two node registrations claim the same `NodeURL local.ping-devops.com:8690` — the live node is linking to a stale twin of itself | **Cosmetic — ignore.** Command streams stay up and discovery still dispatches. The console offers no way to delete the stale row. Avoid making it worse: do not enroll a second node on the same Host IP |
| BFF gets `UND_ERR_SOCKET` / connection refused to the gateway | Pointing at a port that accepts TCP but serves no MCP | Use `8623` on `mcpgw` (see "Proxy ports"; was 8620 on the previous binary) |
| nginx returns a bare `502`, body says nothing | On `mcpgw`, upstream is likely `8680` (mesh, mTLS) instead of `8623`. Check the nginx error log for `tlsv13 alert certificate required` | Point the upstream at `http://…:8623` |
| `401 Bearer Token not found.` | Normal — the gateway with no token. This is the **success** signal for "am I on the right port" | Nothing to fix |
| `Domain not found` in the proxy log, **empty `200`** to the client | `Host` is not the Frontend Name registered on the application object. Reads like a broken backend; it is the gateway matching no application | Rewrite `Host` — nginx `map $host $mcpgw_frontend`, k8s `upstream-vhost`. See "The nginx front door" |
| Host tried matches what the console shows, still `Domain not found` | The console UI displays a different domain than the object holds (`…privilege.pingone.com` vs `…procyon.ai`) | Read `FrontEndName.Elems` from the console applications API, never from the UI |
| `403 User <id> doesn't have access to MCP app <name>` | **Progress, not a regression.** Auth passed and routing matched; Privilege is enforcing policy | Author a policy binding that user to that MCP application resource |
| A previously working call goes back to `403 … doesn't have access` | Console policies can be created **time-boxed** (1h, 2h). An expired policy fails exactly like a missing one | Check the policy is still live before debugging anything else |
| `401` with **no** `WWW-Authenticate` header, on `mcpgw` (current binary) | Unexpected — the binary should emit one (confirmed live on another cluster). Check `-mcpconfpath`/`pingone.env` are actually mounted and readable; a crash-looped container answering through a stale connection can look like this too | Verify the container is actually running `mcpgw`, not a leftover `cyonproxy` container. Our local `cyonproxy` enrollment never emitted this header; that is a fact about that build, not about whether OAuth works on the AI Gateway (it does — see "Read this first" item 0) |
| A bare `401 Bearer Token not found.` treated as proof of routing | On `cyonproxy`'s `:8620` the bearer check ran **before** host evaluation — `garbage.nowhere.example.com` returned the same 401 (verified 2026-08-10). Not re-verified on `mcpgw`'s `:8623` | Only a request carrying a token exercises routing. Do not use a tokenless 401 as a routing signal, on either binary |
| `cyctl` fails in ways that look like auth errors | `--apigw` pointed at `https://privilege.pingone.com` — the data-plane host | Use `https://console.privilege.pingone.com` |
| `401 User is not authorized` on a console-API write | Object ownership, **not** header shape. Application objects do not list the console user under `WrOwners.ObjectRef`; `/v1/userpreferences/...` does, which is why one PUT succeeds and the rest 401 | The API is list + create only for these objects. Copying the working PUT's headers does not help — that was tried |
| Server crash: `EACCES: permission denied, mkdir './dev-data'` | Dev mode needs writable dir but container runs as non-root (uid 1001) | Add `tmpfs: /app/dev-data:uid=1001,gid=1001` to docker-compose.yml |
| Server crash: `Configuration validation failed` | `SKIP_TOKEN_SIGNATURE_VALIDATION=true` forbidden outside development | Set `NODE_ENV: development` in docker-compose.yml for the mcp-server service |
| Cloud API 400: "mcp-protocol-version header is required" | Non-initialize requests need protocol version header | BFF's fetchMcp adds `mcp-protocol-version: 2024-11-05` for non-initialize requests |
| Discovery succeeds but tool calls return empty | MCP server behind PingGateway, not directly reachable | MCP App config → set MCP Server URL to the **internal** URL (`http://mcp-server:8080/mcp`), not the gateway URL |
| 401 despite policy being set | Using main app's SSO token (wrong `aud` claim) | User must click "Sign In with Privilege" to get a token from the Privilege SSO client |

