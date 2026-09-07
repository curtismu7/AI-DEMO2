# PingOne MCP behind the Privilege AI Gateway — design

**Date:** 2026-09-07
**Status:** approved design, not yet planned or built
**Goal:** replace the hosted PingOne MCP server (`mcp.pingone.com`) with a form the
PingOne Privilege AI Gateway can front, matching its tool set as closely as possible.

---

## 1. Why the hosted server cannot be used

Established by protocol probe and source reading on 2026-09-07. Three independent
blockers; each alone is fatal.

### 1.1 Transport mismatch — the decisive one

The Privilege gateway's discovery client issues a bare `GET` and waits for an SSE
`endpoint` event. It never POSTs `initialize`
(`.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`). The hosted server serves
streamable HTTP only:

| Probe | Result |
|---|---|
| `GET https://mcp.pingone.com/admin/{env}/mcp` | `401` `application/json` |
| `GET https://mcp.pingone.com/admin/{env}/sse` | **`404 Not Found`** |

There is no SSE endpoint to discover. Registering the `/mcp` path instead produces
the documented failure: *"Gateway Unreachable — Error discovering MCP server:
calling initialize: Unauthorized"*, tools empty, policy creation disabled.

### 1.2 The 401 advertises no authorization server

The 401 is a bare AWS API Gateway body — `{"message":"Unauthorized"}`, with
`x-amzn-errortype: UnauthorizedException` — carrying **no `WWW-Authenticate`
header**. MCP's OAuth discovery requires `WWW-Authenticate: Bearer
resource_metadata="…"` on that response, so a spec-compliant client dead-ends at
the first step.

The RFC 9728 metadata *does* exist and is correct, but nothing points to it:

```
GET /.well-known/oauth-protected-resource/admin/{env}/mcp   → 200
{"resource":"https://mcp.pingone.com/admin/{env}/mcp",
 "authorization_servers":["https://auth.pingone.com/{env}/as"],
 "bearer_methods_supported":["header"],"scopes_supported":[]}
```

### 1.3 No dynamic client registration

The gateway registers dynamically — "everything discovers and registers
dynamically, no client id or secret is required". PingOne's AS offers neither
half of what that needs:

| Endpoint | Result |
|---|---|
| `auth.pingone.com/{env}/as/.well-known/oauth-authorization-server` (RFC 8414) | **`403` "Missing Authentication Token"** |
| `registration_endpoint` in `openid-configuration` (RFC 7591) | **absent** |

`openid-configuration` itself resolves and lists `client_credentials` among
`grant_types_supported`, which is what makes the chosen identity model possible.

---

## 2. Decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | Functional replacement of the hosted server | Not a governance showcase; match the hosted tool set |
| 2 | Identity: worker `client_credentials` | Actions attributed to the worker, not the human |
| 3 | Minimal additive patches, track upstream | Inherit new PingOne tools for free while in preview |
| 4 | Local Docker to build, SE cluster to demo | Two deploy paths, one image |
| 5 | Real GitHub fork, separate repo | `upstream` stays a git remote; rebase, not diff-and-patch |
| 6 | Both changes in the fork (not a sidecar bridge) | One container, one failure mode |
| 7 | Privilege is the perimeter; NetworkPolicy restricts ingress | Server is unauthenticated on the wire |

### Why a fork is unavoidable

Two independent reasons, either sufficient:

- **No `client_credentials`.** `internal/auth/grant_type.go` defines exactly
  `GrantTypeAuthorizationCode` and `GrantTypeDeviceCode`. A transport bridge
  cannot add a grant type.
- **`internal/` is import-blocked.** The tool implementations live under
  `internal/`, which Go forbids importing from another module, so "wrap upstream
  as a library" is not available.

### What the identity decision costs

Upstream is deliberately user-based: "All actions are user-based and auditable",
and tools inherit the authenticated **user's** roles. Under `client_credentials`:

- PingOne's audit log attributes every action to the worker application.
- Tool reach is the worker's roles, identical for every caller. Privilege policy
  becomes the only thing narrowing what a given agent may do.

This is coherent — Privilege is the policy layer — but it is a real departure from
upstream's model and must not be presented as preserving user attribution.

---

## 3. Architecture

### 3.1 Repository boundary

`curtismu7/pingone-mcp-server`, a GitHub fork of `pingidentity/pingone-mcp-server`
(Go, Apache 2.0, built on `github.com/modelcontextprotocol/go-sdk v1.2.0`), with
`upstream` configured as a git remote. Its own CI builds and pushes an image to
GHCR.

AI-DEMO2 contains **no Go source** from this fork. It references the image only,
as it does for other vendor images. Tracking upstream is
`git fetch upstream && git rebase <tag>`.

### 3.2 Fork changes — three areas, all additive

Defaults are unchanged: with no new flags, the binary behaves exactly as upstream.

**a. `internal/auth/grant_type.go`** — add `GrantTypeClientCredentials` to the
enum, plus its `String()` and `ParseGrantType()` cases.

**b. Auth path** — a client-credentials token source: POST to the PingOne AS token
endpoint, hold the access token in memory with its expiry, refresh ahead of
expiry. It bypasses the OS keychain and the token store entirely, because there is
no user session to persist and no browser to drive.

**c. `cmd/root.go`, `cmd/run`, `internal/server/server.go`** — a
`--transport {stdio|sse}` flag defaulting to `stdio`, and `--listen`.

The transport seam is already present: `NewCommand(… transport mcp.Transport …)`
→ `server.Start(ctx, version, transport, …)`, with `cmd/root.go:44` the sole
construction site (`&mcp.StdioTransport{}`, commented "Always run on stdio
transport").

**However** — `mcp.NewSSEHandler` returns an `http.Handler`, **not** an
`mcp.Transport`. So `Start()` cannot simply receive a different transport; it needs
a branch:

- `stdio` → today's `server.Run(ctx, transport)`
- `sse` → serve `mcp.NewSSEHandler(...)` over HTTP on `--listen`

The SDK's SSE handler matches the gateway's discovery behaviour exactly: sessions
are created when the client issues a GET, and the first event in the stream is the
`endpoint` event.

### 3.3 Configuration

Environment variables: PingOne environment ID, client ID, client secret, region.
No secret is baked into an image or committed. In the cluster the secret comes from
the namespace's existing secret mechanism, consistent with other services.

### 3.4 Data flow

```
agent
  → Privilege AI Gateway            policy decision
  → GET /sse                        bare GET; server emits `endpoint`; session opens
  → tool call
  → PingOne Management API          worker access token
  ← response                        back through the gateway
