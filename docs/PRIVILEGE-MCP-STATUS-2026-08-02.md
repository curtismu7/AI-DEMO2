# Privilege MCP — status handoff, 2026-08-02

Written for the next agent picking this up. Everything below was verified live against
the running stack on this date unless marked otherwise. Where an earlier belief turned
out to be wrong, it is recorded as wrong — several hours were lost to conclusions that
sounded right and were not.

## Where this stands in one paragraph

The Privilege MCP demo is wired end to end except for one thing: the Privilege gateway
rejects PingOne-issued JWTs with `JWT signature validation failed`. The MCP Server
application exists in the Privilege console, its tools are discovered, its backend is
reachable and returns `200`, the proxy is enrolled and holding a live control-plane
link, and the BFF points at the right endpoint. What has **not** been tested is the
interactive `authorization_code` sign-in at `/privilege-mcp-client` — that path may
validate via `/userinfo` instead of JWT signature, and if so the demo may already work.
**Test that first.** It costs one browser sign-in and could close this out.

## What is verified working

| Component | Evidence |
|---|---|
| Proxy enrolled + linked | node `e40f4540-ac21-47f4-bfc0-47a41adb8022`, cluster `ai-demo-se`, `RestartCount=0`, control-plane stream established |
| MCP Server app exists | console app `mypingone`, type MCP, Mesh Cluster `ai-demo-se`, created 2026-07-31 |
| Tool discovery succeeded | console lists the Banking MCP Server's tools (`get_my_accounts`, `get_account_balance`, `search_transactions`, …) |
| Backend reachable | `POST http://localhost:8080/mcp` → `200`, `serverInfo.name = "Banking MCP Server"` |
| BFF endpoint correct | `GET /api/privilege-mcp/state` → `mcpUrl = https://mypingone-app-default.applications.privilege.pingone.com:8643/mcp` |
| Frontend is live | `POST` to that URL returns a real `401`, not a connection failure |

## The actual blocker

Privilege parses the bearer token and fails signature verification:

```
no token           -> 401  "Bearer Token not found."
valid PingOne JWT  -> 401  "Authorization header JWT parsing failed JWT signature validation failed"
```

The token is not the problem. Verified:

```
issuer    https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as
jwks_uri  https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/jwks   -> 200
kids in JWKS   default, 5cbc7d60-…, 5cb30780-…, 6d167f20-…
token header   {"alg":"RS256","kid":"default"}      <- present in that JWKS
```

Well-formed RS256 token, signed with a key PingOne publishes at a reachable URL, `kid`
matches. Privilege has not been told the issuer, so it has no key to check against.
This is the `IssuerPublicKey:[]` condition seen in older proxy logs, now stated
explicitly by the gateway rather than inferred.

**Caveat before chasing this:** the test token was minted with `scope=mcp:invoke`, which
yields `aud: mcpserver.ping.demo` — the demo's own audience, not Privilege's. Even with
JWKS configured, Privilege may then reject on audience. Signature is the first gate;
passing it does not guarantee the second. See "Known dead end" below.

## How to reproduce the blocker

`client_credentials` on the Privilege SSO app needs a **single-resource** scope. Without
one it fails at the token endpoint, which is easy to misread as a broken client:

```bash
ENVID=01d89b06-66d5-430e-9f28-65636843788b
CID=$(docker exec ai-demo-api-server printenv PRIVILEGE_SSO_CLIENT_ID)
CS=$(docker exec ai-demo-api-server printenv PRIVILEGE_SSO_CLIENT_SECRET)

# no scope    -> 400 invalid_scope "May not request scopes for multiple resources"
# scope=openid -> 400 invalid_scope "At least one scope must be granted"
# scope=mcp:invoke -> mints, aud=mcpserver.ping.demo
TOK=$(curl -s -X POST "https://auth.pingone.com/$ENVID/as/token" \
  -d grant_type=client_credentials -d "scope=mcp:invoke" \
  -d "client_id=$CID" -d "client_secret=$CS" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST "https://mypingone-app-default.applications.privilege.pingone.com:8643/mcp" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# -> 401 Authorization header JWT parsing failed JWT signature validation failed
```

The app `6586d3de` holds **3 grants across 3 resources** (`Demo MCP JWT Verifier`,
`Demo MCP Invest`, `Demo MCP Server`), which is why a scopeless request is refused.
Read grants with the worker credential — note **basic auth**, not `client_secret_post`,
or you get `401 invalid_client "Unsupported authentication method"`:

