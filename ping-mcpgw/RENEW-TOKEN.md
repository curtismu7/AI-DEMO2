# Renew Expired Privilege Proxy Token

## Read this before running anything below

**An expired enrollment token does not stop a proxy that is already enrolled.** The JWT is
consumed **once**, to obtain an mTLS client cert; node identity rides on that cert
afterwards. On 2026-08-03 `ping-mcpgw/config/proxy-token` had been expired since
`01:23 UTC` and the proxy had been connected for nine hours, command stream up.

So an expired `exp` is **not** a diagnosis. Check whether the proxy is actually down first:

```bash
docker ps --filter name=ai-demo-ping-mcpgw --format '{{.Status}}'
docker run --rm -v ai-demo_mcpgw-logs:/logs alpine \
  sh -c 'grep -c "established command stream" /logs/cyonproxy.log'
```

If it is running and the command stream is established, **stop here.** The most you should
do is Step 1 + Step 2 — drop a fresh JWT on disk so a future rebuild can enrol. Steps 3-4
destroy a working node.

This procedure applies when: the container crash-loops, enrollment genuinely fails, or the
`ai-demo_mcpgw-ssl` volume has been deleted.

> **Never delete the `ai-demo_mcpgw-ssl` volume while holding only an expired token.** The
> cert inside it is the only working identity; the token file cannot replace it. Get the
> fresh JWT (Step 1) and confirm it is unexpired *before* touching the volume.

## Step 1 — Get a fresh token

1. Go to **https://console.pingone.com** → sign in
2. Navigate to **Cloud > Gateways**
3. Find gateway **cmuir-mcpgw**
4. Use the **refresh icon on the existing node row**. Prefer this over **Add Node**:
   `Add Node` registers another node, and the control plane already lists several dead
   ones (`a7d08406-…`, `9a8bddf5-…`, `e40f4540-…`) beside the live `570afb32-…`, which is
   the source of the repeating `has same NodeURL` error. Use `Add Node` only when the
   node the token references no longer exists — see the 500 "not found" section below.
5. Copy the `ENV_PROXY_TOKEN=eyJ...` JWT from the wizard

## Step 2 — Save the token

```bash
printf '%s' 'eyJ...<paste full JWT>' > ping-mcpgw/config/proxy-token
```

This file is gitignored — never commit it.

## Step 3 — Clear stale enrollment state