```

---

## 4. Deployment

**Local (build and iterate).** A compose service on an internal port, serving
`/sse`. Not published to the host — nothing on the host needs to reach it, and not
publishing keeps a credentialed admin surface off the host network.

**SE cluster (demo).** Deployment + Service in `ping-devops-cmuir`, pulling the
GHCR image. Registered in the Privilege console as an Agentic App with entry path
**`/sse`**.

`se-update-code.sh` is **not** the vehicle — it builds images from this repo, and
this image is built by the fork's CI. The k8s manifest pulls the published image.

---

## 5. Security posture

The server is **unauthenticated on the wire** and holds a worker credential with
PingOne admin rights. A NetworkPolicy restricting ingress to the gateway pod is the
only control in front of it: **anything that can reach the pod gets full tenant
admin.**

This is a deliberate consequence of decision 7 (Privilege is the perimeter), taken
because the gateway connects to backends without presenting a credential. It is
not an oversight, and it must be recorded in `REGRESSION_PLAN.md` §1 as a
do-not-break rather than left in a commit message:

- The NetworkPolicy is load-bearing, not hygiene. Removing it exposes tenant admin
  to anything in the namespace.
- The service must not be published to the host locally, nor given an ingress on
  the cluster.

**Open item to settle before build:** which PingOne admin roles the worker
actually needs. Least privilege for the demo's tool set, not blanket admin. The
roles chosen directly bound the blast radius above.

---

## 6. Error handling

- **Worker token acquisition fails at startup** → exit non-zero naming the reason.
  Do not start and appear healthy with every tool broken; a container that is Ready
  but cannot authenticate is the failure mode hardest to diagnose from the console.
- **Token expiry mid-session** → refresh transparently. On repeated failure, return
  an MCP error rather than hanging; a hung session shows in the gateway as an
  unexplained timeout.
- **PingOne API errors** → pass upstream's existing error shapes through unchanged.
  Do not invent a new shape.

---

## 7. Testing

**Fork (Go).**
- Unit tests for `GrantTypeClientCredentials`: `String()` and `ParseGrantType()`
  round-trip, and that an unknown string still errors.
- Token source: acquires, caches, refreshes before expiry, and surfaces a failure
  rather than returning an empty token.
- **Upstream's existing suite stays green.** That green is the proof the patches
  are additive; it is a required check, not a courtesy.

**Local integration.**
- A scripted MCP client against `/sse` asserting `initialize` succeeds and
  `tools/list` returns real PingOne tools — following the existing `facade-e2e`
  pattern in this repo.
- A bare `GET /sse` receives an `endpoint` event as its first event. This is the
  precise behaviour the gateway depends on, so it is asserted directly rather than
  inferred from a working client.

**Live (SE).**
- Register as an Agentic App; confirm **tools populate in the Privilege console**.
  Tools stay empty until discovery succeeds, so a populated tool list is a genuine
  assertion.
- One policy-permitted tool call end to end, and one policy-denied call, so the
  gateway is shown deciding rather than merely forwarding.

---

## 8. Risks

| Risk | Note |
|---|---|
| Upstream is public preview | It may move under us; additive patches and a green upstream suite are the mitigation |
| Worker credential in-cluster | Privileged; bounded only by roles chosen (§5 open item) and the NetworkPolicy |
| Gateway is `/sse`-only | Same constraint #2898 raised with Ping. This design works either way, but if Ping adds `/mcp` support the transport choice is worth revisiting |
| Audit attribution | Every action shows the worker, not the human. Must not be demoed as user attribution |

---

## 9. Out of scope

- Preserving per-user identity (Device Code or RFC 8693 token exchange) — evaluated
  and rejected for this iteration under decision 2.
- Adding, removing or reshaping tools — decision 3 keeps the fork additive.
- Changing the gateway's `/sse`-only discovery, which is Ping's to answer.
