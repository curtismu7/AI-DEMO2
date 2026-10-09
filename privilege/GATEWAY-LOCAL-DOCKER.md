# Running the Privilege gateway locally (Docker)

October 9, 2026 · operational guide

The `ping-mcpgw` + `mcpgw-nginx` compose profile (`profile: mcpgw`): a local
Agentless Privilege gateway on this machine, fronted by customer-owned DNS and
TLS. Use it to probe gateway behavior without touching the live SE releases.
Companion sources: [`runbooks/ping-mcpgw.md`](runbooks/ping-mcpgw.md) (the
setup runbook this condenses), [`runbooks/mcpgw-nginx.md`](runbooks/mcpgw-nginx.md),
[`runbooks/renew-token.md`](runbooks/renew-token.md),
[`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md) (why it behaves the way it does).

**Status before you start** (checked 2026-10-09): the local gateway is
**stopped**, its enrollment token **expired 2026-08-20** (cluster `ai-demo-mine`,
`PrivateProxy`), and the volumes (`ai-demo_mcpgw-ssl/-logs/-recordings`) are
retained. An expired token does **not** matter for a container that is already
enrolled — the mTLS pair in the `mcpgw-ssl` volume is the identity after first
enrollment — but this container was swapped to the `mcpgw` binary in a state
where re-enrollment was blocked (see the CA wall below). Expect to either (a)
boot on the retained mTLS pair if it is present and valid, or (b) be blocked at
first enrollment until Ping resolves the CA wall.

## Start / stop

```sh
./run-docker.sh optional start mcpgw    # starts ping-mcpgw + mcpgw-nginx (+ opensearch pair)
docker compose --profile mcpgw up -d ping-mcpgw   # equivalent, gateway only
./run-docker.sh optional stop mcpgw     # stop the group
docker compose --profile mcpgw stop ping-mcpgw    # gateway only
```

`run-docker.sh` runs `scripts/ensure-mcpgw-certs.sh` before the profile starts
— it generates the wildcard mkcert pair (`certs/mcpgw-wildcard{,-key}.pem`)
over `*.mcpgw.local.ping-devops.com`. The core stack's `api.ping.demo+2.pem`
does **not** cover these hosts; never substitute it. (Symptom of the wrong/no
cert: `502` from nginx with `tlsv13 alert certificate required` in its error
log.)

## One-time setup

1. **Enrollment token.** Privilege console → Cloud > Gateways → Add New →
   Add via Docker; keep only the `eyJ...` after `ENV_PROXY_TOKEN=`, then:

   ```sh
   printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env
   ```

   The file is gitignored. Only needed on **first boot** — after enrollment the
   gateway authenticates with the mTLS pair in `/procyon/ssl` and ignores the
   token entirely (which is why an expired token can still boot an enrolled
   container).

2. **`pingone.env`** — copy `pingone.env.example`, fill `SERVER_URL`
   (`https://mcpgw.local.ping-devops.com`), the PingOne OIDC app's
   client ID/secret, the three `auth.pingone.com/<env>/as/...` URLs, and
   `OIDC_SCOPES=openid profile email`. Register
   `${SERVER_URL}/callback` on that PingOne application. Note: in the current
   build the front-end OAuth config actually lives on the Privilege
   Application object (set with `cyctl`, not the console UI) — keep this file
   correct anyway; the native guest agent reads the same settings.

3. **`/etc/hosts`** — one line per frontend host (no wildcards in hosts files):

   ```
   127.0.0.1  mcpgw.local.ping-devops.com
   127.0.0.1  aidemo.mcpgw.local.ping-devops.com
   ```

4. **Console application.** AI Security > Agentic Apps → Add Application →
   MCP Server. Backend `http://mcp-server:8081/mcp` (the plaintext Privilege
   listener; 8080 stays mTLS for PingGateway), Auth Mode Static Token with an
   **empty** token (`mcp-server` runs `MCP_AUTH_DISABLED=true`), Mesh Cluster
   = your gateway. Author the policy that produces the demo's DENY here, and
   enable session recording — **the deny decision and the recordings are
   console-authored, not repo config**; every repo check can pass while the
   demo shows nothing.

## The two auth boundaries

| Hop | Configured in | Setting |
|---|---|---|
| Client → gateway (front end) | `pingone.env` / Privilege app object | PingOne OIDC (PKCE **mandatory** — app `deff60f5` enforces `S256_REQUIRED`) |
| Gateway → MCP server (back end) | the console's MCP Application | Static Token, empty (internal hop deliberately open; Privilege enforces policy at its own layer) |

## Ports — settle by probing, not by memory

The 2026-08-12 binary swap inverted the port roles:

| Port | cyonproxy (old) | mcpgw (current) |
|---|---|---|
| 8620 | MCP frontend (`-alp-port`) | agentless API, untested on this binary |
| 8623 | mTLS mesh port (`-listen`) | **the MCP + OAuth listener** (`-mcpgw`) — nginx targets it |
| 8680 | — | mesh (`-listen`) |
| 8690 | — | medusa |

The one probe that disambiguates:

```sh
curl -ski -X POST https://localhost:8623/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# 401 with www-authenticate: Bearer realm="MCP OAuth Server", authorization_uri="..."
# = the MCP listener (clean 401 with a challenge = wall is down, routing works)
```

`mcpgw-nginx` maps client Host → registered Frontend Name via the `map` block
in `demo_mcpgw_nginx/nginx.conf`; adding an application is one `map` line plus
one `/etc/hosts` line, and the compose `aliases` list on `mcpgw-nginx` so the
BFF resolves the name in-container.

## Verify

1. `docker ps` — `ai-demo-ping-mcpgw` and `ai-demo-mcpgw-nginx` Up.
2. The tokenless 401 probe above — proves cert, nginx, gateway, and listener
   in one shot. **A tokenless 401 does not prove the application path**: the
   bearer check runs before application resolution, so invented app names
   answer identically (measured 2026-08-31).
3. Authenticated path: use the demo page's Privilege client
   (`/privilege-mcp-client`) or
   `bash scripts/privilege-smoke.sh '<console-token>' [app-name]` — manual,
   needs a ~60-minute console token from browser devtools and a non-expiring
   policy for your user. Its main value: distinguishing a **policy 403**
   (expired/absent policy — not a gateway regression) from real failures.
4. Recordings land in the `mcpgw-recordings` volume; logs in `mcpgw-logs`
   (`/var/log/procyon`), not stdout.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Container exits ~5s, zero output (macOS) | console's raw `--net=host` docker command appears to succeed; the container never starts | Always verify with `docker ps -a`; use the compose service instead |
| `MCP Config path not specified` (fatal) | `-mcpconfpath` omitted | The compose `command:` carries it; don't hand-run without it |
| `ProxyToken write ... read-only file system` (exit 1) | token file bind-mounted `:ro` — the proxy rewrites `/procyon/ssl/proxy-token.data` at startup | Use the named volume (`mcpgw-ssl:/procyon/ssl`) as compose does; never a file bind |
| `crypto/ecdsa: verification error` at boot, token unspent | whitespace/truncation in the token file | The local signature check runs before any server contact; re-save as one line starting `eyJ`, no stray spaces |
| `x509: certificate signed by unknown authority (Root CA PingOne Privilege)` on first enrollment | vendor CA-trust wall (2026-08-12): no published image trusts the presented Ping PKI chain; no CLI flag supplies a trust anchor | **Blocked until Ping resolves it.** Already-enrolled nodes are unaffected (they never re-verify once enrolled). See `PRIVILEGE-MCP.md` §2026-08-12 |
| `401 Bearer Token not found.` from `/mcp` with no `WWW-Authenticate` | bearer check runs first; proves nothing about routing | Repoint at the correct listener (8623 on mcpgw) and expect a challenge |
| `502` from nginx, `tlsv13 alert certificate required` | wrong/missing gateway serving cert | Let `ensure-mcpgw-certs.sh` regenerate the wildcard pair |
| `JWT signature validation failed` (BFF) | `PRIVILEGE_MCPGW_URL` points at a frontend that emits no challenge → BFF falls back to PingOne OIDC → PingOne-signed token rejected | Point it at a gateway URL that emits `WWW-Authenticate` |
| `Unknown client` (BFF) | gateway restart wiped in-memory DCR clients; BFF still caches the old `client_id` | Restart the BFF whenever the gateway restarts; next `auth/start` registers a fresh DCR client |
| Binary swap crash-loop | `mcpgw` does not read `cyonproxy`'s enrollment state — a swap forces fresh enrollment | Keep the old binary's volume for rollback; don't swap while enrollment is blocked |

## What is verified

| Fact | Status |
|---|---|
| mcpgw emits the 401 OAuth challenge on 8623 | Verified live (2026-08-12, on another engineer's cluster + binary string check) |
| Port-role inversion after the swap | Verified from binary `--help` + probes |
| Token whitespace → `crypto/ecdsa` crash-loop, token unspent | Verified live 2026-10-03 |
| Read-only token bind → exit 1 | Verified live |
| Console command omits `/var/lib/procyon` mount | Verified from `cyctl` binary |
| First-enrollment CA wall blocks all fresh tokens | Verified live, four reproductions 2026-08-12; root cause inferred |
| Local gateway currently bootable on retained state | **Not tested since the swap** — this guide's status note was checked 2026-10-09 but the start was not run (it would either work off the mTLS pair or hit the CA wall) |