**Only when re-enrolling.** This deletes the node's identity and is not reversible with an
expired token. Confirm the JWT you just saved is unexpired (see
[Check current token expiry](#check-current-token-expiry)) before running it.

The Docker volume has old `proxy-config.data`. The proxy ignores the new token
unless this is removed.

The volume is `ai-demo_mcpgw-ssl`, NOT `ai-demo2_mcpgw-ssl`. `docker-compose.yml`
sets `name: ai-demo`, so Compose prefixes volumes with that and not with the
directory name. The old value named a volume that does not exist, and with
`2>/dev/null || true` swallowing the error the step looked like it worked while
the stale enrollment state survived — after which the proxy ignores the new
token and enrollment fails for a reason this step was meant to rule out.

```bash
docker compose --profile mcpgw stop ping-mcpgw
docker volume rm ai-demo_mcpgw-ssl

# Confirm it is gone — this must print nothing:
docker volume ls --format '{{.Name}}' | grep '^ai-demo_mcpgw-ssl$'
```

## Step 4 — Restart

```bash
export PRIVILEGE_PROXY_TOKEN="$(cat ping-mcpgw/config/proxy-token)"
./run-docker.sh optional start mcpgw
```

## Step 5 — Verify

`docker logs ai-demo-ping-mcpgw` is nearly empty — the proxy writes to
`/var/log/procyon/cyonproxy.log` inside the `mcpgw-logs` volume, so read it there:

```bash
docker run --rm -v ai-demo_mcpgw-logs:/logs alpine \
  sh -c 'tail -50 /logs/cyonproxy.log' | grep -iE "established command stream|enrolled|error"
```

Success looks like `Node <id> established command stream to …`. A repeating
`has same NodeURL` line alongside it logs at `level=error` but is harmless — it means
duplicate registrations exist, not that enrollment failed.

## Step 6 — End-to-end test

1. Browse to `https://local.ping-devops.com:4000/privilege-mcp-client`
2. Sign in as `cmuir+ssoEndUser@pingone.com`
3. Call a tool

If you get **"User is not authorized"** — the proxy is healthy but the user
needs a policy in the Privilege console:
AI Security → Agentic Apps → your MCP App → Policies.

## Key gotcha

The `mcpgw-ssl` volume is the #1 reason re-enrollment silently fails.
The proxy always prefers persisted state over the token file — **you must
delete the volume before re-enrolling**.

The same preference is why an expired token is survivable: persisted state wins, so a
running proxy keeps working on its cert. Delete the volume and that safety net is gone, so
never delete it speculatively — only as part of a re-enrollment you have a fresh JWT for.

## Error: 500 "not found" on enrollment

```
Error connecting to https://privilege.pingone.com: HTTP error: 500 Internal Server Error
"error": "not found", "code": 2, "message": "not found"
```

This means the **node referenced by the token was deleted** on the Privilege side.
The token contains a `nodeId` that no longer exists in the gateway's node list.

**Fix:** Go to the Privilege console → Cloud > Gateways → open your gateway →
click **Add Node** to generate a fresh token for a *new* node. If the gateway
itself was deleted, recreate it first (Add New → Add via Docker).

The token issued 2026-08-01 (nodeId `affdbc0f-...`) hit this exact error.

## Error: "Unauthorized" on MCP server discovery

After successful enrollment, the Privilege console shows:

```
Error discovering MCP server: calling "initialize": sending "initialize": Unauthorized
```

This means the proxy connected to the control plane but the **upstream MCP server
rejected the forwarded request**. Two causes:

### Cause A — mTLS is enabled on the MCP server

The Privilege proxy doesn't carry the gateway mTLS client cert. The MCP server
drops the connection as unauthorized.

```bash
# Check:
docker exec ai-demo-mcp-server env | grep MCP_MTLS
```

Fix by clearing **`MCP_MTLS_ON`** in the root `.env`, not by exporting `MCP_MTLS_ENABLED`:
`docker-compose.yml` sets `MCP_MTLS_ENABLED: "${MCP_MTLS_ON:+true}"` for every consumer, so
a shell value is overwritten at container creation. One switch drives four services.

```bash
# root .env: leave it empty for plaintext
MCP_MTLS_ON=
```

Then recreate — `restart` alone will not re-read `.env`. Do not run `docker compose up`
directly; a hook blocks it after repeated name-squatting collisions between parallel
sessions:

```bash
./run-docker.sh restart mcp-server
```

### Cause B — MCP Server URL points at PingGateway instead of the MCP server

The MCP server allows **unauthenticated** `initialize` and `tools/list` calls
(discovery methods). But if the MCP Application in the Privilege console has its
**MCP Server URL** pointed at PingGateway (`http://ping-gateway:8080/mcp` or
`https://api.ping.demo:3036/mcp`), the gateway enforces its own token validation
and returns 401 — the Privilege proxy has no delegated token for PingGateway.

**Fix in the Privilege console:**
1. Go to **AI Security → Agentic Apps** → your MCP Server app
2. Set **MCP Server URL** to `http://mcp-server:8080/mcp` (internal compose DNS,
   bypasses PingGateway — Privilege IS the security boundary, not PingGateway)
3. **Auth Mode**: Static Token (leave the value blank) or None
4. Click **Discover** — tools should appear within ~30s

> **Key insight:** Do NOT stack Privilege behind PingGateway. The Privilege proxy
> must hit the MCP server directly. PingGateway and Privilege are alternative
> gateways — use one or the other for a given request path, not both.

### After discovery succeeds

Once tools are discovered:
1. Create a **Policy** in the MCP App → assign to user `cmuir+ssoEndUser@pingone.com`
2. Enable **Session Recording** if you want the demo to show recorded sessions
3. Test from the UI at `/privilege-mcp-client`

## Check current token expiry

```bash
cat ping-mcpgw/config/proxy-token | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "
import sys, json, datetime
d = json.loads(sys.stdin.read())
exp = datetime.datetime.fromtimestamp(d['exp'], tz=datetime.timezone.utc)
now = datetime.datetime.now(tz=datetime.timezone.utc)
status = 'EXPIRED' if now > exp else 'valid'
print(f'{status} — expires {exp.isoformat()} ({\"%.1f\" % ((exp-now).total_seconds()/3600)}h from now)')
"
```