```bash
WID=$(docker exec ai-demo-api-server printenv PINGONE_WORKER_CLIENT_ID)
WS=$(docker exec ai-demo-api-server printenv PINGONE_WORKER_CLIENT_SECRET)
WT=$(curl -s -u "$WID:$WS" -X POST "https://auth.pingone.com/$ENVID/as/token" \
  -d grant_type=client_credentials | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $WT" \
  "https://api.pingone.com/v1/environments/$ENVID/applications/6586d3de-b916-454c-84e5-6d21b572a534/grants"
```

## Privilege's own structure — and the credential that is missing

Privilege does **not** keep its real config in this repo. Inside the proxy container:

```
/procyon/bin/cyonproxy      the proxy daemon
/procyon/bin/cyctl          Privilege's admin CLI   <-- the important one
/procyon/ssl/               live node state (docker volume ai-demo_mcpgw-ssl)
/var/lib/procyon/config/    OUR bind-mount of ping-mcpgw/config (pingone.env lives here)
```

`ping-mcpgw/config/pingone.env` supports only seven keys — `SERVER_URL`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URL`, `OIDC_TOKEN_URL`,
`OIDC_USER_URL`, `OIDC_SCOPES`. No issuer, no `jwks_uri`. **Do not conclude from this
that the issuer cannot be configured** — that inference was made earlier and was wrong.
The real admin surface is `cyctl`, which has full CRUD:

```
cyctl object application   create | get | list | update | delete
cyctl object accesspolicy  ...
cyctl object aiagentaccount | appusertoken | approvalreq | ...
cyctl --apigw <url> --tenant 8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b --token <JWT> ...
```

`cyctl object application get` is the fastest way to read the `mypingone` app's real auth
config and settle whether the signature failure is a fixable setting or a vendor gap.

**It is blocked on a credential nobody has on this machine:**

```
cyctl --token <enrollment JWT> object application list
  -> token validation failed: unexpected signing method: ES256
cyctl token jwt <tenant> <org> <user> <device-id>
  -> Error: token is required: pass --token or set TOKEN env variable
```

The enrollment token is ES256 — a *node* identity. `cyctl` wants a *user* auth JWT, and
its own minting path needs a token to mint a token. The cloud gateway is live
(`https://privilege.pingone.com` → 302), so this is purely the missing credential.

What would unblock it: a `cyctl` auth token (`--token` or `TOKEN` env var), a Privilege
console session/bearer token, or whatever admin credential Privilege issues for CLI use.

## Known dead end — do not retry without new evidence

`PRIVILEGE_MCPGW_URL=https://privilege.pingone.com/api/mcp` (the "Cloud API") is a dead
end, recorded in `docs/PRIVILEGE-MCP.md` §4. It 401s every path including its own
`.well-known/oauth-protected-resource` and sends no `WWW-Authenticate`. Enumerating all
**25 resources** in env `01d89b06` confirms *why*: every one is a demo audience
(`*.ping.demo`, `a2a-intermediate-*`, `agent`, `content`, `test`) plus the built-in
`PingOne API` and `openid`. There is **no Privilege resource**, so no app in this
environment can mint a token with a Privilege audience.

The `privilege-cloud-mcp` skill used to recommend this endpoint. It was corrected in
PR #1248. If the skill and `docs/PRIVILEGE-MCP.md` ever disagree again, the doc wins.

## Changes made today

Merged:

- **PR #1244** — `POST /api/privilege-mcp/config` merged blank strings over the
  env-seeded config, so one mistimed click permanently wiped `clientId` and every
  sign-in returned `400 "Client ID is required before auth start."` Blank now means
  "unchanged".
- **PR #1248** — moved `PRIVILEGE_MCPGW_URL` from `:8680` to `:8623` and rewrote the
  `privilege-cloud-mcp` skill (dead cloud-API advice, wrong ports, a `guest-agent.env`
  that does not exist, a `proxy-token` bind-mount compose had removed, wrong volume
  name `ai-demo2_` vs `ai-demo_`).

**PR #1248's port change targeted the wrong thing.** The client endpoint is the app's
**Frontend Name**, which is cloud-published — `:8680` and `:8623` are equally dead as
client endpoints. Privilege serves the frontend in their cloud and reaches the backend
down the proxy's gRPC tunnel; nothing needs to listen locally. A successful TCP connect
to 8623 proves only the Docker port-forward. The compose comment added in #1248 asserts
the wrong reason and should be corrected.

