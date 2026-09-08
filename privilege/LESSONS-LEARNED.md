# Privilege AI Gateway — lessons learned

Non-obvious, repeat-cost behavior discovered building and operating the
`pingone-admin-local` Agentic App (`demo_mcp_pingone/`) and its predecessors
(2026-09-07/08). Every entry below cost real debugging time at least once —
some of them twice, because the first fix didn't stick. This is a companion to
`.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` (deploy mechanics) and
`demo_mcp_pingone/README.md` (this integration's specific setup) — read those
for procedure; read this for what will surprise you.

## Policy authoring

### Policies UNION. Nothing about the console suggests this.

Creating a new policy on an app does **not** replace the effective grant — it
**adds to** whatever else already applies to that identity, including policies
attached via group membership. Editing a policy's tool list down to 4 tools
while an earlier, broader policy is still live leaves the identity with the
union of both.

**The tell** is in the gateway's `[mcpfilter] cap header` log line — a real
capture from this investigation:

```
["create_oidc_application","list_populations","update_population",
 "create_oidc_application","list_populations","list_applications",
 "create_population","get_application","get_application","get_population",
 "list_applications","list_populations"]
```

12 entries, heavy duplication (`create_oidc_application` ×2, `list_populations`
×3, `get_application` ×2). A single policy never produces duplicates — this is
the union of at least three. One user session went through three separate
"fix the policy" rounds before this log line made the actual mechanism visible;
every prior round *added* a policy instead of replacing one.

**How to check:** make one call, then

```bash
kubectl --context us -n ping-devops-curtismuir logs deploy/agentless-mcpgw -c log-tailer --tail=4000 \
  | grep -A1 '"\[mcpfilter\] cap header'
```

Repeated tool names in that array mean more than one policy is contributing.
**The fix is deletion, not another edit** — go to the app's policy list and
remove every policy except the one you want, rather than creating a fourth.

### A new Agentic App starts with zero policies — which means deny-all

Not "default permit," not "inherits a sibling's policy." A freshly registered
app denies every call until a policy exists. If a door was reachable minutes
ago and now 403s on everything with no config change, check whether the app
was recreated (deleting and re-adding an app, as opposed to editing one,
resets this).

### Two denial reasons look identical to a client — only the gateway log tells them apart

The client always renders a policy refusal as a bare `403 Forbidden`. The
gateway log has two distinct lines with different fixes:

| Log line | Meaning | Fix |
|---|---|---|
| `policy denied … : user not found in system` | identity never synced into Privilege | fix the group membership policy / user sync, not the Agentic App policy |
| `policy denied … : Access Denied for` | identity **is** synced; no policy on **this app** covers them | author or fix the policy on this app |

```bash
kubectl --context us -n ping-devops-curtismuir logs deploy/agentless-mcpgw -c log-tailer --tail=200 \
  | grep -E 'identity resolved|policy denied'
```

`✅ User identity resolved: … Email=` with an empty email is **cosmetic** —
true for identities whose policy works fine too. Don't chase it.

### The identity to grant is ground truth from the gateway, never the console login

The Privilege console session you author policy in is a **different identity**
from whoever the gateway resolves for an actual MCP call. Granting your own
console account by reflex grants the wrong principal.

```bash
kubectl --context us -n ping-devops-curtismuir logs deploy/agentless-mcpgw -c log-tailer --tail=4000 \
  | grep -oE "Request is for user: [^\"]*"
# -> User/<privilege-tenant>/default/<user-id>
```

That `<user-id>` — not an email, not the console account — is what a policy
principal must name. It is derived from whichever identity the demo's SSO
login (`PRIVILEGE_SSO_ENV_ID` / `PRIVILEGE_LOGIN_HINT`) federates into
Privilege, which can differ from the persona you expect if the login hint or
SSO env changes.

### Policies are per-app and time-boxed

A policy on one Agentic App has no effect on a sibling app, even one running
identical code — `opensearch` and `opensearch22` need separate policies.
Policies also expire; an expired one denies **identically** to a missing one,
with nothing in the client response to distinguish the two. Check the window
before assuming a policy edit didn't take.

## The gateway's entry-path pinning

### One app, one client-facing path — set by whatever the backend was registered with, and it can silently flip

The AI Gateway pins each Agentic App to exactly one path (`/mcp` or `/sse`),
derived from the app's Backend Name at registration time. Editing Backend Name
in the console **changes the client-facing path for every caller** — this
project watched it flip from `/sse` to `/mcp` mid-session on 2026-09-08 from a
single console edit, breaking every client pointed at the old path with no
warning.

It only takes effect after the gateway restarts and re-runs discovery — so an
edit that "did nothing" may just be waiting for a restart.

### The 404 arrives AFTER authentication — don't debug it as an auth problem

Calling the wrong path gets a normal `401` challenge with **no bearer** (the
door looks healthy), and a `404 Not found` **with a valid bearer** once
authenticated. The 401-then-404 sequence reads exactly like "auth is broken
somewhere downstream" and is not — it is purely a path mismatch. The only
place that says so:

```
[mcpgw] rejecting /mcp on app <name>: outside entry path "/sse"
```

```bash
kubectl --context us -n ping-devops-curtismuir logs deploy/agentless-mcpgw -c log-tailer --tail=2000 \
  | grep -oE 'rejecting /[a-z]+ on app [a-z0-9-]+: outside entry path "[^"]*"'
```

### The console's own generated client config can be wrong

The "MCP Config" snippet the console displays for an app always shows `/mcp`,
regardless of what path is actually registered and enforced. If the app is
currently pinned to `/sse`, pasting that snippet into a client produces the
exact 404-after-auth trap above. **Verify the live entry path with a probe,
never trust the console-rendered snippet.**

### Registering the backend as `/mcp` normally breaks discovery — unless your backend answers both

The gateway's discovery client issues a bare `GET` and waits for an SSE
`endpoint` event; it never POSTs `initialize`. A plain streamable-HTTP server
answers `GET /mcp` with `200` but never emits that event, so discovery fails
outright: `Gateway Unreachable — calling "initialize": Unauthorized`, the app
gets no tools and policy creation is disabled.

`demo_mcp_pingone/server.js` and `demo_mcp_brave/server.js` sidestep this by
answering the SSE handshake on **both** `/sse` and `/mcp`. That makes the
Backend Name a genuinely free choice for those two servers — pick `/mcp`, since
it is what the console's generated config and door-discovery report. It is
**not** free for every server: `opensearch22`'s backend is the OpenSearch MCP
server itself, not one of these bridges, and may only speak the handshake on
one path. Don't assume the fix transfers without testing it separately.

### The gateway does not follow the SSE spec's "POST to the announced endpoint" pattern

Standard SSE transport: `GET` opens a stream and the server announces
`event: endpoint\ndata: /messages?sessionId=…` — the client is supposed to POST
JSON-RPC there, not back to the original path. The gateway does not do this —
it POSTs to **the same path it was registered with**. An app registered on
`/sse` receives its JSON-RPC POSTs on `/sse`, not on `/messages?sessionId=…`.
A backend that only implements `POST /messages` (correct per spec) gets its
own 404 for every real call, indistinguishable from the entry-path trap above
except that it comes from your own server rather than the gateway. Handle
`POST` on the registered path itself, not just `GET`.

### `server/discover` is a gateway extension, not part of MCP

The gateway issues `server/discover` to enumerate a backend's tools for policy
authoring. It is not in the MCP spec, and a compliant backend correctly
answers `JSON RPC not handled: "server/discover" unsupported`. Forwarding that
error to the gateway breaks the session for every subsequent call on that
connection — a backend fronting a third-party MCP server needs to intercept
`server/discover` itself and answer with the tool inventory (e.g. by internally
calling its own `tools/list`), not pass it through.

## Client registration (well-known clients, DCR)

### The DCR client registry is in memory — every gateway restart forgets it

A restart resets every dynamically-registered client. The next `/authorize`
shows a bare `Unknown client` page. This demo's own BFF detects and
re-registers automatically (`isDcrClientStillKnown` in
`privilegeMcpClient.js`); any external client (LM Studio, Inspector) that
cached its registration must be deleted and re-added by hand after a restart.

### A "works in one client" well-known client can be the wrong credential type for another

`pingone-mcp-server` — the literal client id PingOne's hosted MCP server
documents, not a per-tenant UUID — is valid across every environment and will
happily start a login flow for any redirect URI you throw at `/authorize`.
That is misleading: `/authorize` renders the login page **before** validating
the redirect URI. **PAR validates it properly.** Pushing the same request
through `/as/par` revealed the client accepts loopback redirects only
(`http://localhost:*/callback`, `http://127.0.0.1:*/callback`) and rejects
both `https://` and any non-loopback host — the RFC 8252 native-app pattern.

**Lesson: never conclude a redirect URI is accepted from an `/authorize`
response alone.** Push it through PAR (or complete the full code exchange) —
a login page is not proof of validation.

Practical consequence: a server-side web app (this demo's BFF) cannot use a
loopback-only client at all, regardless of how well it works from a CLI tool
sitting on the operator's own machine.

## Building a client from zero (no prior registration, no BFF) — `ai-gateway-client`, 2026-09-08

Everything above was learned authoring policy and running the gateway. This
section is the mirror image: what a brand-new, previously-unseen client
discovers hitting the AI Gateway cold, extracted while building
[`ai-gateway-client`](https://github.com/curtismu7/ai-gateway-client) — a
standalone OAuth PKCE + DCR test client with no BFF, no session, no worker
credentials, verified against the real public gateway
(`mcpgw.ai-demo.ping-devops.com`).

### RFC 9728 discovery needs a POST with a real JSON-RPC body — a GET gets a plain 405 with no challenge at all

The instinct is to probe a door with `GET /opensearch22/mcp` to see what
happens. That gets a bare `405`, no `WWW-Authenticate` header, nothing to
chain discovery off. The challenge only appears on a `POST` carrying a
plausible JSON-RPC request:

```bash
curl -s -D - -o /dev/null https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp \
  -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"discovery","method":"tools/list","params":{}}'
# www-authenticate: Bearer scope="mcp:invoke", resource_metadata="https://.../.well-known/oauth-protected-resource"
```

Same trap exists one layer down: the protected-resource document's
`authorization_servers[0]` points at an AS whose own
`.well-known/oauth-authorization-server` you then have to fetch separately —
three network hops (probe → resource metadata → AS metadata) before you have
an `authorization_endpoint` to redirect a browser to. A client that stops
after the first 401 concludes the door is broken rather than merely
unauthenticated.

### DCR against the AI Gateway works cold, from a client it has never seen, no prior setup — verified live

`POST /<app>/register` with no client secret and
`token_endpoint_auth_method: "none"` returns a real, usable `client_id` in
one call, no console step, no coordination with whoever owns the environment:

```bash
curl -s -X POST http://127.0.0.1:3910/api/gateway/auth/start -d '{}'
# {"authUrl":"https://mcpgw.ai-demo.ping-devops.com/opensearch22/authorize?
#   client_id=e9UwED-wTocSrJduDaVmSolu5ZV7Z9bb&response_type=code&
#   code_challenge=...&redirect_uri=http://127.0.0.1:3910/api/gateway/auth/callback&..."}
```

That `client_id` was minted milliseconds earlier, for a redirect URI the
gateway had never heard of before that call. Combined with the "DCR registry
is in memory" lesson above: a client built this way needs **no bootstrap
step at all** as long as it re-registers whenever the liveness probe fails —
see the next entry for how to detect that without an introspection endpoint.

### Detecting a forgotten DCR registration without an introspection endpoint: the liveness-probe pattern

The existing lesson above ("DCR registry is in memory — every restart
forgets it") names the failure; this is the actual detection technique,
ported into `ai-gateway-client` from this demo's own BFF
(`isDcrClientStillKnown` in `privilegeMcpClient.js`). There is no "is my
registration still alive" endpoint, so probe indirectly: POST a
deliberately-invalid authorization code to the token endpoint and read which
way it's rejected.

```text
401 / invalid_client  -> the client is gone; re-register
400 / invalid_grant    -> the client is fine, only the fake code was bad
```

The secret **must** be sent when the client is confidential — an
unauthenticated probe against a confidential client answers the same `401`
as a client that no longer exists at all, so a probe that omits it reports
every real, working confidential client as forgotten. `ai-gateway-client`'s
doors are all public/PKCE (`none` auth method), so this doesn't bite there,
but it's the reason the original probe takes the secret as a parameter — a
future door that isn't public-client would silently misreport without it.

### The demo's own façade is *also* a self-advertising, open-DCR broker — not just internal plumbing

`ai-demo.ping-devops.com/mcp-facade/{opensearch,brave}/mcp` (the "no
Privilege in the path" comparison door) answers the same RFC 9728 challenge
shape as the real gateway, pointing at an AS the demo runs at its own
origin:

```bash
curl -s https://ai-demo.ping-devops.com/mcp-facade/opensearch/.well-known/oauth-protected-resource
# {"authorization_servers":["https://ai-demo.ping-devops.com"]}
curl -s https://ai-demo.ping-devops.com/.well-known/oauth-authorization-server
# {"registration_endpoint":"https://ai-demo.ping-devops.com/oauth/register",
#  "token_endpoint_auth_methods_supported":["none"], ...}
```

`token_endpoint_auth_methods_supported: ["none"]` on an **open**
`registration_endpoint` means literally any external caller can dynamically
register and mint a `mcp:invoke`-scoped token against these doors with zero
coordination — the same generic RFC 9728/DCR path that talks to the real
Privilege gateway needed no special-casing to also talk to this broker
(confirmed by removing this demo's own broker-specific client-id
special-case from `ai-gateway-client` entirely — the generic path still
works, because it never needed to be generic-*plus*-a-special-case in the
first place). Worth knowing both ways: it's what makes the standalone
Direct-mode default work with zero setup, and it's a genuinely public
self-service OAuth AS sitting at the demo's own root origin, not merely an
implementation detail of how the BFF happens to reach the façade internally.

### Most of what looked essential to talking to Privilege wasn't

`demo_api_server/routes/privilegeMcpClient.js` is ~2,900 lines. The
standalone extraction that talks to the *same* real gateway, does the *same*
RFC 9728/8414 discovery, the *same* DCR-with-liveness-probe, the *same*
tools/list+call relay, is about a third of that with zero loss of
correctness (verified: real DCR client issued, real PKCE redirect, real
tools/list against live doors). What didn't survive the cut: Docker-network
internal/external URL rewriting, this demo's own banking- and
pingone-admin-specific doors, a "Façade" mode that exists to keep a
standalone MCP client's registration alive across a gateway restart (which
needs hosting infrastructure a standalone tool doesn't have), and an
entirely separate LLM-call-policy comparison feature bolted onto the same
route file. None of that is what makes Privilege work — it's what makes
*this specific demo* work. If a change to Privilege integration code feels
like it should be simple but the diff keeps growing, checking whether the
growth is in that essential core or in this-repo's-own plumbing is worth
doing before assuming the gateway itself got more complicated.

## Hosted vs. self-hosted PingOne MCP — two different auth models

Two servers, easy to conflate because they answer to the same product name:

| | Hosted (`mcp.pingone.com`) | Self-hosted (`pingone-mcp-server` binary, this repo's sidecar) |
|---|---|---|
| Auth | user authorization_code + RFC 8693 token exchange — **no worker token accepted** | worker `client_credentials` (on the platform that honours it — see below) |
| Roles | ride the signed-in user's PingOne roles | static machine identity; per-user access must come from Privilege policy instead |
| Prerequisite | environment must have **MCP Access enabled** (console-only per-environment toggle, not visible via any API) **and** define a PingOne Resource whose audience matches `https://mcp.pingone.com/admin/{envId}/mcp` | none beyond a worker app |

A worker token minted with `resource=https://mcp.pingone.com/...` against an
environment lacking that resource is **silently accepted and silently wrong**
— PingOne mints `aud: ["https://api.pingone.com"]` instead of erroring, and
the hosted MCP server then rejects it with a generic `401 Invalid
authentication` that reads as a credentials problem and is actually a missing
per-environment resource. Confirmed by testing the same worker token, same
client, same code path against two environments: the one with no MCP-audience
resource always fell back to `api.pingone.com`; there was no error to detect
the fallback earlier.

Practical upshot: "it works in Claude Code" is not evidence it will work from
a server-side app, and not evidence a given environment is configured for it
— check which environment the working client actually targets before
assuming the behavior transfers.

## Related

- `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` — deploy mechanics, the
  `helm upgrade` sequencing this doc assumes, `extraContainers` list-replacement
  trap, SSE-vs-streamable-HTTP backend registration
- `demo_mcp_pingone/README.md` — this app's specific auth workaround
  (client_credentials ignored on the Linux build), tool curation, and the
  session-minting design that follows from the hosted-vs-self-hosted split above
- [`ai-gateway-client`](https://github.com/curtismu7/ai-gateway-client) —
  standalone client behind the "Building a client from zero" section above;
  `server/lib/relay.js` is the ~700-line essential core (discovery, DCR,
  liveness probe, relay) with the this-demo-specific plumbing already
  stripped out