Local-only, **not committed** (`.env` is gitignored — these do not exist on the SE
cluster or a fresh checkout):

```
MCP_MTLS_ON=                # was 1
PRIVILEGE_MCPGW_URL=https://mypingone-app-default.applications.privilege.pingone.com:8643/mcp
```

`MCP_MTLS_ON` is the single switch driving four services (`mcp-server`,
`demo-api-server`, `mcp-gateway`, `ping-gateway`). Turning it off is what makes the
console app's configured backend `http://host.docker.internal:8080/mcp` return `200`;
with mTLS on it was `403`. All four were recreated together so no side of the hop
drifted. Both gateways still return `401` to unauthenticated calls — bearer enforcement
is unchanged, only the transport-layer cert requirement is gone.

Backups: `/tmp/env-backup-mtls-20260802T210732Z.bak`,
`/tmp/env-backup-mcpgwurl-20260802T231900Z.bak`.

## Traps that cost time today

- **`docker logs ai-demo-ping-mcpgw` is empty.** The proxy logs to
  `/var/log/procyon/cyonproxy.log` in the `mcpgw-logs` volume. Read it with
  `docker exec … tail`, or from a throwaway container when it is not running.
- **An expired enrollment token does not stop the proxy.** The JWT is consumed once to
  obtain an mTLS client cert (`/procyon/ssl/proxy-crt.pem`, valid to **2036-01-26**);
  the cert carries node identity thereafter. Do not diagnose "expired token" from the
  file's `exp` alone — check whether the container is running and linked first. It only
  matters on first boot or after the `ai-demo_mcpgw-ssl` volume is deleted. **If that
  volume is ever wiped, re-enrollment needs a valid JWT, and the one on disk is
  expired** — get a fresh one from the console *before* any volume wipe.
- **`ping-mcpgw/config/proxy-token` was the literal placeholder `eyJ...`** (6 chars).
  Compose passes it via `ENV_PROXY_TOKEN`, and the container crash-looped 12 times with
  `fatal: Error creating edge proxy: token contains an invalid number of segments`.
  Root `.env` held the correct 2697-char token throughout. Restored from `.env`.
- **`nc -z` says 8623 is open even when nothing serves it.** The container publishes the
  port regardless. Use `curl` against `/mcp`, or check listeners inside the container
  (`docker exec … cat /proc/net/tcp`) — only `127.0.0.1:8090` binds.
- **Do not run `docker compose up` directly** — a hook blocks it. Use `./run-docker.sh`.
  `restart <svc>` does `up -d --force-recreate`, so env changes are picked up.

## Loose ends

- **`ping-mcpgw/config/ssl/` contains a different, older node identity** —
  `a7d08406-b400-4987-baae-0a9f05e7546d`, expired 2026-07-31, certs dated Jul 30 —
  sitting inside the directory bind-mounted to `/var/lib/procyon/config`. The live node
  is `e40f4540-…`. Two identities visible to the proxy is a plausible source of the
  repeating `has same NodeURL - this happens because of misconfigured Node` error, and
  possibly of an `ExitCode=2` observed once. **Untouched — confirm before removing.**
- **Duplicate node registration.** Every collision log line names only `e40f4540-…`, the
  live node, so the console may hold a duplicate registration of the same identity. An
  earlier instruction to "delete the twin" was based on a `9a8bddf5-…` node that appears
  in older docs but **not** in current logs. Rule: never delete the row matching the
  running node while it is the only one — that invalidates enrollment, and no valid
  enrollment JWT is available to recover.
- The `has same NodeURL` error is warning-level. Enrollment works. It is cleanup, not
  the blocker.

## Next steps, in order

1. **Sign in at `/privilege-mcp-client` and click Refresh Tools.** The interactive
   `authorization_code` flow is untested and may validate via `/userinfo` rather than
   JWT signature. If it works, the signature problem affects machine tokens only.
2. If it fails, get a `cyctl` credential and run `cyctl object application get` on
   `mypingone` to read its real auth config.
3. If that config exposes an issuer / `jwks_uri` field, set:
   `https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as` and
   `…/as/jwks`.
4. If it does not, this is a vendor question, and the repro is clean: *a valid RS256
   PingOne token whose `kid` is present in the published JWKS, rejected as "signature
   validation failed."*
5. Independently: resolve the stale `config/ssl/` node and the duplicate registration.
6. Correct PR #1248's compose comment, which states the wrong reason for the port.
